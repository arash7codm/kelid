import { GoogleGenAI, Type } from '@google/genai';
import { ReminderCategory } from '../db/schema';
import {
  addDaysToJalali,
  getTodayJalali,
  toEnglishDigits,
  toPersianDigits,
} from '../utils/persian';

const GEMINI_KEY_STORAGE = 'kelid_gemini_api_key';

export function getStoredGeminiApiKey(): string {
  if (typeof window === 'undefined') return '';
  return (localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim();
}

export function setStoredGeminiApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = key.trim();
  if (trimmed) {
    localStorage.setItem(GEMINI_KEY_STORAGE, trimmed);
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
  }
}

function getBrowserGenAIClient(): GoogleGenAI | null {
  const apiKey = getStoredGeminiApiKey();
  if (!apiKey) return null;
  try {
    return new GoogleGenAI({ apiKey });
  } catch {
    return null;
  }
}

export function sanitizeAiError(_err: unknown): string {
  return 'کلید Gemini نامعتبر است یا ارتباط با سرویس برقرار نشد.';
}

export interface StructuredReminderExtraction {
  title: string;
  jalaliDate: string;
  weekday?: string;
  dateReason: string;
  time: string;
  timeDisplay: string;
  timeReason: string;
  timeNeedsConfirmation: boolean;
  categories: ReminderCategory[];
  priority: 'urgent' | 'normal' | 'low';
  matchedCodes: string[];
  unknownEntities: string[];
  summary: string;
}

export interface ParsedNaturalSearch {
  keywords: string[];
  propertyType?: string;
  city?: string;
  minArea?: number;
  maxArea?: number;
  minPrice?: number;
  maxPrice?: number;
  deedType?: string;
  zoningStatus?: string;
}

// Local deterministic parser so offline extraction & natural search always work in browser
export function localExtractReminderFromText(
  transcript: string,
  knownEntities: Array<{ code: string; name: string }>
): StructuredReminderExtraction {
  const today = getTodayJalali(true);
  const clean = toEnglishDigits(transcript);

  // 1. Date resolution against real current date
  let jalaliDate = today;
  let dateReason = `چون زمان مشخصی ذکر نشد -> امروز (${today})`;

  if (transcript.includes('پس‌فردا') || transcript.includes('پس فردا')) {
    jalaliDate = addDaysToJalali(today, 2, true);
    dateReason = `چون گفتید «پس‌فردا» -> ${jalaliDate}`;
  } else if (transcript.includes('فردا')) {
    jalaliDate = addDaysToJalali(today, 1, true);
    dateReason = `چون گفتید «فردا» -> ${jalaliDate}`;
  } else if (transcript.includes('هفته بعد') || transcript.includes('هفته‌ی بعد')) {
    jalaliDate = addDaysToJalali(today, 7, true);
    dateReason = `چون گفتید «هفته بعد» -> ${jalaliDate}`;
  } else if (transcript.includes('امروز')) {
    jalaliDate = today;
    dateReason = `چون گفتید «امروز» -> ${today}`;
  }

  // 2. Time resolution
  let time = '11:00';
  let timeDisplay = '۱۱:۰۰ قبل‌ازظهر';
  let timeReason = 'ساعت پیش‌فرض کاری (نیاز به تأیید)';
  let timeNeedsConfirmation = true;

  const hourMatch = clean.match(/ساعت\s*(\d{1,2})(?::(\d{2}))?/);
  if (hourMatch) {
    let h = parseInt(hourMatch[1], 10);
    const m = hourMatch[2] ? parseInt(hourMatch[2], 10) : 0;
    const isAfternoon =
      transcript.includes('عصر') ||
      transcript.includes('بعدازظهر') ||
      transcript.includes('بعد از ظهر') ||
      transcript.includes('شب');
    const isMorning = transcript.includes('صبح') || transcript.includes('قبل‌ازظهر');

    if (isAfternoon && h < 12) h += 12;
    const hStr = String(h).padStart(2, '0');
    const mStr = String(m).padStart(2, '0');
    time = `${hStr}:${mStr}`;
    const periodLabel = h >= 12 ? 'بعدازظهر' : 'قبل‌ازظهر';
    timeDisplay = `${toPersianDigits(hStr)}:${toPersianDigits(mStr)} ${periodLabel}`;
    timeReason = `چون گفتید «ساعت ${toPersianDigits(hourMatch[1])}${isMorning ? ' صبح' : isAfternoon ? ' عصر' : ''}» -> ${timeDisplay}`;
    timeNeedsConfirmation = !isMorning && !isAfternoon;
  }

  // 3. Categories
  const categories: ReminderCategory[] = [];
  if (transcript.includes('تماس') || transcript.includes('زنگ') || transcript.includes('تلفن')) {
    categories.push('phone');
  }
  if (
    transcript.includes('سند') ||
    transcript.includes('استعلام') ||
    transcript.includes('مدارک') ||
    transcript.includes('جواز') ||
    transcript.includes('بنیاد')
  ) {
    categories.push('inquiry');
  }
  if (transcript.includes('بازدید') || transcript.includes('حضوری') || transcript.includes('سر زمین')) {
    categories.push('visit');
  }
  if (
    transcript.includes('چک') ||
    transcript.includes('کمیسیون') ||
    transcript.includes('مالی') ||
    transcript.includes('پرداخت') ||
    transcript.includes('تسویه')
  ) {
    categories.push('finance');
  }
  if (categories.length === 0) categories.push('phone');

  // 4. Priority
  const isUrgent =
    transcript.includes('فوری') ||
    transcript.includes('حتماً') ||
    transcript.includes('حتما') ||
    transcript.includes('بحرانی') ||
    transcript.includes('سریع');
  const priority: 'urgent' | 'normal' | 'low' = isUrgent ? 'urgent' : 'normal';

  // 5. Match known entities & codes
  const matchedCodes: string[] = [];
  const codeRegex = /\b([FCHR]-\d{3})\b/gi;
  let cm: RegExpExecArray | null;
  while ((cm = codeRegex.exec(clean)) !== null) {
    matchedCodes.push(cm[1].toUpperCase());
  }

  for (const ent of knownEntities) {
    if (
      (ent.name && transcript.includes(ent.name)) ||
      (ent.code && clean.toUpperCase().includes(ent.code.toUpperCase()))
    ) {
      if (!matchedCodes.includes(ent.code)) {
        matchedCodes.push(ent.code);
      }
    }
  }

  const shortTitle =
    transcript.length > 52 ? transcript.substring(0, 52).trim() + '...' : transcript.trim();

  return {
    title: shortTitle || 'پیگیری پرونده و هماهنگی مشاور',
    jalaliDate,
    dateReason,
    time,
    timeDisplay,
    timeReason,
    timeNeedsConfirmation,
    categories,
    priority,
    matchedCodes,
    unknownEntities: [],
    summary: `اقدام «${categories.includes('phone') ? 'تماس تلفنی' : 'پیگیری'}» برای تاریخ ${jalaliDate} ساعت ${timeDisplay}${matchedCodes.length ? ` مرتبط با ${matchedCodes.join('، ')}` : ''}`,
  };
}

