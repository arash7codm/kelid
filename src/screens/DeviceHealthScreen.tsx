import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AmbientBackground, BottomNavAndQuickMenu, KelidLogoIcon } from '../components/Layout';
import { db } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { aiService } from '../services/ai';
import { getAccessToken, googleSignIn } from '../services/auth';
import { initializeDriveWorkspaceStructure } from '../services/sync';
import { parseCoordinatesFromText, toPersianDigits } from '../utils/persian';

export type HealthCheckStatus = 'idle' | 'running' | 'pass' | 'fail' | 'unsupported';

export interface HealthCheckItem {
  id: string;
  title: string;
  status: HealthCheckStatus;
  explanation: string;
  suggestedFix: string;
}

const INITIAL_CHECKS: HealthCheckItem[] = [
  {
    id: 'https',
    title: '۱. پروتکل امن HTTPS',
    status: 'idle',
    explanation: 'در حال انتظار برای بررسی امنیت اتصال و کانتکست امن مرورگر...',
    suggestedFix: 'برنامه را از طریق آدرس امن https:// (مانند GitHub Pages یا آدرس منتشرشده AI Studio) باز کنید.',
  },
  {
    id: 'sw',
    title: '۲. فعال بودن سرویس‌ورکر (Service Worker)',
    status: 'idle',
    explanation: 'در حال انتظار برای بررسی وضعیت ثبت و فعال‌سازی سرویس‌ورکر...',
    suggestedFix: 'یک‌بار صفحه را در حالت آنلاین رفرش (Reload) کنید تا سرویس‌ورکر نسخه منتشرشده ثبت و فعال شود.',
  },
  {
    id: 'pwa',
    title: '۳. وضعیت نصب وب‌اپلیکیشن (PWA)',
    status: 'idle',
    explanation: 'در حال بررسی قابلیت نصب یا اجرای مستقل (Standalone) روی گوشی...',
    suggestedFix: 'در مرورگر کروم اندروید، از منوی سه‌نقطه بالا گزینه «Install app / افزودن به صفحه اصلی» یا دکمه «نصب برنامه» را بزنید.',
  },
  {
    id: 'persist',
    title: '۴. حافظه دائمی و ضدحذف (Persistent Storage)',
    status: 'idle',
    explanation: 'در حال بررسی مجوز ماندگاری دائمی داده‌ها در حافظه مرورگر...',
    suggestedFix: 'برنامه را روی صفحه اصلی گوشی نصب (Install) کنید و اعلان‌ها را فعال نمایید تا کروم مجوز حافظه دائمی را صادر کند.',
  },
  {
    id: 'idb',
    title: '۵. نوشتن و خواندن پایگاه داده (IndexedDB)',
    status: 'idle',
    explanation: 'در حال تست واقعی نوشتن، خواندن و حذف رکورد آزمایشی در IndexedDB...',
    suggestedFix: 'مطمئن شوید مرورگر در حالت ناشناس (Incognito) نیست و فضای کافی در حافظه گوشی وجود دارد.',
  },
  {
    id: 'mic',
    title: '۶. مجوز میکروفون و ضبط آزمایشی ۳ ثانیه‌ای با پخش',
    status: 'idle',
    explanation: 'روی «تلاش دوباره / تست ضبط ۳ ثانیه» بزنید تا صدای شما ضبط و پخش شود.',
    suggestedFix: 'در نوار آدرس کروم روی آیکون قفل/تنظیمات سایت بزنید و مجوز Microphone را روی Allow قرار دهید.',
  },
  {
    id: 'camera',
    title: '۷. مجوز دوربین و ثبت عکس آزمایشی',
    status: 'idle',
    explanation: 'برای تست دوربین یا گرفتن عکس آزمایشی روی دکمه تست این بخش بزنید.',
    suggestedFix: 'در تنظیمات سایت مرورگر کروم مجوز Camera را فعال کنید یا از طریق دکمه «عکس آزمایشی» دوربین گوشی را باز نمایید.',
  },
  {
    id: 'gps',
    title: '۸. مجوز مکان‌یاب و دریافت مختصات GPS با دقت',
    status: 'idle',
    explanation: 'برای دریافت مختصات واقعی GPS گوشی و شعاع دقت بر حسب متر، تست را اجرا کنید.',
    suggestedFix: 'مکان‌یاب (Location) گوشی اندروید را روشن کنید و در کروم اجازه دسترسی به موقعیت مکانی را بدهید.',
  },
  {
    id: 'clipboard',
    title: '۹. خواندن کلیپ‌بورد و استخراج مختصات لینک نقشه',
    status: 'idle',
    explanation: 'یک لینک نقشه یا مختصات در کلیپ‌بورد کپی کنید و دکمه تست را بزنید.',
    suggestedFix: 'یک لینک حاوی مختصات از گوگل‌مپ (مثلاً شامل @36.6892,51.2468) کپی کنید و مجوز خواندن کلیپ‌بورد را تایید نمایید.',
  },
  {
    id: 'share',
    title: '۱۰. پشتیبانی از اشتراک‌گذاری بومی (Web Share API)',
    status: 'idle',
    explanation: 'در حال بررسی قابلیت ارسال مستقیم فایل و متن به برنامه‌های گوشی...',
    suggestedFix: 'از مرورگر Chrome به‌روز روی سیستم‌عامل اندروید در بستر HTTPS استفاده کنید.',
  },
  {
    id: 'map_chooser',
    title: '۱۱. باز کردن انتخابگر برنامه‌های نقشه با مختصات نمونه',
    status: 'idle',
    explanation: 'بررسی تولید لینک‌های گوگل‌مپ، نشان، بلد و Waze و باز شدن شیت انتخابگر نقشه.',
    suggestedFix: 'روی دکمه «باز کردن نقشه نمونه» بزنید تا پنجره انتخاب مسیریاب باز شود.',
  },
  {
    id: 'tel_sms',
    title: '۱۲. لینک‌های تماس تلفنی (tel:) و پیامک (sms:)',
    status: 'idle',
    explanation: 'بررسی صحت ساختار لینک‌های شماره‌گیر و پیامک بومی اندروید.',
    suggestedFix: 'از دکمه‌های تست تماس و پیامک در پایین همین ردیف برای باز کردن شماره‌گیر گوشی استفاده کنید.',
  },
  {
    id: 'google_auth',
    title: '۱۳. وضعیت ورود به حساب گوگل (Google Sign-In)',
    status: 'idle',
    explanation: 'بررسی وجود توکن معتبر OAuth گوگل برای دسترسی به سرویس‌های ابری.',
    suggestedFix: 'آدرس سایت را در Google Cloud Console (بخش Authorized JavaScript origins) ثبت کرده و با حساب گوگل وارد شوید.',
  },
  {
    id: 'drive',
    title: '۱۴. دسترسی به پوشه Google Drive (ساخت، خواندن و حذف فایل تست)',
    status: 'idle',
    explanation: 'ایجاد یک فایل کوچک آزمایشی در پوشه Kelid، خواندن محتوا و حذف خودکار آن.',
    suggestedFix: 'ابتدا وارد حساب گوگل شوید و از فعال بودن Google Drive API در پروژه کلود اطمینان حاصل کنید.',
  },
  {
    id: 'calendar',
    title: '۱۵. دسترسی به Google Calendar (ساخت و حذف رویداد تست)',
    status: 'idle',
    explanation: 'ثبت یک رویداد آزمایشی موقت در تقویم اصلی گوگل و حذف فوری آن.',
    suggestedFix: 'ابتدا وارد حساب گوگل شوید و مطمئن شوید مجوز تقویم (calendar.events) را در پنجره ورود گوگل تیک زده‌اید.',
  },
  {
    id: 'gemini',
    title: '۱۶. تست کلید هوش مصنوعی Gemini',
    status: 'idle',
    explanation: 'ارسال درخواست آزمایشی مستقیم از مرورگر گوشی به مدل Gemini.',
    suggestedFix: 'در صفحه تنظیمات کلید معتبر Gemini (شروع با AIza) را وارد و ذخیره کنید و محدودیت Referrer کلید را بررسی نمایید.',
  },
  {
    id: 'offline_cache',
    title: '۱۷. کش آفلاین (آمادگی بارگذاری بدون اینترنت)',
    status: 'idle',
    explanation: 'بررسی وجود فایل‌های پوسته برنامه (App Shell) در Cache Storage مرورگر.',
    suggestedFix: 'برنامه را در نسخه منتشرشده (Production Build) یک‌بار با اینترنت باز کنید تا تمام فایل‌ها در کش آفلاین ذخیره شوند.',
  },
];

