import { GoogleGenAI, Type } from '@google/genai';
import {
  ApplicantRecord,
  CollaboratorRecord,
  PropertyRecord,
  ReminderCategory,
} from '../db/schema';
import {
  addDaysToJalali,
  compareJalaliDates,
  formatJalaliHuman,
  formatJalaliString,
  gregorianToJalali,
  jalaliToDateObject,
  normalizePersianText,
  toEnglishDigits,
  toPersianDigits,
} from '../utils/persian';

const GEMINI_KEY_STORAGE = 'kelid_gemini_api_key';

export function getStoredGeminiApiKey(): string {
  const envKey =
    (typeof process !== 'undefined' && (process.env as any)?.GEMINI_API_KEY) ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) ||
    '';
  if (typeof window !== 'undefined') {
    const localKey = (localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim();
    if (localKey) return localKey;
  }
  return String(envKey).trim();
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

export function getBrowserGenAIClient(): GoogleGenAI | null {
  const apiKey = getStoredGeminiApiKey();
  if (!apiKey) return null;
  try {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch {
    return null;
  }
}

export function sanitizeAiError(_err: unknown): string {
  return 'ارتباط با سرویس هوش مصنوعی برقرار نشد؛ استخراج هوشمند محلی فعال شد.';
}

export interface EntitiesCatalog {
  properties: PropertyRecord[];
  applicants: ApplicantRecord[];
  collaborators: CollaboratorRecord[];
}

export interface MatchedContactItem {
  id: string;
  code: string;
  name: string;
  subtitle: string;
  type: 'applicant' | 'collaborator';
  phone?: string;
  score: number;
}

export interface MatchedPropertyItem {
  id: string;
  code: string;
  title: string;
  city: string;
  area: number;
  score: number;
}

export interface StructuredReminderExtraction {
  transcript: string;
  title: string;
  summary: string;
  jalaliDate: string;
  dateHumanLabel: string;
  weekday?: string;
  dateExpression: string;
  dateReason: string;
  isDefaultDate: boolean;
  dateNeedsConfirmation: boolean;
  time: string;
  timeDisplay: string;
  timeExpression: string;
  timeReason: string;
  isDefaultTime: boolean;
  timeNeedsConfirmation: boolean;
  isPastDateTime: boolean;
  categories: ReminderCategory[];
  priority: 'urgent' | 'normal' | 'low';
  priorityReason: string;
  matchedCodes: string[];
  unknownEntities: string[];
  matchedProperty?: MatchedPropertyItem;
  propertyCandidates: MatchedPropertyItem[];
  matchedContact?: MatchedContactItem;
  contactCandidates: MatchedContactItem[];
  aiFilledFields: string[];
  usedGemini: boolean;
  confidence: {
    transcript: number;
    linkedFile: number;
    linkedContact: number;
    actions: number;
    dateTime: number;
    priority: number;
  };
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

const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

const PERSIAN_WEEKDAYS_MAP: Array<{ name: string; jsDay: number }> = [
  { name: 'یکشنبه', jsDay: 0 },
  { name: 'یک شنبه', jsDay: 0 },
  { name: 'دوشنبه', jsDay: 1 },
  { name: 'دو شنبه', jsDay: 1 },
  { name: 'سه‌شنبه', jsDay: 2 },
  { name: 'سه شنبه', jsDay: 2 },
  { name: 'چهارشنبه', jsDay: 3 },
  { name: 'چهار شنبه', jsDay: 3 },
  { name: 'پنجشنبه', jsDay: 4 },
  { name: 'پنج شنبه', jsDay: 4 },
  { name: 'جمعه', jsDay: 5 },
  { name: 'شنبه', jsDay: 6 },
];

const WORD_NUMBERS: Record<string, number> = {
  یک: 1,
  یه: 1,
  دو: 2,
  سه: 3,
  چهار: 4,
  پنج: 5,
  شش: 6,
  شیش: 6,
  هفت: 7,
  هشت: 8,
  نه: 9,
  ده: 10,
  یازده: 11,
  دوازده: 12,
  سیزده: 13,
  چهارده: 14,
  پانزده: 15,
  پونزده: 15,
  شانزده: 16,
  شونزده: 16,
  هفده: 17,
  هجده: 18,
  نوزده: 19,
  بیست: 20,
  سی: 30,
};

/**
 * Gets current Date anchored in Asia/Tehran timezone.
 */
export function getTehranNow(): Date {
  try {
    const tehranStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' });
    const d = new Date(tehranStr);
    if (!isNaN(d.getTime())) return d;
  } catch {
    // fallback
  }
  return new Date();
}

export function getTehranTodayJalali(persianDigits = true): string {
  const now = getTehranNow();
  const [jy, jm, jd] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return formatJalaliString(jy, jm, jd, persianDigits);
}

function parsePersianNumberToken(token: string): number | null {
  const clean = toEnglishDigits(token).trim();
  if (/^\d+$/.test(clean)) return parseInt(clean, 10);
  if (WORD_NUMBERS[clean] !== undefined) return WORD_NUMBERS[clean];
  return null;
}

/**
 * Deterministic Date & Time Resolver anchored to Asia/Tehran and the Jalali Calendar.
 * Never relies on LLM date arithmetic.
 */
export function resolvePersianDateTimeDeterministically(
  fullText: string,
  aiDateExpr?: string,
  aiTimeExpr?: string
): {
  jalaliDate: string;
  dateHumanLabel: string;
  dateExpression: string;
  dateReason: string;
  isDefaultDate: boolean;
  dateNeedsConfirmation: boolean;
  time: string;
  timeDisplay: string;
  timeExpression: string;
  timeReason: string;
  isDefaultTime: boolean;
  timeNeedsConfirmation: boolean;
  isPastDateTime: boolean;
} {
  const now = getTehranNow();
  const [curJy, curJm, curJd] = gregorianToJalali(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
  const todayJalali = formatJalaliString(curJy, curJm, curJd, true);

  const combinedDateSource = `${aiDateExpr || ''} ${fullText}`.trim();
  const cleanDateSrc = toEnglishDigits(combinedDateSource).replace(/\u200c/g, ' ');

  let jalaliDate = addDaysToJalali(todayJalali, 1, true);
  let dateExpression = aiDateExpr?.trim() || '';
  let dateReason = 'تاریخ مشخصی ذکر نشد (پیش‌فرض: فردا)';
  let isDefaultDate = true;
  let dateNeedsConfirmation = true;
  let relativePrefix = 'فردا';

  // 1. Check explicit YYYY/MM/DD
  const explicitFullMatch = cleanDateSrc.match(/(14\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (explicitFullMatch) {
    const jy = parseInt(explicitFullMatch[1], 10);
    const jm = parseInt(explicitFullMatch[2], 10);
    const jd = parseInt(explicitFullMatch[3], 10);
    if (jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31) {
      jalaliDate = formatJalaliString(jy, jm, jd, true);
      dateExpression = toPersianDigits(explicitFullMatch[0]);
      dateReason = `تشخیص تاریخ دقیق «${dateExpression}»`;
      isDefaultDate = false;
      dateNeedsConfirmation = false;
      relativePrefix = '';
    }
  }

  // 2. Check "<day> <JalaliMonthName>" e.g. "25 مهر" or "بیست و پنجم آبان"
  if (isDefaultDate) {
    for (let mIdx = 0; mIdx < JALALI_MONTHS.length; mIdx++) {
      const mName = JALALI_MONTHS[mIdx];
      const regexNum = new RegExp(`(\\d{1,2})\\s*(?:ام|م)?\\s*${mName}`);
      const m = cleanDateSrc.match(regexNum);
      if (m) {
        const day = parseInt(m[1], 10);
        if (day >= 1 && day <= 31) {
          let targetYear = curJy;
          if (mIdx + 1 < curJm || (mIdx + 1 === curJm && day < curJd)) {
            targetYear = curJy + 1;
          }
          jalaliDate = formatJalaliString(targetYear, mIdx + 1, day, true);
          dateExpression = `${toPersianDigits(day)} ${mName}`;
          dateReason = `تشخیص عبارت «${dateExpression}»`;
          isDefaultDate = false;
          dateNeedsConfirmation = false;
          relativePrefix = '';
          break;
        }
      }
    }
  }

  // 3. Check "<day>ام همین ماه"
  if (isDefaultDate) {
    const sameMonthMatch = cleanDateSrc.match(/(\d{1,2})\s*(?:ام|م)\s*(?:همین\s*ماه|ماه\s*جاری)/);
    if (sameMonthMatch) {
      const day = parseInt(sameMonthMatch[1], 10);
      if (day >= 1 && day <= 31) {
        jalaliDate = formatJalaliString(curJy, curJm, day, true);
        dateExpression = `${toPersianDigits(day)}ام همین ماه`;
        dateReason = `تشخیص روز ${toPersianDigits(day)} ماه جاری`;
        isDefaultDate = false;
        dateNeedsConfirmation = false;
        relativePrefix = '';
      }
    }
  }

  // 4. Check relative expressions: پس‌فردا، فردا، امروز، N روز دیگر، هفته بعد
  if (isDefaultDate) {
    const nDaysMatch = cleanDateSrc.match(
      /(\d+|یک|یه|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه|ده)\s*روز\s*(?:دیگر|دیگه|بعد|آینده)/
    );
    const nWeeksMatch = cleanDateSrc.match(
      /(\d+|یک|یه|دو|سه)\s*هفته\s*(?:دیگر|دیگه|بعد|آینده)/
    );

    if (cleanDateSrc.includes('پس فردا') || combinedDateSource.includes('پس‌فردا')) {
      jalaliDate = addDaysToJalali(todayJalali, 2, true);
      dateExpression = 'پس‌فردا';
      dateReason = `تشخیص واژه «پس‌فردا» (${jalaliDate})`;
      isDefaultDate = false;
      dateNeedsConfirmation = false;
      relativePrefix = 'پس‌فردا';
    } else if (cleanDateSrc.includes('فردا')) {
      jalaliDate = addDaysToJalali(todayJalali, 1, true);
      dateExpression = 'فردا';
      dateReason = `تشخیص واژه «فردا» (${jalaliDate})`;
      isDefaultDate = false;
      dateNeedsConfirmation = false;
      relativePrefix = 'فردا';
    } else if (
      cleanDateSrc.includes('همین امروز') ||
      cleanDateSrc.includes('امروز') ||
      cleanDateSrc.includes('امشب')
    ) {
      jalaliDate = todayJalali;
      dateExpression = cleanDateSrc.includes('امشب') ? 'امشب' : 'امروز';
      dateReason = `تشخیص واژه «${dateExpression}» (${todayJalali})`;
      isDefaultDate = false;
      dateNeedsConfirmation = false;
      relativePrefix = 'امروز';
    } else if (nDaysMatch) {
      const n = parsePersianNumberToken(nDaysMatch[1]) || 2;
      jalaliDate = addDaysToJalali(todayJalali, n, true);
      dateExpression = `${toPersianDigits(n)} روز دیگر`;
      dateReason = `تشخیص عبارت «${dateExpression}»`;
      isDefaultDate = false;
      dateNeedsConfirmation = false;
      relativePrefix = `${toPersianDigits(n)} روز دیگر`;
    } else if (nWeeksMatch) {
      const w = parsePersianNumberToken(nWeeksMatch[1]) || 1;
      jalaliDate = addDaysToJalali(todayJalali, w * 7, true);
      dateExpression = `${toPersianDigits(w)} هفته دیگر`;
      dateReason = `تشخیص عبارت «${dateExpression}»`;
      isDefaultDate = false;
      dateNeedsConfirmation = false;
      relativePrefix = `${toPersianDigits(w)} هفته دیگر`;
    } else if (
      cleanDateSrc.includes('هفته بعد') ||
      cleanDateSrc.includes('هفته آینده') ||
      cleanDateSrc.includes('هفته ی بعد') ||
      cleanDateSrc.includes('هفته دیگر')
    ) {
      jalaliDate = addDaysToJalali(todayJalali, 7, true);
      dateExpression = 'هفته آینده';
      dateReason = `تشخیص عبارت «هفته آینده» (${jalaliDate})`;
      isDefaultDate = false;
      dateNeedsConfirmation = false;
      relativePrefix = 'هفته آینده';
    }
  }

  // 5. Check Persian Weekday names (شنبه، یکشنبه، دوشنبه، سه‌شنبه، چهارشنبه، پنجشنبه، جمعه)
  if (isDefaultDate) {
    // Check multi-char weekdays before 'شنبه' so 'یکشنبه' isn't matched as 'شنبه'
    for (const wk of PERSIAN_WEEKDAYS_MAP) {
      if (cleanDateSrc.includes(wk.name)) {
        const currentDay = now.getDay();
        let diff = (wk.jsDay - currentDay + 7) % 7;
        if (diff === 0) {
          diff = cleanDateSrc.includes('آینده') || cleanDateSrc.includes('بعد') ? 7 : 0;
        }
        jalaliDate = addDaysToJalali(todayJalali, diff, true);
        const cleanWkName = wk.name.replace(' ', '‌');
        dateExpression = cleanWkName;
        dateReason = `تشخیص روز هفته «${cleanWkName}» (${jalaliDate})`;
        isDefaultDate = false;
        dateNeedsConfirmation = false;
        relativePrefix = cleanWkName;
        break;
      }
    }
  }

  const humanPart = formatJalaliHuman(jalaliDate, !relativePrefix);
  const dateHumanLabel = relativePrefix ? `${relativePrefix} - ${humanPart}` : humanPart;

  // =========================================================================
  // TIME RESOLUTION
  // =========================================================================
  const combinedTimeSource = `${aiTimeExpr || ''} ${fullText}`.trim();
  const cleanTimeSrc = toEnglishDigits(combinedTimeSource).replace(/\u200c/g, ' ');

  let hours = 11;
  let minutes = 0;
  let isDefaultTime = true;
  let timeNeedsConfirmation = true;
  let timeExpression = aiTimeExpr?.trim() || '';
  let timeReason = 'ساعت مشخصی ذکر نشد (ساعت پیش‌فرض ۱۱:۰۰ قبل‌ازظهر)';

  const hasMorning =
    cleanTimeSrc.includes('صبح') ||
    cleanTimeSrc.includes('قبل از ظهر') ||
    cleanTimeSrc.includes('قبل ازظهر') ||
    cleanTimeSrc.includes('بامداد');
  const hasAfternoon =
    cleanTimeSrc.includes('عصر') ||
    cleanTimeSrc.includes('بعدازظهر') ||
    cleanTimeSrc.includes('بعد از ظهر') ||
    cleanTimeSrc.includes('غروب') ||
    cleanTimeSrc.includes('شب');
  const hasNoon = cleanTimeSrc.includes('ظهر') && !hasAfternoon && !hasMorning;
  const hasMidnight = cleanTimeSrc.includes('نیمه شب') || cleanTimeSrc.includes('نیمه‌شب');

  // Pattern A: "ربع به H"
  const quarterToMatch = cleanTimeSrc.match(
    /(?:یک\s*)?ربع\s*به\s*(\d{1,2}|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|یازده|دوازده)/
  );
  // Pattern B: "ساعت H و نیم" or "H و نیم"
  const halfPastMatch = cleanTimeSrc.match(
    /(?:ساعت\s*)?(\d{1,2}|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|یازده|دوازده)\s*و\s*نیم/
  );
  // Pattern C: "ساعت H و ربع"
  const quarterPastMatch = cleanTimeSrc.match(
    /(?:ساعت\s*)?(\d{1,2}|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|یازده|دوازده)\s*و\s*ربع/
  );
  // Pattern D: Explicit HH:MM or "ساعت H" or "صبح ساعت ۱۱" or "بعدازظهر ۴"
  const explicitHourMinMatch =
    cleanTimeSrc.match(/ساعت\s*(\d{1,2})(?::(\d{2}))?/) ||
    cleanTimeSrc.match(/(\d{1,2}):(\d{2})/) ||
    cleanTimeSrc.match(
      /(?:صبح|عصر|شب|بعدازظهر|بعد از ظهر|ظهر)\s*(?:ساعت\s*)?(\d{1,2})(?::(\d{2}))?/
    ) ||
    cleanTimeSrc.match(
      /ساعت\s*(یک|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه|ده|یازده|دوازده)/
    );

  if (quarterToMatch) {
    const targetH = parsePersianNumberToken(quarterToMatch[1]) || 12;
    hours = targetH - 1 <= 0 ? 11 : targetH - 1;
    minutes = 45;
    isDefaultTime = false;
    timeExpression = `ربع به ${toPersianDigits(targetH)}`;
  } else if (halfPastMatch) {
    hours = parsePersianNumberToken(halfPastMatch[1]) || 11;
    minutes = 30;
    isDefaultTime = false;
    timeExpression = `ساعت ${toPersianDigits(hours)} و نیم`;
  } else if (quarterPastMatch) {
    hours = parsePersianNumberToken(quarterPastMatch[1]) || 11;
    minutes = 15;
    isDefaultTime = false;
    timeExpression = `ساعت ${toPersianDigits(hours)} و ربع`;
  } else if (explicitHourMinMatch) {
    const parsedH = parsePersianNumberToken(explicitHourMinMatch[1]);
    if (parsedH !== null && parsedH >= 0 && parsedH <= 23) {
      hours = parsedH;
      minutes = explicitHourMinMatch[2] ? parseInt(explicitHourMinMatch[2], 10) : 0;
      isDefaultTime = false;
      timeExpression = `ساعت ${toPersianDigits(hours)}${
        minutes > 0 ? `:${toPersianDigits(String(minutes).padStart(2, '0'))}` : ''
      }`;
    }
  } else if (hasNoon) {
    hours = 12;
    minutes = 0;
    isDefaultTime = false;
    timeExpression = 'ظهر (۱۲:۰۰)';
  } else if (hasMidnight) {
    hours = 0;
    minutes = 0;
    isDefaultTime = false;
    timeExpression = 'نیمه‌شب (۰۰:۰۰)';
  }

  if (!isDefaultTime) {
    if (hours < 12 && hasAfternoon) {
      hours += 12;
      timeNeedsConfirmation = false;
    } else if (hours === 12 && hasMorning) {
      hours = 0;
      timeNeedsConfirmation = false;
    } else if (hasMorning || hasAfternoon || hasNoon || hasMidnight || hours >= 13) {
      timeNeedsConfirmation = false;
    } else {
      // Hour 1..12 without explicit morning/afternoon
      if (hours >= 1 && hours <= 6) {
        hours += 12; // 1..6 in real estate calls defaults to afternoon (13:00..18:00), flagged for confirmation
      }
      timeNeedsConfirmation = true;
    }
    timeReason = timeNeedsConfirmation
      ? `تشخیص «${timeExpression}» (بدون ذکر صبح/عصر — لطفاً تأیید کنید)`
      : `تشخیص دقیق زمان «${timeExpression}»`;
  }

  const hStr = String(hours).padStart(2, '0');
  const mStr = String(minutes).padStart(2, '0');
  const time = `${hStr}:${mStr}`;
  const periodLabel =
    hours === 0
      ? 'نیمه‌شب'
      : hours < 12
      ? 'قبل‌ازظهر'
      : hours === 12
      ? 'ظهر'
      : hours < 16
      ? 'بعدازظهر'
      : hours < 20
      ? 'عصر'
      : 'شب';
  const displayHour12 = hours % 12 === 0 ? 12 : hours % 12;
  const timeDisplay = `${toPersianDigits(String(displayHour12).padStart(2, '0'))}:${toPersianDigits(
    mStr
  )} ${periodLabel}`;

  // Check if resolved date+time is in the past
  let isPastDateTime = false;
  const cmpDay = compareJalaliDates(jalaliDate, todayJalali);
  if (cmpDay < 0) {
    isPastDateTime = true;
  } else if (cmpDay === 0) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const targetMinutes = hours * 60 + minutes;
    if (targetMinutes < nowMinutes) {
      isPastDateTime = true;
    }
  }

  if (isPastDateTime) {
    dateNeedsConfirmation = true;
    timeNeedsConfirmation = true;
  }

  return {
    jalaliDate,
    dateHumanLabel,
    dateExpression: dateExpression || 'فردا (پیش‌فرض)',
    dateReason,
    isDefaultDate,
    dateNeedsConfirmation,
    time,
    timeDisplay,
    timeExpression: timeExpression || '۱۱:۰۰ (پیش‌فرض)',
    timeReason,
    isDefaultTime,
    timeNeedsConfirmation,
    isPastDateTime,
  };
}

/**
 * Fuzzy matches properties, applicants, and collaborators from the real database catalog.
 */
export function matchEntitiesFromCatalog(
  transcript: string,
  catalog: EntitiesCatalog,
  aiLinkedFileHint?: string,
  aiLinkedContactHint?: string
): {
  matchedProperty?: MatchedPropertyItem;
  propertyCandidates: MatchedPropertyItem[];
  matchedContact?: MatchedContactItem;
  contactCandidates: MatchedContactItem[];
  matchedCodes: string[];
} {
  const combinedSource = `${transcript} ${aiLinkedFileHint || ''} ${aiLinkedContactHint || ''}`;
  const normText = normalizePersianText(combinedSource);
  const cleanEng = toEnglishDigits(combinedSource).toUpperCase();

  const stripHonorifics = (s: string) =>
    normalizePersianText(s)
      .replace(
        /\b(اقای|اقا|خانم|مهندس|دکتر|حاج|جناب|استاد|مشتری|همکار|دفتر|املاک|پرونده|فایل|کد)\b/g,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();

  // 1. Score Properties
  const propScores: MatchedPropertyItem[] = [];
  for (const prop of catalog.properties) {
    let score = 0;
    const codeUpper = (prop.code || '').toUpperCase();
    const codeDigits = codeUpper.replace(/^F-0*/, '');

    if (
      codeUpper &&
      (cleanEng.includes(codeUpper) ||
        new RegExp(`\\bF\\s*[-]?\\s*0*${codeDigits}\\b`, 'i').test(cleanEng))
    ) {
      score += 100;
    }

    const normTitle = normalizePersianText(prop.title);
    if (normTitle && normText.includes(normTitle)) {
      score += 75;
    } else {
      const titleTokens = normTitle.split(' ').filter((w) => w.length >= 3);
      let matchedTokens = 0;
      for (const tk of titleTokens) {
        if (normText.includes(tk)) matchedTokens++;
      }
      if (matchedTokens >= 2) score += matchedTokens * 22;
    }

    const normCity = normalizePersianText(prop.city);
    if (normCity && normText.includes(normCity)) {
      score += 25;
    }

    if (prop.area && cleanEng.includes(String(prop.area))) {
      score += 30;
    }

    if (score >= 35) {
      propScores.push({
        id: prop.id,
        code: prop.code,
        title: prop.title,
        city: prop.city,
        area: prop.area,
        score,
      });
    }
  }
  propScores.sort((a, b) => b.score - a.score);

  // 2. Score Contacts (Applicants & Collaborators)
  const contactScores: MatchedContactItem[] = [];

  for (const app of catalog.applicants) {
    let score = 0;
    const codeUpper = (app.code || '').toUpperCase();
    const codeDigits = codeUpper.replace(/^C-0*/, '');
    if (
      codeUpper &&
      (cleanEng.includes(codeUpper) ||
        new RegExp(`\\bC\\s*[-]?\\s*0*${codeDigits}\\b`, 'i').test(cleanEng))
    ) {
      score += 100;
    }

    const cleanName = stripHonorifics(app.name);
    if (cleanName && normText.includes(cleanName)) {
      score += 85;
    } else {
      const nameParts = cleanName.split(' ').filter((p) => p.length >= 3);
      for (const part of nameParts) {
        if (normText.includes(part)) {
          score += 50;
        } else if (part.length >= 4 && normText.includes(part.slice(0, part.length - 1))) {
          // Fuzzy stem match e.g. رضوان <-> رضوانی
          score += 42;
        }
      }
    }

    if (score >= 40) {
      contactScores.push({
        id: app.id,
        code: app.code,
        name: app.name,
        subtitle: `متقاضی (${app.code})`,
        type: 'applicant',
        phone: app.phone,
        score,
      });
    }
  }

  for (const col of catalog.collaborators) {
    let score = 0;
    const codeUpper = (col.code || '').toUpperCase();
    const codeDigits = codeUpper.replace(/^H-0*/, '');
    if (
      codeUpper &&
      (cleanEng.includes(codeUpper) ||
        new RegExp(`\\bH\\s*[-]?\\s*0*${codeDigits}\\b`, 'i').test(cleanEng))
    ) {
      score += 100;
    }

    const cleanName = stripHonorifics(col.name);
    if (cleanName && normText.includes(cleanName)) {
      score += 85;
    } else {
      const nameParts = cleanName.split(' ').filter((p) => p.length >= 3);
      for (const part of nameParts) {
        if (normText.includes(part)) {
          score += 50;
        } else if (part.length >= 4 && normText.includes(part.slice(0, part.length - 1))) {
          score += 42;
        }
      }
    }

    if (col.agencyName) {
      const cleanAgency = stripHonorifics(col.agencyName);
      if (cleanAgency && cleanAgency.length >= 3 && normText.includes(cleanAgency)) {
        score += 45;
      }
    }

    if (score >= 40) {
      contactScores.push({
        id: col.id,
        code: col.code,
        name: col.name,
        subtitle: `${col.agencyName ? `${col.agencyName} • ` : ''}${col.code}`,
        type: 'collaborator',
        phone: col.phone,
        score,
      });
    }
  }

  contactScores.sort((a, b) => b.score - a.score);

  const matchedCodes: string[] = [];
  if (propScores[0]) matchedCodes.push(propScores[0].code);
  if (contactScores[0]) matchedCodes.push(contactScores[0].code);

  // Also capture any explicit F-xxx / C-xxx / H-xxx codes mentioned in text even if not in DB yet
  const rawCodeMatches = cleanEng.match(/\b([FCHR]-\d{2,4})\b/g) || [];
  for (const rc of rawCodeMatches) {
    if (!matchedCodes.includes(rc)) matchedCodes.push(rc);
  }

  return {
    matchedProperty: propScores[0],
    propertyCandidates: propScores.slice(0, 4),
    matchedContact: contactScores[0],
    contactCandidates: contactScores.slice(0, 4),
    matchedCodes,
  };
}

/**
 * Deterministic Persian NLP extraction for actions, priority, and summary.
 */
export function localExtractReminderFromText(
  transcript: string,
  knownEntitiesOrCatalog:
    | Array<{ code: string; name: string }>
    | EntitiesCatalog = []
): StructuredReminderExtraction {
  const catalog: EntitiesCatalog = Array.isArray(knownEntitiesOrCatalog)
    ? {
        properties: knownEntitiesOrCatalog
          .filter((e) => e.code.startsWith('F-'))
          .map(
            (e) =>
              ({
                id: e.code,
                code: e.code,
                title: e.name,
                city: '',
                area: 0,
              } as PropertyRecord)
          ),
        applicants: knownEntitiesOrCatalog
          .filter((e) => e.code.startsWith('C-'))
          .map(
            (e) =>
              ({
                id: e.code,
                code: e.code,
                name: e.name,
                cities: [],
              } as unknown as ApplicantRecord)
          ),
        collaborators: knownEntitiesOrCatalog
          .filter((e) => e.code.startsWith('H-'))
          .map(
            (e) =>
              ({
                id: e.code,
                code: e.code,
                name: e.name,
                neighborhoods: [],
              } as unknown as CollaboratorRecord)
          ),
      }
    : knownEntitiesOrCatalog;

  const dt = resolvePersianDateTimeDeterministically(transcript);
  const entityMatch = matchEntitiesFromCatalog(transcript, catalog);

  // Action Categories Detection
  const categories: ReminderCategory[] = [];
  if (
    transcript.includes('تماس') ||
    transcript.includes('زنگ') ||
    transcript.includes('تلفن') ||
    transcript.includes('صحبت')
  ) {
    categories.push('phone');
  }
  if (
    transcript.includes('استعلام') ||
    transcript.includes('سند') ||
    transcript.includes('تک‌برگ') ||
    transcript.includes('تک برگ') ||
    transcript.includes('جواز') ||
    transcript.includes('بنیاد') ||
    transcript.includes('ثبت')
  ) {
    categories.push('inquiry');
  }
  if (
    transcript.includes('بازدید') ||
    transcript.includes('حضوری') ||
    transcript.includes('سر زمین') ||
    transcript.includes('لوکیشن') ||
    transcript.includes('معرفی حضوری')
  ) {
    categories.push('visit');
  }
  if (
    transcript.includes('چک') ||
    transcript.includes('کمیسیون') ||
    transcript.includes('مالی') ||
    transcript.includes('پرداخت') ||
    transcript.includes('تسویه') ||
    transcript.includes('بیعانه') ||
    transcript.includes('تضمین')
  ) {
    categories.push('finance');
  }
  if (
    transcript.includes('مدارک') ||
    transcript.includes('ارسال') ||
    transcript.includes('فایل') ||
    transcript.includes('پکیج') ||
    transcript.includes('کروکی')
  ) {
    categories.push('documents');
  }
  if (
    transcript.includes('جلسه') ||
    transcript.includes('مذاکره') ||
    transcript.includes('نشست') ||
    transcript.includes('قرارداد') ||
    transcript.includes('امضا')
  ) {
    categories.push('meeting');
  }

  if (categories.length === 0) {
    categories.push('phone');
  }

  // Priority Detection with reason
  let priority: 'urgent' | 'normal' | 'low' = 'normal';
  let priorityReason = 'اولویت استاندارد کاری';

  const urgentKeywords = [
    'فوری',
    'خیلی فوری',
    'فوریه',
    'بحرانی',
    'حتماً',
    'حتما',
    'ضروری',
    'ضرب‌الاجل',
    'مهلت',
    'همین امروز',
    'سریع',
  ];
  const lowKeywords = ['کم‌اهمیت', 'کم اهمیت', 'غیرفوری', 'سر فرصت', 'هر وقت شد'];

  const foundUrgent = urgentKeywords.find((kw) => transcript.includes(kw));
  const foundLow = lowKeywords.find((kw) => transcript.includes(kw));

  if (foundUrgent) {
    priority = 'urgent';
    priorityReason = `تشخیص واژه «${foundUrgent}» در متن`;
  } else if (foundLow) {
    priority = 'low';
    priorityReason = `تشخیص واژه «${foundLow}» در متن`;
  }

  // Build concise, meaningful title & summary
  const actionLabelMap: Record<ReminderCategory, string> = {
    phone: 'تماس تلفنی',
    inquiry: 'استعلام سند',
    visit: 'بازدید حضوری',
    finance: 'پیگیری مالی',
    documents: 'ارسال مدارک',
    meeting: 'جلسه مذاکره',
  };
  const primaryActionLabel = actionLabelMap[categories[0]] || 'پیگیری';
  const contactPart = entityMatch.matchedContact ? ` با ${entityMatch.matchedContact.name}` : '';
  const propPart = entityMatch.matchedProperty
    ? ` (پرونده ${entityMatch.matchedProperty.code})`
    : '';

  const autoTitle =
    entityMatch.matchedContact || entityMatch.matchedProperty
      ? `${primaryActionLabel}${contactPart}${propPart}`
      : transcript.length > 52
      ? transcript.substring(0, 52).trim() + '...'
      : transcript.trim() || 'یادآور هوشمند کلید';

  const summary = `${ categories.map((c) => actionLabelMap[c]).join(' و ')}${contactPart}${
    entityMatch.matchedProperty
      ? ` درباره ${entityMatch.matchedProperty.title} (${entityMatch.matchedProperty.code})`
      : ''
  } — ${dt.dateHumanLabel} ساعت ${dt.timeDisplay}`;

  const aiFilledFields: string[] = ['categories', 'priority'];
  if (!dt.isDefaultDate) aiFilledFields.push('jalaliDate');
  if (!dt.isDefaultTime) aiFilledFields.push('time');
  if (entityMatch.matchedProperty) aiFilledFields.push('linkedProperty');
  if (entityMatch.matchedContact) aiFilledFields.push('linkedContact');

  return {
    transcript,
    title: autoTitle,
    summary,
    jalaliDate: dt.jalaliDate,
    dateHumanLabel: dt.dateHumanLabel,
    dateExpression: dt.dateExpression,
    dateReason: dt.dateReason,
    isDefaultDate: dt.isDefaultDate,
    dateNeedsConfirmation: dt.dateNeedsConfirmation,
    time: dt.time,
    timeDisplay: dt.timeDisplay,
    timeExpression: dt.timeExpression,
    timeReason: dt.timeReason,
    isDefaultTime: dt.isDefaultTime,
    timeNeedsConfirmation: dt.timeNeedsConfirmation,
    isPastDateTime: dt.isPastDateTime,
    categories,
    priority,
    priorityReason,
    matchedCodes: entityMatch.matchedCodes,
    unknownEntities: [],
    matchedProperty: entityMatch.matchedProperty,
    propertyCandidates: entityMatch.propertyCandidates,
    matchedContact: entityMatch.matchedContact,
    contactCandidates: entityMatch.contactCandidates,
    aiFilledFields,
    usedGemini: false,
    confidence: {
      transcript: 0.9,
      linkedFile: entityMatch.matchedProperty ? 0.92 : 0.4,
      linkedContact: entityMatch.matchedContact ? 0.92 : 0.4,
      actions: 0.9,
      dateTime: !dt.isDefaultDate && !dt.isDefaultTime ? 0.95 : 0.65,
      priority: foundUrgent || foundLow ? 0.95 : 0.75,
    },
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

  const cities = [
    'کلارآباد',
    'متل قو',
    'متل‌قو',
    'سلمان‌شهر',
    'چالوس',
    'نمک‌آبرود',
    'نوشهر',
    'عباس‌آباد',
    'رامسر',
    'تنکابن',
  ];
  for (const c of cities) {
    if (query.includes(c)) {
      result.city = c;
      break;
    }
  }

  const areaMatch = clean.match(/(\d{2,4})\s*متر/);
  if (areaMatch) {
    const a = parseInt(areaMatch[1], 10);
    result.minArea = Math.round(a * 0.85);
    result.maxArea = Math.round(a * 1.15);
  }

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

  const stopWords = [
    'یه',
    'یک',
    'زیر',
    'بالای',
    'تا',
    'حداکثر',
    'حداقل',
    'متر',
    'متری',
    'میلیارد',
    'تومان',
    'در',
    'با',
  ];
  const tokens = clean
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !stopWords.includes(t) && !/^\d+$/.test(t));

  result.keywords = tokens;
  return result;
}

const REMINDER_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transcript: {
      type: Type.STRING,
      description: 'متن کامل و دقیق فارسی گفته‌شده در فایل صوتی یا متن ورودی',
    },
    summary: {
      type: Type.STRING,
      description: 'خلاصه یک‌خطی کوتاه و حرفه‌ای برای عنوان یادآور و تقویم',
    },
    linkedFile: {
      type: Type.STRING,
      description: 'کد یا نام پرونده ملکی ذکرشده در متن (مثلاً F-002 یا زمین کلارآباد)',
    },
    linkedContact: {
      type: Type.STRING,
      description: 'نام یا کد مخاطب، مشتری یا همکار ذکرشده (مثلاً آقای رضوان یا H-003)',
    },
    actions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'لیست اقدامات از بین: phone_call, document_inquiry, site_visit, financial_followup, send_documents, negotiation_meeting',
    },
    dateExpression: {
      type: Type.STRING,
      description: 'عبارت زمانی خام ذکرشده برای روز (مثلاً فردا، پس‌فردا، شنبه آینده، ۲۵ مهر)',
    },
    timeExpression: {
      type: Type.STRING,
      description: 'عبارت خام ساعت ذکرشده (مثلاً صبح ساعت ۱۱، بعدازظهر ۴، ساعت ۸ شب)',
    },
    priority: {
      type: Type.STRING,
      description: 'سطح اولویت: critical یا normal یا low',
    },
    priorityReason: {
      type: Type.STRING,
      description: 'دلیل کوتاه انتخاب این سطح اولویت',
    },
  },
  required: ['transcript', 'summary', 'actions', 'priority'],
};

function mapAiActionsToCategories(actions: string[] | undefined): ReminderCategory[] {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  const mapped: ReminderCategory[] = [];
  for (const a of actions) {
    const key = String(a).toLowerCase();
    if (key.includes('phone') || key.includes('call') || key.includes('تماس')) {
      if (!mapped.includes('phone')) mapped.push('phone');
    } else if (key.includes('inquiry') || key.includes('deed') || key.includes('استعلام')) {
      if (!mapped.includes('inquiry')) mapped.push('inquiry');
    } else if (key.includes('visit') || key.includes('site') || key.includes('بازدید')) {
      if (!mapped.includes('visit')) mapped.push('visit');
    } else if (key.includes('financ') || key.includes('check') || key.includes('مالی')) {
      if (!mapped.includes('finance')) mapped.push('finance');
    } else if (key.includes('doc') || key.includes('send') || key.includes('مدارک')) {
      if (!mapped.includes('documents')) mapped.push('documents');
    } else if (key.includes('meet') || key.includes('negotiat') || key.includes('جلسه')) {
      if (!mapped.includes('meeting')) mapped.push('meeting');
    }
  }
  return mapped;
}

function mergeGeminiDataWithDeterministicEngine(
  data: any,
  fallbackText: string,
  catalog: EntitiesCatalog
): StructuredReminderExtraction {
  const finalTranscript = (data?.transcript || fallbackText || '').trim();
  const base = localExtractReminderFromText(finalTranscript, catalog);

  const dt = resolvePersianDateTimeDeterministically(
    finalTranscript,
    data?.dateExpression,
    data?.timeExpression
  );

  const entityMatch = matchEntitiesFromCatalog(
    finalTranscript,
    catalog,
    data?.linkedFile,
    data?.linkedContact
  );

  const aiCats = mapAiActionsToCategories(data?.actions);
  const mergedCategories = Array.from(new Set([...aiCats, ...base.categories]));

  let priority: 'urgent' | 'normal' | 'low' = base.priority;
  if (data?.priority === 'critical' || data?.priority === 'urgent') {
    priority = 'urgent';
  } else if (data?.priority === 'low' && base.priority !== 'urgent') {
    priority = 'low';
  }

  const aiFilledFields = new Set<string>(base.aiFilledFields);
  aiFilledFields.add('transcript');
  aiFilledFields.add('categories');
  aiFilledFields.add('priority');
  if (!dt.isDefaultDate) aiFilledFields.add('jalaliDate');
  if (!dt.isDefaultTime) aiFilledFields.add('time');
  if (entityMatch.matchedProperty) aiFilledFields.add('linkedProperty');
  if (entityMatch.matchedContact) aiFilledFields.add('linkedContact');

  return {
    ...base,
    transcript: finalTranscript,
    title: data?.summary || base.title,
    summary: data?.summary || base.summary,
    jalaliDate: dt.jalaliDate,
    dateHumanLabel: dt.dateHumanLabel,
    dateExpression: dt.dateExpression,
    dateReason: dt.dateReason,
    isDefaultDate: dt.isDefaultDate,
    dateNeedsConfirmation: dt.dateNeedsConfirmation,
    time: dt.time,
    timeDisplay: dt.timeDisplay,
    timeExpression: dt.timeExpression,
    timeReason: dt.timeReason,
    isDefaultTime: dt.isDefaultTime,
    timeNeedsConfirmation: dt.timeNeedsConfirmation,
    isPastDateTime: dt.isPastDateTime,
    categories: mergedCategories.length > 0 ? mergedCategories : ['phone'],
    priority,
    priorityReason: data?.priorityReason || base.priorityReason,
    matchedProperty: entityMatch.matchedProperty,
    propertyCandidates: entityMatch.propertyCandidates,
    matchedContact: entityMatch.matchedContact,
    contactCandidates: entityMatch.contactCandidates,
    matchedCodes: entityMatch.matchedCodes,
    aiFilledFields: Array.from(aiFilledFields),
    usedGemini: true,
    confidence: {
      transcript: 0.98,
      linkedFile: entityMatch.matchedProperty ? 0.96 : 0.5,
      linkedContact: entityMatch.matchedContact ? 0.96 : 0.5,
      actions: 0.95,
      dateTime: !dt.isDefaultDate && !dt.isDefaultTime ? 0.98 : 0.72,
      priority: 0.94,
    },
  };
}

export const aiService = {
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const client = getBrowserGenAIClient();
    if (!client) {
      return {
        ok: false,
        message: 'کلید Gemini در تنظیمات ثبت نشده است (موتور تحلیلگر فارسی آفلاین فعال است).',
      };
    }
    if (!navigator.onLine) {
      return { ok: false, message: 'آفلاین — پردازشگر محلی فعال است' };
    }
    try {
      const resp = await client.models.generateContent({
        model: 'gemini-flash-latest',
        contents: 'پاسخ کوتاه بده: متصل شد',
      });
      if (resp.text) {
        return { ok: true, message: 'متصل به موتور هوش مصنوعی Gemini' };
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
        model: 'gemini-flash-latest',
        contents: [
          {
            inlineData: {
              data: base64,
              mimeType: (blob.type || 'audio/webm').split(';')[0].trim(),
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

  /**
   * Multimodal Audio + Text -> Structured Reminder Extraction via Gemini + Deterministic Jalali Resolver
   */
  async transcribeAndExtractVoiceReminder(
    audioBlob: Blob | null,
    liveTranscript: string,
    catalog: EntitiesCatalog
  ): Promise<StructuredReminderExtraction> {
    const client = getBrowserGenAIClient();
    const catalogSummary = [
      ...catalog.properties.slice(0, 25).map((p) => `${p.code}: ${p.title} (${p.city})`),
      ...catalog.applicants.slice(0, 25).map((a) => `${a.code}: ${a.name} (متقاضی)`),
      ...catalog.collaborators.slice(0, 25).map((c) => `${c.code}: ${c.name} (همکار)`),
    ];

    if (!client || !navigator.onLine) {
      return localExtractReminderFromText(liveTranscript, catalog);
    }

    try {
      const parts: any[] = [];
      if (audioBlob && audioBlob.size > 400) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const res = String(reader.result || '');
            resolve(res.includes(',') ? res.split(',')[1] : res);
          };
          reader.onerror = reject;
          reader.readAsDataURL(audioBlob);
        });
        parts.push({
          inlineData: {
            data: base64,
            mimeType: (audioBlob.type || 'audio/webm').split(';')[0].trim() || 'audio/webm',
          },
        });
      }

      parts.push({
        text: `شما دستیار هوشمند مدیریت املاک لوکس «کلید» هستید.
${liveTranscript ? `متن اولیه تشخیص گفتار مرورگر: "${liveTranscript}"` : ''}
فهرست پرونده‌ها و مخاطبان موجود در سامانه:
${catalogSummary.join('\n')}

وظیفه:
۱. اگر فایل صوتی پیوست شده، متن دقیق فارسی آن را رونویسی کن (و اگر فقط متن اولیه هست همان را اصلاح و تکمیل کن).
۲. خلاصه یک‌خطی کوتاه برای عنوان یادآور بنویس.
۳. کد یا نام پرونده ملکی (linkedFile) و نام یا کد مخاطب/همکار (linkedContact) ذکرشده را استخراج کن.
۴. دسته‌بندی اقدامات (actions) را از بین phone_call, document_inquiry, site_visit, financial_followup, send_documents, negotiation_meeting مشخص کن.
۵. عبارت خام تاریخ (dateExpression مثل "فردا"، "پس‌فردا"، "شنبه آینده"، "۲۵ مهر") و عبارت خام ساعت (timeExpression مثل "ساعت ۱۱ صبح"، "۴ عصر") را دقیقاً همان‌طور که گفته شده استخراج کن.
۶. اولویت (priority: critical | normal | low) و دلیل کوتاه آن را مشخص کن.`,
      });

      const response = await client.models.generateContent({
        model: 'gemini-flash-latest',
        contents: [{ parts }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: REMINDER_EXTRACTION_SCHEMA,
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      return mergeGeminiDataWithDeterministicEngine(parsed, liveTranscript, catalog);
    } catch {
      return localExtractReminderFromText(liveTranscript, catalog);
    }
  },

  async extractReminderFromTranscript(
    transcript: string,
    knownEntitiesOrCatalog:
      | Array<{ code: string; name: string }>
      | EntitiesCatalog = []
  ): Promise<StructuredReminderExtraction> {
    const catalog: EntitiesCatalog = Array.isArray(knownEntitiesOrCatalog)
      ? {
          properties: knownEntitiesOrCatalog
            .filter((e) => e.code.startsWith('F-'))
            .map(
              (e) =>
                ({
                  id: e.code,
                  code: e.code,
                  title: e.name,
                  city: '',
                  area: 0,
                } as PropertyRecord)
            ),
          applicants: knownEntitiesOrCatalog
            .filter((e) => e.code.startsWith('C-'))
            .map(
              (e) =>
                ({
                  id: e.code,
                  code: e.code,
                  name: e.name,
                  cities: [],
                } as unknown as ApplicantRecord)
            ),
          collaborators: knownEntitiesOrCatalog
            .filter((e) => e.code.startsWith('H-'))
            .map(
              (e) =>
                ({
                  id: e.code,
                  code: e.code,
                  name: e.name,
                  neighborhoods: [],
                } as unknown as CollaboratorRecord)
            ),
        }
      : knownEntitiesOrCatalog;

    return this.transcribeAndExtractVoiceReminder(null, transcript, catalog);
  },

  async parseNaturalSearch(query: string, _scope = 'global'): Promise<ParsedNaturalSearch> {
    const local = localParseNaturalSearch(query);
    const client = getBrowserGenAIClient();
    if (!client || !navigator.onLine || query.trim().split(/\s+/).length < 3) {
      return local;
    }
    try {
      const response = await client.models.generateContent({
        model: 'gemini-flash-latest',
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
        model: 'gemini-flash-latest',
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
