import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { JalaliDatePickerModal } from '../components/JalaliDatePickerModal';
import { KelidLogoIcon } from '../components/Layout';
import { CreditTier } from '../config';
import {
  generateNextCode,
  registerPlaceUsage,
  saveApplicant,
  saveReminder,
} from '../db/repositories';
import { ApplicantRecord } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { markReturningToList, runWithViewTransition } from '../motion';
import { VoiceSessionController } from '../services/voice';
import {
  addDaysToJalali,
  amountToTomanWords,
  formatWithSeparator,
  getTodayJalali,
  parseNumericInput,
  toPersianDigits,
  validateIranianMobile,
} from '../utils/persian';

const DESIRED_TYPES_OPTIONS = [
  'زمین مسکونی',
  'ویلا نوساز',
  'زمین ساحلی / جنگلی',
  'آپارتمان لوکس',
  'باغ و زمین هکتاری',
  'کلنگی و تجاری',
];

const PRIORITY_TAGS_OPTIONS = [
  'داخل شهرک برند با نگهبانی',
  'پلاک اول یا دید دریا',
  'چشم‌انداز ابدی جنگل و کوه',
  'انشعابات کامل پای ملک',
  'کوچه حداقل ۸ الی ۱۰ متری',
  'دارای جواز ساخت یا پایان‌کار',
];

