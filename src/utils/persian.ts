// Comprehensive Persian, Jalali Date, Currency (Toman), Words & Validation Utilities

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toPersianDigits(input: string | number | undefined | null): string {
  if (input === undefined || input === null) return '';
  return String(input)
    .replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)])
    .replace(/[٠-٩]/g, (d) => PERSIAN_DIGITS[ARABIC_DIGITS.indexOf(d)]);
}

export function toEnglishDigits(input: string | number | undefined | null): string {
  if (input === undefined || input === null) return '';
  let str = String(input);
  for (let i = 0; i < 10; i++) {
    str = str.replace(new RegExp(PERSIAN_DIGITS[i], 'g'), String(i));
    str = str.replace(new RegExp(ARABIC_DIGITS[i], 'g'), String(i));
  }
  return str;
}

export function parseNumericInput(input: string | number | undefined | null): number {
  if (typeof input === 'number') return isFinite(input) ? input : 0;
  if (!input) return 0;
  const cleaned = toEnglishDigits(String(input)).replace(/[^0-9.]/g, '');
  const num = Number(cleaned);
  return isFinite(num) ? num : 0;
}

export function formatWithSeparator(num: number | string | undefined | null, persian = true): string {
  const n = parseNumericInput(num);
  if (!n && n !== 0) return '';
  if (n === 0 && (num === '' || num === undefined || num === null)) return '';
  const formatted = Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return persian ? toPersianDigits(formatted) : formatted.replace(/٬/g, ',');
}

export function formatToman(amount: number | string | undefined | null): string {
  const n = parseNumericInput(amount);
  if (!n) return '۰ تومان';
  return `${formatWithSeparator(n, true)} تومان`;
}

export function normalizePersianText(text: string | undefined | null): string {
  if (!text) return '';
  return toEnglishDigits(text)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/إ|أ|آ/g, 'ا')
    .replace(/\u200c/g, ' ') // ZWNJ to space
    .replace(/[٬,،\-_/\\()«»"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Accurate Persian Number-to-Words Converter
const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', 'ده', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'هزار میلیارد'];

function threeDigitsToWords(n: number): string {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(HUNDREDS[h]);
  if (rem >= 10 && rem < 20) {
    parts.push(TEENS[rem - 10]);
  } else {
    const t = Math.floor(rem / 10);
    const o = rem % 10;
    if (t > 0) parts.push(TENS[t]);
    if (o > 0) parts.push(ONES[o]);
  }
  return parts.join(' و ');
}

export function numberToPersianWords(input: number | string | undefined | null): string {
  const num = Math.floor(Math.abs(parseNumericInput(input)));
  if (num === 0) return 'صفر';
  const parts: string[] = [];
  let remaining = num;
  let scaleIdx = 0;

  while (remaining > 0 && scaleIdx < SCALES.length) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const chunkWords = threeDigitsToWords(chunk);
      const scale = SCALES[scaleIdx];
      parts.unshift(scale ? `${chunkWords} ${scale}` : chunkWords);
    }
    remaining = Math.floor(remaining / 1000);
    scaleIdx++;
  }
  return parts.join(' و ');
}

export function amountToTomanWords(input: number | string | undefined | null): string {
  const n = parseNumericInput(input);
  if (!n || n <= 0) return '';
  return `${numberToPersianWords(n)} تومان`;
}

export function areaToPersianWords(input: number | string | undefined | null): string {
  const n = parseNumericInput(input);
  if (!n || n <= 0) return '';
  return `${numberToPersianWords(n)} متر مربع`;
}

export function rangeToTomanWords(minVal: number | string | undefined, maxVal: number | string | undefined): string {
  const min = parseNumericInput(minVal);
  const max = parseNumericInput(maxVal);
  if (min > 0 && max > 0) {
    // Simplify scale if both are in billions or millions
    if (min % 1_000_000_000 === 0 && max % 1_000_000_000 === 0) {
      return `${numberToPersianWords(min / 1_000_000_000)} تا ${numberToPersianWords(max / 1_000_000_000)} میلیارد تومان`;
    }
    return `${numberToPersianWords(min)} تا ${numberToPersianWords(max)} تومان`;
  }
  if (max > 0) return `تا ${numberToPersianWords(max)} تومان`;
  if (min > 0) return `از ${numberToPersianWords(min)} تومان`;
  return '';
}

export function rangeToAreaWords(minVal: number | string | undefined, maxVal: number | string | undefined): string {
  const min = parseNumericInput(minVal);
  const max = parseNumericInput(maxVal);
  if (min > 0 && max > 0) {
    return `«${numberToPersianWords(min)} تا ${numberToPersianWords(max)} مترمربع»`;
  }
  if (max > 0) return `«تا ${numberToPersianWords(max)} مترمربع»`;
  if (min > 0) return `«حداقل ${numberToPersianWords(min)} مترمربع»`;
  return '';
}

// Iranian Mobile Validation
export function validateIranianMobile(phone: string | undefined | null): boolean {
  if (!phone) return false;
  const clean = toEnglishDigits(phone).replace(/\s|-/g, '');
  return /^09\d{9}$/.test(clean);
}

export function formatPhoneDisplay(phone: string | undefined | null): string {
  if (!phone) return '';
  return toPersianDigits(toEnglishDigits(phone).replace(/\s+/g, ''));
}