export function localParseNaturalSearch(query: string): ParsedNaturalSearch {
  const clean = toEnglishDigits(query);
  const result: ParsedNaturalSearch = { keywords: [] };

  if (query.includes('زمین')) result.propertyType = 'زمین';
  else if (query.includes('ویلا')) result.propertyType = 'ویلا';
  else if (query.includes('آپارتمان')) result.propertyType = 'آپارتمان';
  else if (query.includes('مغازه') || query.includes('تجاری')) result.propertyType = 'تجاری';
  else if (query.includes('باغ')) result.propertyType = 'باغ';

  const cities = ['کلارآباد', 'متل قو', 'متل‌قو', 'سلمان‌شهر', 'چالوس', 'نمک‌آبرود', 'نوشهر', 'عباس‌آباد', 'رامسر', 'تنکابن'];
  for (const c of cities) {
    if (query.includes(c)) {
      result.city = c;
      break;
    }
  }

  // Area parsing (e.g., "۳۰۰ متری" or "250 متر")
  const areaMatch = clean.match(/(\d{2,4})\s*متر/);
  if (areaMatch) {
    const a = parseInt(areaMatch[1], 10);
    result.minArea = Math.round(a * 0.85);
    result.maxArea = Math.round(a * 1.15);
  }

  // Budget parsing (e.g., "زیر ۱۲ میلیارد" or "تا ۱۵ میلیارد")
  const underBillionMatch = clean.match(/(?:زیر|تا|حداکثر)\s*(\d+(?:\.\d+)?)\s*میلیارد/);
  if (underBillionMatch) {
    result.maxPrice = parseFloat(underBillionMatch[1]) * 1_000_000_000;
  } else {
    const billionMatch = clean.match(/(\d+(?:\.\d+)?)\s*میلیارد/);
    if (billionMatch) {
      const b = parseFloat(billionMatch[1]) * 1_000_000_000;
      result.maxPrice = b * 1.15;
    }
  }

  if (query.includes('تک‌برگ') || query.includes('تک برگ')) {
    result.deedType = 'تک‌برگ';
  }
  if (query.includes('داخل بافت')) {
    result.zoningStatus = 'داخل بافت';
  }

  const stopWords = ['یه', 'یک', 'زیر', 'بالای', 'تا', 'حداکثر', 'حداقل', 'متر', 'متری', 'میلیارد', 'تومان', 'در', 'با'];
  const tokens = clean
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !stopWords.includes(t) && !/^\d+$/.test(t));

  result.keywords = tokens;
  return result;
}