export const ApplicantFormScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { snapshot, refreshSnapshot, showToast, askPermission } = useApp();

  const isEdit = Boolean(id);
  const [autoCode, setAutoCode] = useState('C-001');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [secondPhone, setSecondPhone] = useState('');
  const [source, setSource] = useState('معرفی مشتریان قبلی');
  const [referrer, setReferrer] = useState('');
  const [creditTier, setCreditTier] = useState<CreditTier>('عالی');

  const [minBudgetStr, setMinBudgetStr] = useState('');
  const [maxBudgetStr, setMaxBudgetStr] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('نقدی کامل در محضر');
  const [barterDescription, setBarterDescription] = useState('');

  const [dealType, setDealType] = useState<'خرید قطعی' | 'سرمایه‌گذاری' | 'مشارکت در ساخت'>(
    'خرید قطعی'
  );
  const [desiredTypes, setDesiredTypes] = useState<string[]>(['زمین مسکونی']);
  const [citiesInput, setCitiesInput] = useState('');
  const [specificArea, setSpecificArea] = useState('');
  const [minAreaStr, setMinAreaStr] = useState('');
  const [maxAreaStr, setMaxAreaStr] = useState('');
  const [acceptedZoning, setAcceptedZoning] = useState('فقط داخل بافت مسکونی');
  const [minDeedType, setMinDeedType] = useState('فقط سند تک‌برگ شش‌دانگ');
  const [priorityFeatures, setPriorityFeatures] = useState<string[]>([]);

  const [status, setStatus] = useState<ApplicantRecord['status']>('در حال پیگیری');
  const [priority, setPriority] = useState<ApplicantRecord['priority']>('vip');
  const [nextFollowUpDate, setNextFollowUpDate] = useState(
    addDaysToJalali(getTodayJalali(true), 1, true)
  );
  const [nextFollowUpTime, setNextFollowUpTime] = useState('11:00');
  const [autoCalendarReminder, setAutoCalendarReminder] = useState(true);
  const [notes, setNotes] = useState('');

  const [aiFilledFields, setAiFilledFields] = useState<string[]>([]);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const voiceRef = useRef<VoiceSessionController | null>(null);

  useEffect(() => {
    if (isEdit && id && snapshot) {
      const existing = snapshot.applicants.find((a) => a.id === id);
      if (existing) {
        setAutoCode(existing.code);
        setFullName(existing.name);
        setPhone(existing.phone);
        setSource(existing.referrerLabel || 'معرفی مشتریان قبلی');
        setCreditTier(existing.creditTier === 'neutral' ? 'عادی' : existing.creditTier);
        setMinBudgetStr(formatWithSeparator(existing.minBudget, false));
        setMaxBudgetStr(formatWithSeparator(existing.maxBudget, false));
        setBarterDescription(existing.barterDescription || '');
        setDesiredTypes(existing.desiredPropertyTypes);
        setCitiesInput(existing.cities.join('، '));
        setSpecificArea(existing.neighborhoods.join('، '));
        setMinAreaStr(String(existing.minArea || ''));
        setMaxAreaStr(String(existing.maxArea || ''));
        setAcceptedZoning(existing.desiredZonings[0] || 'فقط داخل بافت مسکونی');
        setMinDeedType(existing.desiredDeeds[0] || 'فقط سند تک‌برگ شش‌دانگ');
        setPriorityFeatures(existing.placementTypes);
        setStatus(existing.status);
        setPriority(existing.priority);
        if (existing.nextFollowupDate) setNextFollowUpDate(existing.nextFollowupDate);
        setNotes(existing.confidentialNotes || '');
      }
    } else {
      generateNextCode('C').then(setAutoCode);
      const draftRaw = sessionStorage.getItem('kelid_draft_applicant_new');
      if (draftRaw) {
        try {
          const d = JSON.parse(draftRaw);
          if (d.fullName) setFullName(d.fullName);
          if (d.citiesInput) setCitiesInput(d.citiesInput);
          if (d.minAreaStr) setMinAreaStr(d.minAreaStr);
          if (d.maxBudgetStr) setMaxBudgetStr(d.maxBudgetStr);
          if (d.notes) setNotes(d.notes);
          sessionStorage.removeItem('kelid_draft_applicant_new');
        } catch {
          // ignore
        }
      }
    }
  }, [isEdit, id, snapshot]);

  const toggleDesiredType = (t: string) => {
    setDesiredTypes((prev) =>
      prev.includes(t) ? prev.filter((item) => item !== t) : [...prev, t]
    );
  };

  const togglePriorityFeature = (f: string) => {
    setPriorityFeatures((prev) =>
      prev.includes(f) ? prev.filter((item) => item !== f) : [...prev, f]
    );
  };

  const handleVoiceFill = async () => {
    if (isVoiceActive) {
      voiceRef.current?.stop();
      setIsVoiceActive(false);
      return;
    }
    const allowed = await askPermission('microphone');
    if (!allowed) return;

    setIsVoiceActive(true);
    const session = new VoiceSessionController({
      onLiveTranscript: (text) => {
        setNotes(text);
        const num = parseNumericInput(text);
        const filled: string[] = ['notes'];
        if (text.includes('کلارآباد') || text.includes('متل قو')) {
          setCitiesInput('کلارآباد، متل قو');
          filled.push('cities');
        }
        if (num > 1_000_000_000) {
          setMaxBudgetStr(formatWithSeparator(num, false));
          filled.push('maxBudget');
        }
        setAiFilledFields(filled);
      },
      onSilenceTimeout: (msg) => {
        setIsVoiceActive(false);
        showToast(msg, 'info');
      },
      onRecordingComplete: () => {
        setIsVoiceActive(false);
        showToast('اطلاعات صوتی استخراج و در فیلدها جایگذاری شد.', 'success');
      },
      onError: (err) => {
        setIsVoiceActive(false);
        showToast(err, 'error');
      },
    });
    voiceRef.current = session;
    await session.start();
  };

  const handleSave = async (navigateToMatches = false) => {
    if (!fullName.trim()) {
      showToast('لطفاً نام و نام خانوادگی متقاضی را وارد کنید.', 'error');
      return;
    }
    if (!validateIranianMobile(phone)) {
      showToast('شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: ۰۹۱۲۱۲۳۴۵۶۷).', 'error');
      return;
    }

    const maxBudget = parseNumericInput(maxBudgetStr);
    const minBudget = parseNumericInput(minBudgetStr);
    if (maxBudget <= 0) {
      showToast('لطفاً سقف بودجه خرید متقاضی را به تومان وارد نمایید.', 'error');
      return;
    }

    setSaving(true);
    try {
      const cities = citiesInput
        .split(/[،,\/]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const hoods = specificArea
        .split(/[،,\/]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const c of cities) {
        await registerPlaceUsage(c, hoods);
      }

      const saved = await saveApplicant({
        id: isEdit ? id : undefined,
        code: autoCode,
        name: fullName.trim(),
        phone: phone.trim(),
        priority,
        gender: 'male',
        creditTier,
        status,
        referrerId: 'direct',
        referrerLabel: referrer.trim() ? `${source} (${referrer.trim()})` : source,
        confidentialNotes: notes.trim(),
        dealTypes: [dealType],
        desiredPropertyTypes: desiredTypes.length ? desiredTypes : ['زمین مسکونی'],
        cities: cities.length ? cities : ['کلارآباد'],
        neighborhoods: hoods,
        placementTypes: priorityFeatures,
        minArea: parseNumericInput(minAreaStr) || 200,
        maxArea: parseNumericInput(maxAreaStr) || 600,
        minBudget: minBudget || Math.round(maxBudget * 0.8),
        maxBudget,
        cashPercentage: paymentTerms.includes('نقدی') ? 100 : 70,
        allowBarter: Boolean(barterDescription.trim()) || paymentTerms.includes('معاوضه'),
        barterDescription: barterDescription.trim() || undefined,
        settlementTimeline: paymentTerms,
        desiredDeeds: [minDeedType],
        desiredZonings: [acceptedZoning],
        lastContactDate: getTodayJalali(true),
        nextFollowupDate: nextFollowUpDate,
      });

      if (autoCalendarReminder && !isEdit) {
        await saveReminder({
          title: `پیگیری متقاضی — ${saved.name}`,
          transcript: `معرفی املاک منطبق با سقف بودجه ${amountToTomanWords(saved.maxBudget)}`,
          jalaliDate: nextFollowUpDate,
          time: nextFollowUpTime,
          timeDisplay: `${toPersianDigits(nextFollowUpTime)} صبح`,
          categories: ['phone'],
          priority: priority === 'urgent' ? 'urgent' : 'normal',
          status: 'pending',
          linkedApplicantId: saved.id,
          customLinks: [],
          smsNotification: true,
          registerInCartable: true,
          calendarStatus: 'none',
          syncStatus: 'local',
          aiFilledFields: [],
        });
      }

      await refreshSnapshot();
      showToast(`پرونده متقاضی «${saved.name}» با موفقیت ذخیره شد.`, 'success');

      runWithViewTransition(() => {
        if (navigateToMatches) {
          navigate(`/search?applicantId=${encodeURIComponent(saved.id)}`);
        } else {
          navigate('/applicants');
        }
      });
    } finally {
      setSaving(false);
    }
  };

  const maxBudgetNumber = parseNumericInput(maxBudgetStr);

  return (
    <div className="relative z-10 max-w-md mx-auto min-h-screen flex flex-col pb-40">
      {/* Sticky Header (Exact match to Image 2.html) */}
      <header className="sticky top-0 z-30 bg-[#050b18]/85 backdrop-blur-xl border-b border-white/10 px-4 pt-5 pb-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (isEdit) markReturningToList();
                runWithViewTransition(() => navigate(isEdit ? (-1 as any) : '/applicants'));
              }}
              className="w-10 h-10 rounded-xl glass-card flex items-center justify-center border border-white/15 text-white hover:border-[#f1cb83]/50 active:scale-95 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
            <KelidLogoIcon className="w-10 h-10" />
            <div>
              <h1 className="text-lg font-extrabold text-white gold-text-glow">
                {isEdit ? 'ویرایش پرونده متقاضی' : 'ثبت متقاضی جدید'}
              </h1>
              <p className="text-[11px] text-slate-300 font-medium">
                پرونده هوشمند خریدار و سرمایه‌گذار
              </p>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/40 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[#f1cb83] text-sm">badge</span>
            <span className="text-xs font-extrabold text-[#f1cb83]">
              کد متقاضی: {autoCode} (خودکار)
            </span>
          </div>
        </div>
      </header>

      {/* Form Body */}
      <main className="px-4 pt-4 space-y-5 flex-1">
        {/* Quick Voice Assistant Banner */}
        <div className="glass-card rounded-2xl p-3.5 border border-[#f1cb83]/35 bg-gradient-to-l from-[#f1cb83]/15 via-[#0c162d]/80 to-[#0c162d]/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#f1cb83]/20 border border-[#f1cb83]/50 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">
                record_voice_over
              </span>
            </div>
            <div>
              <h2 className="text-xs font-extrabold text-white">
                ثبت صوتی سریع اطلاعات متقاضی
              </h2>
              <p className="text-[11px] text-slate-300 mt-0.5">
                با بیان مشخصات مشتری و بودجه، فرم به صورت هوشمند تکمیل می‌شود
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleVoiceFill}
            className={`px-3 py-2 rounded-xl text-xs font-extrabold shrink-0 flex items-center gap-1 active:scale-95 transition-transform cursor-pointer ${
              isVoiceActive ? 'bg-rose-500 text-white animate-pulse' : 'gold-pill-btn'
            }`}
          >
            <span className="material-symbols-outlined text-base">mic</span>
            <span>{isVoiceActive ? 'در حال شنیدن...' : 'شروع ضبط'}</span>
          </button>
        </div>

        {/* Section 1: Identity & Contact Info */}
        <section className="glass-card gold-border-glow rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">person_add</span>
              <h2 className="text-sm font-extrabold text-white">
                ۱. مشخصات هویتی و سطح اعتبار
              </h2>
            </div>
            <span className="text-[10px] text-[#f1cb83] bg-[#f1cb83]/10 px-2 py-0.5 rounded-md border border-[#f1cb83]/30">
              اطلاعات پایه
            </span>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                نام و نام خانوادگی متقاضی <span className="text-[#f1cb83]">*</span>
              </label>
              <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2">
                <span className="material-symbols-outlined text-slate-400 text-lg">person</span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="مثال: امیرحسین رضایی"
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-semibold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  شماره تماس اصلی <span className="text-[#f1cb83]">*</span>
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-400 text-lg">
                    phone_iphone
                  </span>
                  <input
                    type="tel"
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="09121234567"
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-semibold text-left"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  شماره تماس دوم / واتساپ
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-400 text-lg">call</span>
                  <input
                    type="tel"
                    dir="ltr"
                    value={secondPhone}
                    onChange={(e) => setSecondPhone(e.target.value)}
                    placeholder="اختیاری"
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium text-left"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">منبع آشنایی</label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center justify-between">
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-medium"
                  >
                    <option value="معرفی مشتریان قبلی" className="bg-[#080f20]">
                      معرفی مشتریان قبلی
                    </option>
                    <option value="پورتال‌های ملکی (دیوار/شیپور)" className="bg-[#080f20]">
                      پورتال‌های ملکی (دیوار/شیپور)
                    </option>
                    <option value="اینستاگرام و شبکه‌های اجتماعی" className="bg-[#080f20]">
                      اینستاگرام و شبکه‌های اجتماعی
                    </option>
                    <option value="مراجعه حضوری به دفتر" className="bg-[#080f20]">
                      مراجعه حضوری به دفتر
                    </option>
                    <option value="همکاران املاک" className="bg-[#080f20]">
                      همکاران املاک
                    </option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  معرف (در صورت وجود)
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-400 text-lg">
                    handshake
                  </span>
                  <input
                    type="text"
                    value={referrer}
                    onChange={(e) => setReferrer(e.target.value)}
                    placeholder="نام معرف یا همکار"
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-2">
                سطح اعتبار مالی و آمادگی خرید
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      tier: 'عالی' as CreditTier,
                      label: 'خریدار نقد (VIP)',
                      icon: 'workspace_premium',
                    },
                    {
                      tier: 'خوب' as CreditTier,
                      label: 'نقد + تهاتر/معاوضه',
                      icon: 'swap_horiz',
                    },
                    {
                      tier: 'عادی' as CreditTier,
                      label: 'نیاز به فروش ملک فعلی',
                      icon: 'schedule',
                    },
                  ] as const
                ).map((item) => {
                  const active = creditTier === item.tier;
                  return (
                    <button
                      key={item.tier}
                      type="button"
                      onClick={() => setCreditTier(item.tier)}
                      className={`py-2 px-2 rounded-xl text-[11px] flex flex-col items-center gap-1 transition-all cursor-pointer ${
                        active
                          ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-extrabold shadow-sm'
                          : 'bg-white/5 border border-white/10 text-slate-300 font-semibold'
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-base ${
                          active ? 'text-emerald-300' : 'text-[#f1cb83]'
                        }`}
                      >
                        {item.icon}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Budget & Financial Terms */}
        <section className="glass-card gold-border-glow rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">
                account_balance_wallet
              </span>
              <h2 className="text-sm font-extrabold text-white">
                ۲. توان مالی و بودجه خرید (تومان)
              </h2>
            </div>
            <span className="text-[10px] text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-md border border-emerald-400/30 font-bold">
              محاسبه خودکار حروفی
            </span>
          </div>

          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  حداقل بودجه (تومان)
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center justify-between">
                  <input
                    type="text"
                    dir="ltr"
                    value={toPersianDigits(minBudgetStr)}
                    onChange={(e) => setMinBudgetStr(formatWithSeparator(e.target.value, false))}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-extrabold text-left tracking-wide"
                  />
                  <span className="text-[10px] text-slate-400 mr-1.5 shrink-0">تومان</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  حداکثر بودجه / سقف خرید <span className="text-[#f1cb83]">*</span>
                </label>
                <div
                  className={`glass-input rounded-xl px-3 py-2.5 flex items-center justify-between border-[#f1cb83]/50 ${
                    aiFilledFields.includes('maxBudget') ? 'ai-shimmer-field' : ''
                  }`}
                >
                  <input
                    type="text"
                    dir="ltr"
                    value={toPersianDigits(maxBudgetStr)}
                    onChange={(e) => setMaxBudgetStr(formatWithSeparator(e.target.value, false))}
                    className="bg-transparent border-none outline-none text-xs text-[#f1cb83] w-full font-extrabold text-left tracking-wide"
                  />
                  <span className="text-[10px] text-[#f1cb83] mr-1.5 shrink-0">تومان</span>
                </div>
              </div>
            </div>

            {/* Live Persian Words Box */}
            <div className="rounded-xl bg-[#080f20]/85 border border-[#f1cb83]/35 p-3 flex items-start gap-2.5">
              <span className="material-symbols-outlined text-[#f1cb83] text-lg mt-0.5">
                spellcheck
              </span>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300 font-medium">
                    معادل حروفی سقف بودجه:
                  </span>
                  <span className="text-[10px] text-[#f1cb83] font-bold">واحد: تومان</span>
                </div>
                <p className="text-xs font-extrabold text-white mt-1 leading-relaxed">
                  {amountToTomanWords(maxBudgetNumber)}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                شرایط پرداخت و تهاتر
              </label>
              <div className="glass-input rounded-xl px-3 py-2.5">
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs text-white w-full font-medium"
                >
                  <option value="نقدی کامل در محضر" className="bg-[#080f20]">
                    نقدی کامل در محضر
                  </option>
                  <option value="نقد + اقساط کوتاه‌مدت" className="bg-[#080f20]">
                    نقد + اقساط کوتاه‌مدت
                  </option>
                  <option value="معاوضه با آپارتمان تهران" className="bg-[#080f20]">
                    معاوضه با آپارتمان تهران
                  </option>
                  <option value="معاوضه با خودرو یا ملک دیگر" className="bg-[#080f20]">
                    معاوضه با خودرو یا ملک دیگر
                  </option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                توضیحات ملک یا دارایی جهت معاوضه (در صورت وجود)
              </label>
              <div className="glass-input rounded-xl px-3 py-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-slate-400 text-lg">
                  currency_exchange
                </span>
                <input
                  type="text"
                  value={barterDescription}
                  onChange={(e) => setBarterDescription(e.target.value)}
                  placeholder="مثال: آپارتمان ۱۲۰ متری سعادت‌آباد به ارزش ۶ میلیارد..."
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Desired Property Preferences */}
        <section className="glass-card gold-border-glow rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">tune</span>
              <h2 className="text-sm font-extrabold text-white">
                ۳. مشخصات ملک درخواستی (مبنای تطبیق هوشمند)
              </h2>
            </div>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-200 mb-2">نوع معامله</label>
              <div className="grid grid-cols-3 gap-2">
                {(['خرید قطعی', 'سرمایه‌گذاری', 'مشارکت در ساخت'] as const).map((dt) => (
                  <button
                    key={dt}
                    type="button"
                    onClick={() => setDealType(dt)}
                    className={`py-2 rounded-xl text-xs transition-all cursor-pointer ${
                      dealType === dt
                        ? 'gold-pill-btn font-extrabold'
                        : 'bg-white/5 border border-white/15 text-slate-200 font-semibold'
                    }`}
                  >
                    {dt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-2">
                نوع ملک مورد تقاضا (امکان انتخاب چندگانه)
              </label>
              <div className="flex flex-wrap gap-2">
                {DESIRED_TYPES_OPTIONS.map((t) => {
                  const selected = desiredTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleDesiredType(t)}
                      className={`px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 transition-all cursor-pointer ${
                        selected
                          ? 'bg-[#f1cb83]/20 border border-[#f1cb83] text-[#f1cb83] font-bold'
                          : 'bg-white/5 border border-white/15 text-slate-300 font-medium'
                      }`}
                    >
                      {selected && (
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                      )}
                      <span>{t}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  محدوده و شهرهای مورد نظر
                </label>
                <div
                  className={`glass-input rounded-xl px-3 py-2.5 flex items-center gap-2 ${
                    aiFilledFields.includes('cities') ? 'ai-shimmer-field' : ''
                  }`}
                >
                  <span className="material-symbols-outlined text-[#f1cb83] text-lg">
                    location_on
                  </span>
                  <input
                    type="text"
                    value={citiesInput}
                    onChange={(e) => setCitiesInput(e.target.value)}
                    placeholder="کلارآباد، متل قو..."
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-semibold"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  شهرک یا خیابان خاص
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-400 text-lg">map</span>
                  <input
                    type="text"
                    value={specificArea}
                    onChange={(e) => setSpecificArea(e.target.value)}
                    placeholder="مثال: شهرک امیردشت، خیابان دریاگوشه"
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  حداقل متراژ زمین (متر مربع)
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center justify-between">
                  <input
                    type="text"
                    dir="ltr"
                    value={toPersianDigits(minAreaStr)}
                    onChange={(e) => setMinAreaStr(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-bold text-left"
                  />
                  <span className="text-[10px] text-slate-400 mr-1">متر</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  حداکثر متراژ زمین (متر مربع)
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center justify-between">
                  <input
                    type="text"
                    dir="ltr"
                    value={toPersianDigits(maxAreaStr)}
                    onChange={(e) => setMaxAreaStr(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-bold text-left"
                  />
                  <span className="text-[10px] text-slate-400 mr-1">متر</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  کاربری و بافت مورد قبول
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <select
                    value={acceptedZoning}
                    onChange={(e) => setAcceptedZoning(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-medium"
                  >
                    <option value="فقط داخل بافت مسکونی" className="bg-[#080f20]">
                      فقط داخل بافت مسکونی
                    </option>
                    <option value="بافت زرد / الحاق به بافت" className="bg-[#080f20]">
                      بافت زرد / الحاق به بافت
                    </option>
                    <option value="باغی و خارج بافت (سرمایه‌گذاری)" className="bg-[#080f20]">
                      باغی و خارج بافت (سرمایه‌گذاری)
                    </option>
                    <option value="فرقی نمی‌کند" className="bg-[#080f20]">
                      فرقی نمی‌کند
                    </option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  حداقل نوع سند قابل قبول
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <select
                    value={minDeedType}
                    onChange={(e) => setMinDeedType(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-medium"
                  >
                    <option value="فقط سند تک‌برگ شش‌دانگ" className="bg-[#080f20]">
                      فقط سند تک‌برگ شش‌دانگ
                    </option>
                    <option value="سند شاهنشاهی / بنچاق معتبر" className="bg-[#080f20]">
                      سند شاهنشاهی / بنچاق معتبر
                    </option>
                    <option value="نسق و شورایی تایید شده" className="bg-[#080f20]">
                      نسق و شورایی تایید شده
                    </option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-2">
                اولویت‌های کلیدی و امکانات مورد نیاز
              </label>
              <div className="flex flex-wrap gap-2">
                {PRIORITY_TAGS_OPTIONS.map((tag) => {
                  const selected = priorityFeatures.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => togglePriorityFeature(tag)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-1 transition-all cursor-pointer ${
                        selected
                          ? 'bg-[#f1cb83]/15 border border-[#f1cb83]/50 text-[#f1cb83] font-bold'
                          : 'bg-white/5 border border-white/10 text-slate-300'
                      }`}
                    >
                      <span className="material-symbols-outlined text-xs">
                        {selected ? 'verified' : 'add'}
                      </span>
                      <span>{tag}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: Follow-up & Advisor Notes */}
        <section className="glass-card gold-border-glow rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">
                event_upcoming
              </span>
              <h2 className="text-sm font-extrabold text-white">
                ۴. پیگیری، اولویت و یادداشت‌های مشاور
              </h2>
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  وضعیت فعلی پرونده
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ApplicantRecord['status'])}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-medium"
                  >
                    <option value="جدید" className="bg-[#080f20]">
                      متقاضی جدید (ثبت اولیه)
                    </option>
                    <option value="در حال پیگیری" className="bg-[#080f20]">
                      در حال پیگیری و ارسال فایل
                    </option>
                    <option value="بازدید" className="bg-[#080f20]">
                      هماهنگی جهت بازدید حضوری
                    </option>
                    <option value="معامله‌شده" className="bg-[#080f20]">
                      خرید انجام شده / مختومه
                    </option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  سطح اولویت پیگیری
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as ApplicantRecord['priority'])}
                    className="bg-transparent border-none outline-none text-xs text-amber-300 w-full font-bold"
                  >
                    <option value="urgent" className="bg-[#080f20]">
                      فوری (آماده قرارداد)
                    </option>
                    <option value="vip" className="bg-[#080f20]">
                      اولویت بالا (VIP)
                    </option>
                    <option value="cash" className="bg-[#080f20]">
                      خریدار نقد
                    </option>
                    <option value="normal" className="bg-[#080f20]">
                      متوسط / عادی
                    </option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  تاریخ پیگیری بعدی
                </label>
                <button
                  type="button"
                  onClick={() => setIsDatePickerOpen(true)}
                  className="w-full glass-input rounded-xl px-3 py-2.5 flex items-center justify-between cursor-pointer text-right"
                >
                  <span className="text-xs text-white font-semibold">
                    {toPersianDigits(nextFollowUpDate)}
                  </span>
                  <span className="material-symbols-outlined text-[#f1cb83] text-lg">
                    calendar_month
                  </span>
                </button>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  ساعت یادآوری
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center justify-between">
                  <input
                    type="time"
                    value={nextFollowUpTime}
                    onChange={(e) => setNextFollowUpTime(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-semibold"
                  />
                  <span className="material-symbols-outlined text-[#f1cb83] text-lg">schedule</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[#f1cb83] text-xl">
                  notifications_active
                </span>
                <div>
                  <p className="text-xs font-bold text-white">
                    ثبت خودکار یادآور تماس در تقویم هوشمند
                  </p>
                  <p className="text-[10px] text-slate-300">
                    ارسال اعلان در زمان مقرر و نمایش در داشبورد روزانه
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={autoCalendarReminder}
                onChange={(e) => setAutoCalendarReminder(e.target.checked)}
                className="w-4 h-4 accent-[#f1cb83] rounded cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                یادداشت و تحلیل مشاور (شرایط خاص مشتری)
              </label>
              <div
                className={`glass-input rounded-xl p-3 relative ${
                  aiFilledFields.includes('notes') ? 'ai-shimmer-field' : ''
                }`}
              >
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="توضیحات تکمیلی درباره سلیقه مشتری، زمان حضور در شمال، حساسیت‌های سندی یا بودجه..."
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium resize-none leading-relaxed"
                />
                <div className="flex items-center justify-between pt-2 border-t border-white/10 mt-1">
                  <span className="text-[10px] text-slate-400">
                    قابل جستجو در موتور هوشمند کلید
                  </span>
                  <button
                    type="button"
                    onClick={handleVoiceFill}
                    className="flex items-center gap-1 text-[11px] text-[#f1cb83] font-bold hover:underline cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">mic</span>
                    <span>ضبط یادداشت صوتی</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Fixed Bottom Action Bar (Exact match to Image 2.html) */}
      <div className="fixed bottom-16 left-0 right-0 z-40 px-4 pb-3 pt-2 bg-gradient-to-t from-[#050b18] via-[#050b18]/95 to-transparent">
        <div className="max-w-md mx-auto glass-card rounded-2xl p-2.5 border border-[#f1cb83]/40 shadow-2xl space-y-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave(false)}
            className="w-full gold-pill-btn py-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 active:scale-98 transition-transform cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">save</span>
            <span>{isEdit ? 'بروزرسانی پرونده متقاضی' : 'ثبت و ذخیره پرونده متقاضی'}</span>
          </button>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(true)}
              className="col-span-2 py-2.5 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/50 text-[#f1cb83] text-xs font-extrabold flex items-center justify-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">auto_awesome</span>
              <span>ذخیره و نمایش املاک منطبق</span>
            </button>
            <button
              type="button"
              onClick={() => runWithViewTransition(() => navigate('/applicants'))}
              className="col-span-1 py-2.5 rounded-xl bg-white/5 border border-white/15 text-slate-300 text-xs font-bold flex items-center justify-center gap-1 active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">close</span>
              <span>انصراف</span>
            </button>
          </div>
        </div>
      </div>

      {isDatePickerOpen && (
        <JalaliDatePickerModal
          initialValue={nextFollowUpDate}
          title="انتخاب تاریخ پیگیری بعدی"
          onClose={() => setIsDatePickerOpen(false)}
          onSelect={(d) => {
            setNextFollowUpDate(d);
            setIsDatePickerOpen(false);
          }}
        />
      )}
    </div>
  );
};