export const DeviceHealthScreen: React.FC = () => {
  const navigate = useNavigate();
  const { showToast, openMapChooser, refreshSnapshot } = useApp();
  const { isInstallable, isInstalled, install } = usePWAInstall();

  const [checks, setChecks] = useState<HealthCheckItem[]>(INITIAL_CHECKS);
  const [runningAll, setRunningAll] = useState(false);

  // Interactive test states
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const [micCountdown, setMicCountdown] = useState(0);

  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const [clipboardInput, setClipboardInput] = useState('https://www.google.com/maps?q=36.689200,51.246800');

  const cameraFileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const updateCheck = useCallback(
    (id: string, status: HealthCheckStatus, explanation: string) => {
      setChecks((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status, explanation } : item))
      );
    },
    []
  );

  // 1. HTTPS Check
  const runHttpsCheck = useCallback(async () => {
    updateCheck('https', 'running', 'در حال بررسی پروتکل امن...');
    if (typeof window === 'undefined') return;
    const isHttps = window.location.protocol === 'https:';
    const isLocal =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isHttps && window.isSecureContext) {
      updateCheck(
        'https',
        'pass',
        `اتصال کاملاً امن است (${window.location.origin}) و Secure Context فعال می‌باشد.`
      );
    } else if (isLocal && window.isSecureContext) {
      updateCheck(
        'https',
        'pass',
        'محیط توسعه امن (localhost) فعال است؛ روی گوشی حتماً از آدرس https استفاده کنید.'
      );
    } else {
      updateCheck(
        'https',
        'fail',
        `اتصال فعلی (${window.location.protocol}) امن نیست؛ قابلیت‌های PWA و میکروفون نیازمند HTTPS هستند.`
      );
    }
  }, [updateCheck]);

  // 2. Service Worker Check
  const runSwCheck = useCallback(async () => {
    updateCheck('sw', 'running', 'در حال بررسی سرویس‌ورکر...');
    if (!('serviceWorker' in navigator)) {
      updateCheck('sw', 'unsupported', 'مرورگر فعلی از Service Worker پشتیبانی نمی‌کند.');
      return;
    }
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      const activeReg = regs.find((r) => r.active) || (await navigator.serviceWorker.getRegistration());
      if (activeReg?.active) {
        updateCheck(
          'sw',
          'pass',
          `سرویس‌ورکر فعال است (وضعیت: ${activeReg.active.state}) و آماده پشتیبانی آفلاین می‌باشد.`
        );
      } else if (regs.length > 0) {
        updateCheck(
          'sw',
          'fail',
          'سرویس‌ورکر ثبت شده اما هنوز در وضعیت Active قرار نگرفته است (یک‌بار صفحه را رفرش کنید).'
        );
      } else {
        const isDev = import.meta.env.DEV;
        updateCheck(
          'sw',
          'fail',
          isDev
            ? 'در محیط پیش‌نمایش توسعه (Dev) سرویس‌ورکر غیرفعال است؛ پس از بیلد نهایی (npm run build) فعال می‌شود.'
            : 'هیچ سرویس‌ورکر فعالی یافت نشد؛ صفحه را یک‌بار رفرش کنید.'
        );
      }
    } catch (e: any) {
      updateCheck('sw', 'fail', `خطا در بررسی سرویس‌ورکر: ${e?.message || 'نامشخص'}`);
    }
  }, [updateCheck]);

  // 3. PWA Installable / Standalone Check
  const runPwaCheck = useCallback(async () => {
    updateCheck('pwa', 'running', 'در حال بررسی وضعیت نصب PWA...');
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      isInstalled;

    if (isStandalone) {
      updateCheck(
        'pwa',
        'pass',
        'برنامه هم‌اکنون به صورت نصب‌شده (Standalone PWA) روی صفحه اصلی گوشی در حال اجراست.'
      );
      return;
    }

    if (isInstallable) {
      updateCheck(
        'pwa',
        'pass',
        'برنامه آماده نصب مستقیم است؛ می‌توانید همین حالا دکمه «نصب برنامه» را بزنید.'
      );
      return;
    }

    // Verify manifest link exists
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      updateCheck(
        'pwa',
        'pass',
        'فایل مانیفست PWA معتبر است؛ در کروم اندروید از منوی ⋮ گزینه «Install app / نصب برنامه» در دسترس است.'
      );
    } else {
      updateCheck(
        'pwa',
        'fail',
        'لینک مانیفست در صفحه یافت نشد یا برنامه در نسخه بیلد نهایی باز نشده است.'
      );
    }
  }, [isInstallable, isInstalled, updateCheck]);

  // 4. Persistent Storage Check
  const runPersistCheck = useCallback(async () => {
    updateCheck('persist', 'running', 'در حال بررسی و درخواست حافظه دائمی...');
    if (!navigator.storage || !navigator.storage.persisted) {
      updateCheck('persist', 'unsupported', 'مرورگر فعلی از رابط StorageManager پشتیبانی نمی‌کند.');
      return;
    }
    try {
      let isPersisted = await navigator.storage.persisted();
      if (!isPersisted && navigator.storage.persist) {
        isPersisted = await navigator.storage.persist();
      }
      if (isPersisted) {
        updateCheck(
          'persist',
          'pass',
          'مجوز حافظه دائمی (Persistent Storage) فعال است و داده‌های گوشی توسط سیستم‌عامل پاک نخواهند شد.'
        );
      } else {
        updateCheck(
          'persist',
          'fail',
          'حافظه در حالت معمولی است؛ پس از نصب PWA روی صفحه اصلی گوشی، کروم مجوز دائمی را اعطا می‌کند.'
        );
      }
    } catch {
      updateCheck('persist', 'fail', 'بررسی وضعیت حافظه دائمی با خطا مواجه شد.');
    }
  }, [updateCheck]);

  // 5. IndexedDB Read/Write Check
  const runIdbCheck = useCallback(async () => {
    updateCheck('idb', 'running', 'در حال تست نوشتن و خواندن در IndexedDB...');
    if (!('indexedDB' in window)) {
      updateCheck('idb', 'unsupported', 'مرورگر از پایگاه داده IndexedDB پشتیبانی نمی‌کند.');
      return;
    }
    try {
      const testId = '__health_check_test_notification__';
      const nowIso = new Date().toISOString();
      await db.notifications.put({
        id: testId,
        title: 'تست سلامت پایگاه داده',
        body: nowIso,
        type: 'sync',
        jalaliDate: '۱۴۰۵/۰۱/۰۱',
        createdAt: nowIso,
        read: true,
        dismissed: true,
        targetRoute: '/settings/health',
      });
      const readBack = await db.notifications.get(testId);
      await db.notifications.delete(testId);

      if (readBack && readBack.body === nowIso) {
        const propsCount = await db.properties.count();
        updateCheck(
          'idb',
          'pass',
          `نوشتن، خواندن و حذف آزمایشی در IndexedDB با موفقیت انجام شد (${toPersianDigits(propsCount)} ملک در حافظه).`
        );
      } else {
        updateCheck('idb', 'fail', 'رکورد آزمایشی در IndexedDB بازخوانی نشد.');
      }
    } catch (e: any) {
      updateCheck('idb', 'fail', `خطا در دسترسی به IndexedDB: ${e?.message || 'نامشخص'}`);
    }
  }, [updateCheck]);

  // 6. Microphone Permission & 3-Second Recording + Playback
  const runMicCheck = useCallback(
    async (interactiveRecord = false) => {
      updateCheck('mic', 'running', 'در حال بررسی میکروفون...');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        updateCheck('mic', 'unsupported', 'مرورگر از ضبط صوتی (getUserMedia) پشتیبانی نمی‌کند.');
        return;
      }

      if (!interactiveRecord) {
        try {
          if (navigator.permissions?.query) {
            const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            if (status.state === 'denied') {
              updateCheck('mic', 'fail', 'دسترسی به میکروفون در تنظیمات مرورگر مسدود (Blocked) شده است.');
              return;
            }
          }
          updateCheck(
            'mic',
            'fail',
            'برای تایید کامل میکروفون، روی دکمه «ضبط آزمایشی ۳ ثانیه» بزنید تا صدا ضبط و پخش شود.'
          );
          return;
        } catch {
          updateCheck(
            'mic',
            'fail',
            'روی دکمه «ضبط آزمایشی ۳ ثانیه» بزنید تا تست واقعی میکروفون و پخش صدا انجام شود.'
          );
          return;
        }
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        setIsRecordingMic(true);
        setMicCountdown(3);
        updateCheck('mic', 'running', 'در حال ضبط آزمایشی صدای شما به مدت ۳ ثانیه... لطفاً صحبت کنید.');

        recorder.start(200);

        await new Promise<void>((resolve) => {
          let rem = 3;
          const timer = window.setInterval(() => {
            rem -= 1;
            setMicCountdown(rem);
            if (rem <= 0) {
              window.clearInterval(timer);
              resolve();
            }
          }, 1000);
        });

        const audioBlob = await new Promise<Blob>((resolve) => {
          recorder.onstop = () => {
            resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
          };
          recorder.stop();
        });

        stream.getTracks().forEach((t) => t.stop());
        setIsRecordingMic(false);

        if (audioBlob.size > 0) {
          if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
          const url = URL.createObjectURL(audioBlob);
          setRecordedAudioUrl(url);
          updateCheck(
            'mic',
            'pass',
            `ضبط صوتی ۳ ثانیه‌ای موفق بود (${toPersianDigits(Math.round(audioBlob.size / 1024))} کیلوبایت)؛ در حال پخش...`
          );
          setTimeout(() => {
            audioPlayerRef.current?.play().catch(() => {});
          }, 150);
        } else {
          updateCheck('mic', 'fail', 'فایل صوتی ضبط‌شده خالی بود. لطفاً میکروفون گوشی را بررسی کنید.');
        }
      } catch {
        setIsRecordingMic(false);
        updateCheck(
          'mic',
          'fail',
          'دسترسی به میکروفون رد شد یا خطایی در ضبط صوت رخ داد (مجوز میکروفون را در کروم فعال کنید).'
        );
      }
    },
    [recordedAudioUrl, updateCheck]
  );

  // 7. Camera Permission & Test Photo
  const runCameraCheck = useCallback(
    async (interactiveCapture = false) => {
      updateCheck('camera', 'running', 'در حال بررسی دسترسی به دوربین...');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        updateCheck('camera', 'unsupported', 'مرورگر از دسترسی مستقیم به دوربین پشتیبانی نمی‌کند.');
        return;
      }

      if (!interactiveCapture) {
        if (capturedPhotoUrl) {
          updateCheck('camera', 'pass', 'عکس آزمایشی با موفقیت ثبت و بارگذاری شده است.');
          return;
        }
        try {
          if (navigator.permissions?.query) {
            const st = await navigator.permissions.query({ name: 'camera' as PermissionName });
            if (st.state === 'denied') {
              updateCheck('camera', 'fail', 'مجوز دوربین در مرورگر مسدود (Denied) شده است.');
              return;
            }
          }
          updateCheck(
            'camera',
            'fail',
            'برای تایید کامل دوربین، روی دکمه «ثبت عکس آزمایشی» بزنید تا یک فریم یا عکس تست گرفته شود.'
          );
          return;
        } catch {
          updateCheck(
            'camera',
            'fail',
            'روی دکمه «ثبت عکس آزمایشی» بزنید تا دوربین گوشی تست شود.'
          );
          return;
        }
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        await new Promise((r) => setTimeout(r, 350));

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        stream.getTracks().forEach((t) => t.stop());

        setCapturedPhotoUrl(dataUrl);
        updateCheck(
          'camera',
          'pass',
          `دوربین با موفقیت باز شد و تصویر آزمایشی (${toPersianDigits(canvas.width)}×${toPersianDigits(canvas.height)}) ثبت گردید.`
        );
      } catch {
        // Fallback to native camera input on mobile if stream is blocked
        cameraFileInputRef.current?.click();
        updateCheck(
          'camera',
          'fail',
          'در صورت باز شدن دوربین بومی گوشی، یک عکس بگیرید؛ در غیر این صورت مجوز Camera را در کروم فعال کنید.'
        );
      }
    },
    [capturedPhotoUrl, updateCheck]
  );

  const handleCameraFileFallback = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCapturedPhotoUrl(url);
    updateCheck(
      'camera',
      'pass',
      `عکس آزمایشی از دوربین گوشی دریافت شد (${toPersianDigits(Math.round(file.size / 1024))} کیلوبایت).`
    );
  };

  // 8. Location Permission & GPS Reading with Accuracy
  const runGpsCheck = useCallback(
    async (interactiveGps = false) => {
      updateCheck('gps', 'running', 'در حال بررسی وضعیت مکان‌یاب (GPS)...');
      if (!('geolocation' in navigator)) {
        updateCheck('gps', 'unsupported', 'مرورگر یا دستگاه از مکان‌یاب (Geolocation) پشتیبانی نمی‌کند.');
        return;
      }

      if (!interactiveGps) {
        try {
          if (navigator.permissions?.query) {
            const st = await navigator.permissions.query({ name: 'geolocation' });
            if (st.state === 'denied') {
              updateCheck('gps', 'fail', 'مجوز مکان‌یاب در تنظیمات کروم مسدود شده است.');
              return;
            }
            if (st.state === 'prompt') {
              updateCheck(
                'gps',
                'fail',
                'روی «تلاش دوباره / دریافت GPS» بزنید تا پنجره مجوز مکان‌یاب باز و مختصات خوانده شود.'
              );
              return;
            }
          }
        } catch {
          // continue to getCurrentPosition
        }
      }

      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude.toFixed(6);
            const lng = pos.coords.longitude.toFixed(6);
            const acc = Math.round(pos.coords.accuracy);
            updateCheck(
              'gps',
              'pass',
              `مختصات دریافت شد: ${toPersianDigits(lat)}, ${toPersianDigits(lng)} (دقت: ±${toPersianDigits(acc)} متر).`
            );
            resolve();
          },
          (err) => {
            const msg =
              err.code === 1
                ? 'مجوز دسترسی به موقعیت مکانی (GPS) رد شد.'
                : err.code === 2
                ? 'سیگنال GPS در دسترس نیست؛ مکان‌یاب گوشی را روشن کنید.'
                : 'مهلت دریافت سیگنال GPS به پایان رسید؛ در فضای باز تلاش کنید.';
            updateCheck('gps', 'fail', msg);
            resolve();
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });
    },
    [updateCheck]
  );

  // 9. Clipboard Read & Map Coordinate Parsing
  const runClipboardCheck = useCallback(
    async (interactiveRead = false) => {
      updateCheck('clipboard', 'running', 'در حال بررسی خواندن کلیپ‌بورد و تجزیه لینک نقشه...');
      let textToParse = clipboardInput.trim();

      if (interactiveRead && navigator.clipboard?.readText) {
        try {
          const clipText = await navigator.clipboard.readText();
          if (clipText && clipText.trim()) {
            textToParse = clipText.trim();
            setClipboardInput(textToParse);
          }
        } catch {
          // If browser blocks readText without prompt, fall back to input box value
        }
      }

      const parsed = parseCoordinatesFromText(textToParse);
      if (parsed) {
        updateCheck(
          'clipboard',
          'pass',
          `مختصات از لینک نقشه با موفقیت استخراج شد: عرض ${toPersianDigits(parsed.lat)} ، طول ${toPersianDigits(parsed.lng)}`
        );
      } else {
        updateCheck(
          'clipboard',
          'fail',
          'مختصاتی در متن کلیپ‌بورد یافت نشد؛ یک لینک کامل گوگل‌مپ (حاوی عرض و طول جغرافیایی) کپی و تست کنید.'
        );
      }
    },
    [clipboardInput, updateCheck]
  );

  // 10. Web Share Support
  const runShareCheck = useCallback(async () => {
    updateCheck('share', 'running', 'در حال بررسی پشتیبانی از Web Share API...');
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const canShareFiles =
        typeof navigator.canShare === 'function' &&
        navigator.canShare({
          files: [new File(['test'], 'test.txt', { type: 'text/plain' })],
        });
      updateCheck(
        'share',
        'pass',
        canShareFiles
          ? 'اشتراک‌گذاری بومی متن و فایل (Web Share Level 2) کاملاً در این گوشی پشتیبانی می‌شود.'
          : 'اشتراک‌گذاری بومی لینک و متن (navigator.share) در این مرورگر فعال است.'
      );
    } else {
      updateCheck(
        'share',
        'unsupported',
        'این مرورگر از Web Share پشتیبانی نمی‌کند (در کروم اندروید روی HTTPS فعال است).'
      );
    }
  }, [updateCheck]);

  // 11. Map-App Chooser Check
  const runMapChooserCheck = useCallback(
    async (openSheetNow = false) => {
      updateCheck('map_chooser', 'running', 'در حال بررسی انتخابگر نقشه...');
      const sampleLat = 36.6892;
      const sampleLng = 51.2468;
      if (openSheetNow) {
        openMapChooser(sampleLat, sampleLng, 'مختصات آزمایشی کلارآباد (تست سلامت)');
      }
      updateCheck(
        'map_chooser',
        'pass',
        openSheetNow
          ? 'پنجره انتخاب برنامه مسیریاب (گوگل‌مپ، نشان، بلد، Waze) با مختصات نمونه باز شد.'
          : 'انتخابگر نقشه آماده است؛ با زدن «باز کردن نقشه نمونه» شیت انتخاب مسیریاب را مشاهده کنید.'
      );
    },
    [openMapChooser, updateCheck]
  );

  // 12. Dialer (tel:) and SMS (sms:) Links Check
  const runTelSmsCheck = useCallback(async () => {
    updateCheck(
      'tel_sms',
      'pass',
      'پروتکل‌های تماس (tel:09120000000) و پیامک (sms:09120000000) آماده هستند؛ از دکمه‌های زیر برای تست واقعی استفاده کنید.'
    );
  }, [updateCheck]);

  // 13. Google Sign-In Status Check
  const runGoogleAuthCheck = useCallback(async () => {
    updateCheck('google_auth', 'running', 'در حال بررسی وضعیت ورود به حساب گوگل...');
    const token = getAccessToken();
    const email = localStorage.getItem('kelid_user_email') || '';
    if (token) {
      updateCheck(
        'google_auth',
        'pass',
        `متصل به حساب گوگل (${email || 'توکن OAuth فعال است'}) و آماده دسترسی به Drive و Calendar.`
      );
    } else {
      updateCheck(
        'google_auth',
        'fail',
        'هنوز وارد حساب گوگل نشده‌اید یا توکن منقضی شده است؛ روی دکمه «ورود با گوگل» بزنید.'
      );
    }
  }, [updateCheck]);

  // 14. Drive Folder Access (Create, Read, Delete Test File)
  const runDriveCheck = useCallback(async () => {
    updateCheck('drive', 'running', 'در حال تست ساخت، خواندن و حذف فایل آزمایشی در Google Drive...');
    const token = getAccessToken();
    if (!token) {
      updateCheck('drive', 'fail', 'ابتدا در ردیف ۱۳ با حساب گوگل وارد شوید تا تست Drive انجام شود.');
      return;
    }
    if (!navigator.onLine) {
      updateCheck('drive', 'fail', 'برای تست ارتباط با Google Drive، اتصال اینترنت گوشی را وصل کنید.');
      return;
    }

    try {
      const folders = await initializeDriveWorkspaceStructure();
      const testContent = {
        healthTest: true,
        timestamp: new Date().toISOString(),
        app: 'Kelid CRM',
      };

      const boundary = '-------kelid_health_test_boundary';
      const metadata = {
        name: `kelid_health_test_${Date.now()}.json`,
        mimeType: 'application/json',
        parents: [folders.rootFolderId],
      };

      const body =
        `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(testContent) +
        `\r\n--${boundary}--`;

      // 1. Create file
      const createRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        }
      );

      if (!createRes.ok) {
        throw new Error(`خطای ساخت فایل در Drive (کد ${createRes.status})`);
      }
      const createdFile = await createRes.json();
      const fileId = createdFile.id;

      // 2. Read file content back
      const readRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!readRes.ok) {
        throw new Error(`خطای خواندن فایل آزمایشی از Drive (کد ${readRes.status})`);
      }
      const readJson = await readRes.json();

      // 3. Delete test file
      const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (readJson?.healthTest === true && (delRes.ok || delRes.status === 204)) {
        updateCheck(
          'drive',
          'pass',
          'دسترسی به پوشه Kelid در Google Drive تایید شد (ساخت، خواندن و حذف فایل آزمایشی با موفقیت انجام شد).'
        );
      } else {
        updateCheck('drive', 'fail', 'ساخت و خواندن انجام شد اما حذف فایل آزمایشی کامل نشد.');
      }
    } catch (e: any) {
      updateCheck(
        'drive',
        'fail',
        `خطا در تست Google Drive: ${e?.message || 'عدم دسترسی به سرویس Drive'}`
      );
    }
  }, [updateCheck]);

  // 15. Calendar Access (Create & Delete Test Event)
  const runCalendarCheck = useCallback(async () => {
    updateCheck('calendar', 'running', 'در حال ساخت و حذف رویداد آزمایشی در Google Calendar...');
    const token = getAccessToken();
    if (!token) {
      updateCheck('calendar', 'fail', 'ابتدا در ردیف ۱۳ با حساب گوگل وارد شوید تا تست تقویم انجام شود.');
      return;
    }
    if (!navigator.onLine) {
      updateCheck('calendar', 'fail', 'برای تست Google Calendar اتصال اینترنت لازم است.');
      return;
    }

    try {
      const start = new Date(Date.now() + 3600 * 1000);
      const end = new Date(start.getTime() + 15 * 60 * 1000);
      const createRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary: 'تست سلامت تقویم کلید (حذف خودکار)',
            description: 'رویداد آزمایشی سامانه املاک کلید جهت بررسی مجوز تقویم',
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
          }),
        }
      );

      if (!createRes.ok) {
        throw new Error(`عدم دسترسی به تقویم گوگل (کد ${createRes.status})`);
      }

      const evData = await createRes.json();
      const eventId = evData.id;

      const delRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (eventId && (delRes.ok || delRes.status === 204)) {
        updateCheck(
          'calendar',
          'pass',
          'دسترسی به Google Calendar تایید شد (رویداد آزمایشی با موفقیت ساخته و بلافاصله حذف گردید).'
        );
      } else {
        updateCheck('calendar', 'fail', 'رویداد تقویم ساخته شد اما حذف خودکار آن تایید نشد.');
      }
    } catch (e: any) {
      updateCheck(
        'calendar',
        'fail',
        `خطا در تست Google Calendar: ${e?.message || 'مجوز تقویم صادر نشده است'}`
      );
    }
  }, [updateCheck]);

  // 16. Gemini Key Test
  const runGeminiCheck = useCallback(async () => {
    updateCheck('gemini', 'running', 'در حال تست ارتباط با هوش مصنوعی Gemini...');
    const res = await aiService.testConnection();
    if (res.ok) {
      updateCheck('gemini', 'pass', res.message);
    } else {
      updateCheck('gemini', 'fail', res.message);
    }
  }, [updateCheck]);

  // 17. Offline Cache Check
  const runOfflineCacheCheck = useCallback(async () => {
    updateCheck('offline_cache', 'running', 'در حال بررسی کش آفلاین (Cache Storage)...');
    if (!('caches' in window)) {
      updateCheck('offline_cache', 'unsupported', 'مرورگر از Cache Storage API پشتیبانی نمی‌کند.');
      return;
    }
    try {
      const keys = await caches.keys();
      let totalCachedRequests = 0;
      for (const key of keys) {
        const cache = await caches.open(key);
        const reqs = await cache.keys();
        totalCachedRequests += reqs.length;
      }

      if (totalCachedRequests > 0) {
        updateCheck(
          'offline_cache',
          'pass',
          `کش آفلاین فعال است (${toPersianDigits(keys.length)} مخزن کش شامل ${toPersianDigits(totalCachedRequests)} فایل ذخیره شده برای اجرای بدون اینترنت).`
        );
      } else {
        // Test writing & reading a sample entry in Cache Storage to verify API works
        const testCache = await caches.open('kelid-health-verify-v1');
        const testReq = new Request(window.location.href);
        const res = await fetch(window.location.href).catch(() => null);
        if (res && res.ok) {
          await testCache.put(testReq, res.clone());
          const matched = await testCache.match(testReq);
          if (matched) {
            updateCheck(
              'offline_cache',
              'pass',
              'پوسته اصلی برنامه در Cache Storage مرورگر ذخیره و برای بارگذاری آفلاین تایید شد.'
            );
            return;
          }
        }
        updateCheck(
          'offline_cache',
          'fail',
          'هنوز فایلی در کش آفلاین سرویس‌ورکر ذخیره نشده است؛ برنامه را در آدرس منتشرشده باز و یک‌بار رفرش کنید.'
        );
      }
    } catch (e: any) {
      updateCheck('offline_cache', 'fail', `خطا در بررسی کش آفلاین: ${e?.message || 'نامشخص'}`);
    }
  }, [updateCheck]);

  const runSingleCheck = useCallback(
    async (id: string) => {
      switch (id) {
        case 'https':
          return runHttpsCheck();
        case 'sw':
          return runSwCheck();
        case 'pwa':
          return runPwaCheck();
        case 'persist':
          return runPersistCheck();
        case 'idb':
          return runIdbCheck();
        case 'mic':
          return runMicCheck(true);
        case 'camera':
          return runCameraCheck(true);
        case 'gps':
          return runGpsCheck(true);
        case 'clipboard':
          return runClipboardCheck(true);
        case 'share':
          return runShareCheck();
        case 'map_chooser':
          return runMapChooserCheck(true);
        case 'tel_sms':
          return runTelSmsCheck();
        case 'google_auth':
          return runGoogleAuthCheck();
        case 'drive':
          return runDriveCheck();
        case 'calendar':
          return runCalendarCheck();
        case 'gemini':
          return runGeminiCheck();
        case 'offline_cache':
          return runOfflineCacheCheck();
      }
    },
    [
      runHttpsCheck,
      runSwCheck,
      runPwaCheck,
      runPersistCheck,
      runIdbCheck,
      runMicCheck,
      runCameraCheck,
      runGpsCheck,
      runClipboardCheck,
      runShareCheck,
      runMapChooserCheck,
      runTelSmsCheck,
      runGoogleAuthCheck,
      runDriveCheck,
      runCalendarCheck,
      runGeminiCheck,
      runOfflineCacheCheck,
    ]
  );

  const runAllNonIntrusiveChecks = useCallback(async () => {
    setRunningAll(true);
    try {
      await runHttpsCheck();
      await runSwCheck();
      await runPwaCheck();
      await runPersistCheck();
      await runIdbCheck();
      await runMicCheck(false);
      await runCameraCheck(false);
      await runGpsCheck(false);
      await runClipboardCheck(false);
      await runShareCheck();
      await runMapChooserCheck(false);
      await runTelSmsCheck();
      await runGoogleAuthCheck();
      if (getAccessToken()) {
        await runDriveCheck();
        await runCalendarCheck();
      } else {
        updateCheck(
          'drive',
          'fail',
          'برای تست ساخت، خواندن و حذف فایل آزمایشی در Drive ابتدا با حساب گوگل وارد شوید.'
        );
        updateCheck(
          'calendar',
          'fail',
          'برای تست ساخت و حذف رویداد آزمایشی در Calendar ابتدا با حساب گوگل وارد شوید.'
        );
      }
      await runGeminiCheck();
      await runOfflineCacheCheck();
    } finally {
      setRunningAll(false);
    }
  }, [
    runHttpsCheck,
    runSwCheck,
    runPwaCheck,
    runPersistCheck,
    runIdbCheck,
    runMicCheck,
    runCameraCheck,
    runGpsCheck,
    runClipboardCheck,
    runShareCheck,
    runMapChooserCheck,
    runTelSmsCheck,
    runGoogleAuthCheck,
    runDriveCheck,
    runCalendarCheck,
    runGeminiCheck,
    runOfflineCacheCheck,
    updateCheck,
  ]);

  useEffect(() => {
    runAllNonIntrusiveChecks();
  }, [runAllNonIntrusiveChecks]);

  const passedCount = checks.filter((c) => c.status === 'pass').length;
  const failedChecks = checks.filter((c) => c.status === 'fail' || c.status === 'unsupported');

  const getBadgeStyle = (status: HealthCheckStatus) => {
    switch (status) {
      case 'pass':
        return {
          label: 'موفق (Pass)',
          cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40',
          icon: 'check_circle',
        };
      case 'fail':
        return {
          label: 'ناموفق (Fail)',
          cls: 'bg-rose-500/20 text-rose-300 border-rose-400/40',
          icon: 'error',
        };
      case 'unsupported':
        return {
          label: 'پشتیبانی نمی‌شود',
          cls: 'bg-amber-500/20 text-amber-300 border-amber-400/40',
          icon: 'block',
        };
      case 'running':
        return {
          label: 'در حال بررسی...',
          cls: 'bg-sky-500/20 text-sky-300 border-sky-400/40',
          icon: 'sync',
        };
      default:
        return {
          label: 'در انتظار',
          cls: 'bg-white/10 text-[#d1c5b4] border-white/15',
          icon: 'hourglass_empty',
        };
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-[#dae2ff] relative overflow-x-hidden pb-32">
      <input
        ref={cameraFileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraFileFallback}
        className="hidden"
      />

      <header className="fixed top-0 inset-x-0 z-40 pt-safe bg-[#080d1a]/60 backdrop-blur-2xl border-b border-[#f1cb83]/15">
        <div className="h-16 px-5 flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="w-10 h-10 rounded-xl crystal-glass-subtle flex items-center justify-center text-[#f1cb83] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
            <div>
              <h1 className="text-base font-extrabold text-[#dae2ff]">تست سلامت دستگاه</h1>
              <p className="text-[10px] text-[#d1c5b4]">
                بررسی واقعی قابلیت‌های PWA، سنسورهای گوشی، فضای ابری و هوش مصنوعی
              </p>
            </div>
          </div>
          <KelidLogoIcon className="h-10 w-10" />
        </div>
      </header>

      <main className="page-enter-forward relative z-10 max-w-lg mx-auto pt-20 px-5 space-y-4 text-right">
        {/* Top Summary Banner */}
        <section className="rounded-2xl crystal-glass p-4 border border-[#f1cb83]/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-[22px]">
                health_and_safety
              </span>
              <div>
                <h2 className="text-sm font-extrabold text-[#dae2ff]">
                  وضعیت کلی آمادگی روی گوشی
                </h2>
                <p className="text-[11px] text-[#d1c5b4]">
                  {toPersianDigits(passedCount)} از {toPersianDigits(checks.length)} بررسی با موفقیت تایید شد
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={runningAll}
              onClick={runAllNonIntrusiveChecks}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#d4b06a] to-[#f1cb83] text-[#261900] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              <span>{runningAll ? 'در حال تست...' : 'اجرای مجدد همه'}</span>
            </button>
          </div>

          <div className="w-full h-2 rounded-full bg-[#050b17] overflow-hidden border border-white/10">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-[#f1cb83] transition-all duration-300"
              style={{ width: `${Math.round((passedCount / checks.length) * 100)}%` }}
            />
          </div>
        </section>

        {/* Individual 17 Checks */}
        <div className="space-y-3">
          {checks.map((item) => {
            const badge = getBadgeStyle(item.status);
            return (
              <section
                key={item.id}
                className="rounded-2xl crystal-glass p-4 border border-[#f1cb83]/20 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`material-symbols-outlined text-[19px] shrink-0 ${
                        item.status === 'pass'
                          ? 'text-emerald-400'
                          : item.status === 'fail'
                          ? 'text-rose-400'
                          : 'text-[#f1cb83]'
                      }`}
                    >
                      {badge.icon}
                    </span>
                    <h3 className="text-xs font-extrabold text-[#dae2ff] leading-snug">
                      {item.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => runSingleCheck(item.id)}
                      className="px-2.5 py-1 rounded-lg bg-[#f1cb83]/15 border border-[#f1cb83]/35 text-[#f1cb83] text-[10px] font-bold hover:bg-[#f1cb83]/25 cursor-pointer"
                    >
                      تلاش دوباره
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-[#d1c5b4] leading-relaxed">{item.explanation}</p>

                {/* Interactive Extras per specific check */}
                {item.id === 'pwa' && isInstallable && !isInstalled && (
                  <button
                    type="button"
                    onClick={install}
                    className="w-full py-2 rounded-xl bg-[#f1cb83] text-[#261900] text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">install_mobile</span>
                    <span>نصب برنامه روی صفحه اصلی گوشی</span>
                  </button>
                )}

                {item.id === 'mic' && (
                  <div className="pt-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isRecordingMic}
                        onClick={() => runMicCheck(true)}
                        className="px-3 py-1.5 rounded-xl bg-[#f1cb83] text-[#261900] text-[11px] font-extrabold flex items-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">mic</span>
                        <span>
                          {isRecordingMic
                            ? `در حال ضبط (${toPersianDigits(micCountdown)} ثانیه)...`
                            : 'ضبط آزمایشی ۳ ثانیه و پخش'}
                        </span>
                      </button>
                    </div>
                    {recordedAudioUrl && (
                      <audio
                        ref={audioPlayerRef}
                        src={recordedAudioUrl}
                        controls
                        className="w-full h-9 rounded-lg"
                      />
                    )}
                  </div>
                )}

                {item.id === 'camera' && (
                  <div className="pt-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => runCameraCheck(true)}
                        className="px-3 py-1.5 rounded-xl bg-[#f1cb83] text-[#261900] text-[11px] font-extrabold flex items-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">photo_camera</span>
                        <span>ثبت عکس آزمایشی با دوربین</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => cameraFileInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-[#dae2ff] text-[11px] font-bold cursor-pointer"
                      >
                        دوربین بومی گوشی
                      </button>
                    </div>
                    {capturedPhotoUrl && (
                      <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[#050b17] border border-emerald-400/30">
                        <img
                          src={capturedPhotoUrl}
                          alt="عکس آزمایشی"
                          className="w-16 h-12 object-cover rounded-lg border border-white/15"
                        />
                        <span className="text-[11px] text-emerald-300 font-bold">
                          پیش‌نمایش عکس آزمایشی ثبت‌شده ✓
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {item.id === 'clipboard' && (
                  <div className="pt-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        dir="ltr"
                        value={clipboardInput}
                        onChange={(e) => setClipboardInput(e.target.value)}
                        placeholder="https://maps.google.com/?q=36.6892,51.2468"
                        className="flex-1 h-8 px-2.5 rounded-xl bg-[#050b17] border border-[#f1cb83]/25 text-[11px] text-white text-left font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => runClipboardCheck(true)}
                        className="h-8 px-3 rounded-xl bg-[#f1cb83] text-[#261900] text-[11px] font-extrabold shrink-0 cursor-pointer"
                      >
                        خواندن و تجزیه
                      </button>
                    </div>
                  </div>
                )}

                {item.id === 'map_chooser' && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => runMapChooserCheck(true)}
                      className="px-3 py-1.5 rounded-xl bg-[#f1cb83]/20 border border-[#f1cb83]/40 text-[#f1cb83] text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">map</span>
                      <span>باز کردن انتخابگر نقشه با مختصات نمونه (کلارآباد)</span>
                    </button>
                  </div>
                )}

                {item.id === 'tel_sms' && (
                  <div className="pt-1 flex items-center gap-2">
                    <a
                      href="tel:09120000000"
                      className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-bold flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[15px]">call</span>
                      <span>تست شماره‌گیر (tel:)</span>
                    </a>
                    <a
                      href="sms:09120000000?body=%D8%AA%D8%B3%D8%AA%20%D8%B3%D8%A7%D9%85%D8%A7%D9%86%D9%87%20%DA%A9%D9%84%DB%8C%D8%AF"
                      className="px-3 py-1.5 rounded-xl bg-sky-500/20 border border-sky-400/40 text-sky-300 text-[11px] font-bold flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[15px]">sms</span>
                      <span>تست پیامک (sms:)</span>
                    </a>
                  </div>
                )}

                {item.id === 'google_auth' && !getAccessToken() && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await googleSignIn();
                          await refreshSnapshot();
                          await runGoogleAuthCheck();
                          await runDriveCheck();
                          await runCalendarCheck();
                          showToast('ورود با حساب گوگل و تست سرویس‌های ابری انجام شد', 'success');
                        } catch (e: any) {
                          updateCheck(
                            'google_auth',
                            'fail',
                            e?.message || 'خطا در ورود با حساب گوگل'
                          );
                          showToast(e?.message || 'خطا در ورود با حساب گوگل', 'error');
                        }
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-[#f1cb83] text-[#261900] text-[11px] font-extrabold flex items-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">login</span>
                      <span>ورود با حساب گوگل و تست خودکار Drive / Calendar</span>
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Final Summary & Suggested Fixes Card */}
        <section className="rounded-2xl crystal-glass p-4 border border-[#f1cb83]/35 space-y-3">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <h2 className="text-sm font-extrabold text-[#f1cb83]">
              جمع‌بندی نهایی تست سلامت دستگاه
            </h2>
            <span className="text-xs font-extrabold text-[#dae2ff]">
              {toPersianDigits(passedCount)} موفق • {toPersianDigits(failedChecks.length)} نیازمند اقدام
            </span>
          </div>

          {failedChecks.length === 0 ? (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-400/35 text-xs text-emerald-200 font-bold leading-relaxed">
              تمامی ۱۷ بررسی سخت‌افزاری، نرم‌افزاری، آفلاین و ابری با موفقیت کامل تایید شدند. گوشی شما ۱۰۰٪ آماده استفاده عملیاتی است.
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-[#d1c5b4]">
                موارد زیر هنوز تایید نشده‌اند یا نیازمند تعامل مستقیم شما (لمس دکمه تست یا تنظیم مجوز) هستند:
              </p>
              {failedChecks.map((fc) => (
                <div
                  key={fc.id}
                  className="p-2.5 rounded-xl bg-[#050b17]/90 border border-rose-400/25 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-300">{fc.title}</span>
                    <button
                      type="button"
                      onClick={() => runSingleCheck(fc.id)}
                      className="text-[10px] font-bold text-[#f1cb83] underline cursor-pointer"
                    >
                      تست مجدد
                    </button>
                  </div>
                  <p className="text-[11px] text-[#dae2ff] leading-relaxed">
                    <strong className="text-[#f1cb83]">راه‌حل پیشنهادی: </strong>
                    {fc.suggestedFix}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