export const aiService = {
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const client = getBrowserGenAIClient();
    if (!client) {
      return {
        ok: false,
        message: 'کلید Gemini در گوشی ذخیره نشده است (پردازشگر محلی آفلاین فعال است).',
      };
    }
    if (!navigator.onLine) {
      return { ok: false, message: 'آفلاین — پردازشگر محلی فعال است' };
    }
    try {
      const resp = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'پاسخ کوتاه بده: متصل شد',
      });
      if (resp.text) {
        return { ok: true, message: 'متصل به موتور هوش مصنوعی Gemini (کلید شخصی روی گوشی)' };
      }
      return { ok: false, message: 'پاسخی از سرویس Gemini دریافت نشد' };
    } catch (e: unknown) {
      return {
        ok: false,
        message: sanitizeAiError(e),
      };
    }
  },

  async transcribeAudio(blob: Blob): Promise<string> {
    const client = getBrowserGenAIClient();
    if (!client || !navigator.onLine) {
      return '';
    }

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = String(reader.result || '');
          const b64 = res.includes(',') ? res.split(',')[1] : res;
          resolve(b64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            inlineData: {
              data: base64,
              mimeType: blob.type || 'audio/webm',
            },
          },
          'این فایل صوتی فارسی را دقیقاً به متن فارسی تبدیل کن. فقط متن گفته‌شده را برگردان.',
        ],
      });

      return (response.text || '').trim();
    } catch {
      return '';
    }
  },

  async extractReminderFromTranscript(
    transcript: string,
    knownEntities: Array<{ code: string; name: string }>
  ): Promise<StructuredReminderExtraction> {
    const fallback = localExtractReminderFromText(transcript, knownEntities);
    const client = getBrowserGenAIClient();
    if (!client || !navigator.onLine) {
      return fallback;
    }

    try {
      const todayJalali = getTodayJalali(true);
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `متن یادآور صوتی مشاور املاک: "${transcript}"
تاریخ امروز شمسی: ${todayJalali}
پرونده‌های موجود: ${JSON.stringify(knownEntities.slice(0, 30))}
اطلاعات یادآور را به صورت JSON استخراج کن.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              jalaliDate: { type: Type.STRING },
              time: { type: Type.STRING },
              timeDisplay: { type: Type.STRING },
              priority: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
          },
        },
      });

      const data = JSON.parse(response.text || '{}');
      return {
        ...fallback,
        title: data.title || fallback.title,
        jalaliDate: toPersianDigits(data.jalaliDate || fallback.jalaliDate),
        time: data.time || fallback.time,
        timeDisplay: toPersianDigits(data.timeDisplay || fallback.timeDisplay),
        priority:
          data.priority === 'urgent' || data.priority === 'low'
            ? data.priority
            : fallback.priority,
        summary: data.summary || fallback.summary,
      };
    } catch {
      return fallback;
    }
  },

  async parseNaturalSearch(query: string, _scope = 'global'): Promise<ParsedNaturalSearch> {
    const local = localParseNaturalSearch(query);
    const client = getBrowserGenAIClient();
    if (!client || !navigator.onLine || query.trim().split(/\s+/).length < 3) {
      return local;
    }
    try {
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `عبارت جستجوی طبیعی املاک: "${query}". پارامترهای فیلتر (propertyType, city, minArea, maxArea, maxPrice, deedType, zoningStatus) را استخراج کن.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              propertyType: { type: Type.STRING },
              city: { type: Type.STRING },
              minArea: { type: Type.NUMBER },
              maxArea: { type: Type.NUMBER },
              maxPrice: { type: Type.NUMBER },
              deedType: { type: Type.STRING },
              zoningStatus: { type: Type.STRING },
            },
          },
        },
      });
      const data = JSON.parse(response.text || '{}');
      return {
        ...local,
        propertyType: data.propertyType || local.propertyType,
        city: data.city || local.city,
        minArea: data.minArea || local.minArea,
        maxArea: data.maxArea || local.maxArea,
        maxPrice: data.maxPrice || local.maxPrice,
        deedType: data.deedType || local.deedType,
        zoningStatus: data.zoningStatus || local.zoningStatus,
      };
    } catch {
      return local;
    }
  },

  async extractDocumentSummary(file: File): Promise<string> {
    const client = getBrowserGenAIClient();
    if (!client || !navigator.onLine) {
      return 'آماده در آرشیو محلی ✓';
    }
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = String(reader.result || '');
          resolve(res.includes(',') ? res.split(',')[1] : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (base64.length >= 15_000_000) {
        return 'آماده در آرشیو محلی ✓';
      }
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            inlineData: {
              data: base64,
              mimeType: file.type || 'application/pdf',
            },
          },
          'در یک خط کوتاه خلاصه سند یا مدرک ملکی را به فارسی بنویس.',
        ],
      });
      return (response.text || '').trim() || 'تایید شده ✓';
    } catch {
      return 'آماده در آرشیو محلی ✓';
    }
  },
};