// Jalali <-> Gregorian Date Conversion (Exact Borkowski / Jalaali Algorithm)
const JALALI_MONTH_NAMES = [
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

const PERSIAN_WEEKDAYS = [
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
  'شنبه',
];

export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  const jy1 = jy + 1595;
  let days =
    -355668 +
    365 * jy1 +
    Math.floor(jy1 / 33) * 8 +
    Math.floor(((jy1 % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && gd > sal_a[gm]; gm++) {
    gd -= sal_a[gm];
  }
  return [gy, gm, gd];
}

export function formatJalaliString(jy: number, jm: number, jd: number, persianDigits = true): string {
  const s = `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  return persianDigits ? toPersianDigits(s) : s;
}

export function parseJalaliString(jStr: string | undefined | null): [number, number, number] | null {
  if (!jStr) return null;
  const clean = toEnglishDigits(jStr).trim();
  const match = clean.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!match) return null;
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  return [jy, jm, jd];
}

export function jalaliToDateObject(jStr: string, timeStr = '09:00'): Date | null {
  const parsed = parseJalaliString(jStr);
  if (!parsed) return null;
  const [gy, gm, gd] = jalaliToGregorian(parsed[0], parsed[1], parsed[2]);
  const cleanTime = toEnglishDigits(timeStr);
  const timeMatch = cleanTime.match(/(\d{1,2}):(\d{2})/);
  const hours = timeMatch ? Number(timeMatch[1]) : 9;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;
  return new Date(gy, gm - 1, gd, hours, minutes, 0);
}

export function getTodayJalali(persianDigits = true): string {
  const now = new Date();
  const [jy, jm, jd] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return formatJalaliString(jy, jm, jd, persianDigits);
}

export function getTodayJalaliReadable(): string {
  const now = new Date();
  const [jy, jm, jd] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const weekday = PERSIAN_WEEKDAYS[now.getDay()];
  return `${weekday}، ${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(jy)}`;
}

export function getTodayDashChip(): string {
  const now = new Date();
  const [jy, jm, jd] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return `امروز، ${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(jy)}`;
}

export function formatJalaliHuman(jStr: string | undefined | null, includeWeekday = false): string {
  const parsed = parseJalaliString(jStr);
  if (!parsed) return jStr ? toPersianDigits(jStr) : '';
  const [jy, jm, jd] = parsed;
  const dObj = jalaliToDateObject(jStr!);
  const weekday = includeWeekday && dObj ? `${PERSIAN_WEEKDAYS[dObj.getDay()]} - ` : '';
  return `${weekday}${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(jy)}`;
}

export function addDaysToJalali(baseJalali: string, daysToAdd: number, persianDigits = true): string {
  const dObj = jalaliToDateObject(baseJalali) || new Date();
  dObj.setDate(dObj.getDate() + daysToAdd);
  const [jy, jm, jd] = gregorianToJalali(dObj.getFullYear(), dObj.getMonth() + 1, dObj.getDate());
  return formatJalaliString(jy, jm, jd, persianDigits);
}

export function compareJalaliDates(a: string | undefined | null, b: string | undefined | null): number {
  const pa = parseJalaliString(a);
  const pb = parseJalaliString(b);
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  const na = pa[0] * 10000 + pa[1] * 100 + pa[2];
  const nb = pb[0] * 10000 + pb[1] * 100 + pb[2];
  return na - nb;
}

export function isJalaliDateOverdue(jStr: string | undefined | null): boolean {
  if (!jStr) return false;
  const today = getTodayJalali(false);
  return compareJalaliDates(jStr, today) < 0;
}

export function isCurrentJalaliMonth(jStr: string | undefined | null): boolean {
  const parsed = parseJalaliString(jStr);
  if (!parsed) return false;
  const now = new Date();
  const [ty, tm] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return parsed[0] === ty && parsed[1] === tm;
}

export function getRelativeTimePersian(isoTimestamp: string | number | undefined | null): string {
  if (!isoTimestamp) return 'هنوز پشتیبان‌گیری نشده';
  const date = new Date(isoTimestamp);
  if (isNaN(date.getTime())) return 'نامشخص';
  const [jy, jm, jd] = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const jalaliStr = formatJalaliString(jy, jm, jd, true);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let rel = 'همین الان';
  if (diffMins >= 1 && diffMins < 60) rel = `${toPersianDigits(diffMins)} دقیقه پیش`;
  else if (diffHours >= 1 && diffHours < 24) rel = `${toPersianDigits(diffHours)} ساعت پیش`;
  else if (diffDays === 1) rel = 'دیروز';
  else if (diffDays > 1) rel = `${toPersianDigits(diffDays)} روز پیش`;

  return `${jalaliStr} (${rel})`;
}

// Parse Coordinates from Raw Text or Map URLs (Google Maps, Neshan, Balad, Geo URI)
export function parseCoordinatesFromText(input: string): { lat: number; lng: number; sourceUrl?: string } | null {
  if (!input) return null;
  const clean = toEnglishDigits(input).trim();

  // Check if short link that cannot be resolved client-side
  if (/https?:\/\/(goo\.gl|maps\.app\.goo\.gl|nshn\.ir|balad\.ir\/p)\//i.test(clean) && !/(-?\d{2}\.\d+)/.test(clean)) {
    return null;
  }

  // Match @lat,lng or q=lat,lng or center=lat,lng or plain lat,lng
  const patterns = [
    /@(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|center|destination)=(-?\d{1,2}\.\d+)\s*(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /#map=\d+\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/,
    /(-?\d{1,2}\.\d{3,})\s*[,،\s]\s*(-?\d{1,3}\.\d{3,})/,
  ];

  for (const regex of patterns) {
    const m = clean.match(regex);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (isValidCoordinates(lat, lng)) {
        return {
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          sourceUrl: clean.startsWith('http') ? clean : undefined,
        };
      }
    }
  }
  return null;
}

export function isValidCoordinates(lat: number | undefined, lng: number | undefined): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return false;
  return lat >= 24 && lat <= 40 && lng >= 44 && lng <= 64; // Iran valid geographic bounding box (or general valid lat/lng)
}
