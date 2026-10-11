import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { JalaliDatePickerModal } from '../components/JalaliDatePickerModal';
import { AmbientBackground, BottomNavAndQuickMenu, KelidLogoIcon } from '../components/Layout';
import { VoiceMicButton } from '../components/VoiceMicButton';
import { CreditTier } from '../config';
import {
  deleteCollaborator,
  generateNextCode,
  registerPlaceUsage,
  saveCollaborator,
  saveReminder,
} from '../db/repositories';
import { CollaboratorRecord } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { markReturningToList, runWithViewTransition } from '../motion';
import { VoiceSessionController } from '../services/voice';
import {
  addDaysToJalali,
  getTodayJalali,
  toPersianDigits,
  validateIranianMobile,
} from '../utils/persian';

const SPECIALTY_OPTIONS = [
  'زمین‌های مسکونی و شهرکی',
  'ویلاهای لوکس و نوساز',
  'پلاک اول ساحلی',
  'زمین‌های هکتاری و سرمایه‌گذاری',
  'مشارکت در ساخت و تهاتر',
  'فایل‌های زیر قیمت (اکازیون)',
];

export const CollaboratorFormScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { snapshot, refreshSnapshot, showToast, askPermission, askConfirm, currentUser } = useApp();
  const isViewer = currentUser.role === 'بیننده';

  const isEdit = Boolean(id);
  const [autoCode, setAutoCode] = useState('H-001');
  const [fullName, setFullName] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [roleType, setRoleType] = useState<CollaboratorRecord['role']>('مدیر آژانس');
  const [phone, setPhone] = useState('');
  const [secondPhone, setSecondPhone] = useState('');
  const [officeLandline, setOfficeLandline] = useState('');
  const [experienceYears, setExperienceYears] = useState('بیش از ۱۰ سال');

  const [coveredCitiesInput, setCoveredCitiesInput] = useState('');
  const [specialtyTowns, setSpecialtyTowns] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([
    'زمین‌های مسکونی و شهرکی',
  ]);
  const [officeAddress, setOfficeAddress] = useState('');

  const [commissionSplit, setCommissionSplit] = useState<'50_50' | 'bonus'>('50_50');
  const [trustTier, setTrustTier] = useState<CreditTier>('عالی');
  const [rating, setRating] = useState<number>(5);
  const [bankInfo, setBankInfo] = useState('');

  const [cooperationStatus, setCooperationStatus] = useState<
    CollaboratorRecord['cooperationStatus']
  >('همکاری فعال (VIP)');
  const [inquiryCycle, setInquiryCycle] = useState('هر هفته (پنجشنبه‌ها)');
  const [nextFollowUpDate, setNextFollowUpDate] = useState(
    addDaysToJalali(getTodayJalali(true), 3, true)
  );
  const [nextFollowUpTime, setNextFollowUpTime] = useState('10:30');
  const [autoPeriodicReminder, setAutoPeriodicReminder] = useState(true);
  const [notes, setNotes] = useState('');

  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const voiceRef = useRef<VoiceSessionController | null>(null);
  const nameFieldRef = useRef<HTMLDivElement | null>(null);
  const agencyFieldRef = useRef<HTMLDivElement | null>(null);
  const phoneFieldRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isEdit && id && snapshot) {
      const existing = snapshot.collaborators.find((c) => c.id === id);
      if (existing) {
        setAutoCode(existing.code);
        setFullName(existing.name);
        setAgencyName(existing.agencyName || '');
        setRoleType(existing.role);
        setPhone(existing.phone);
        setCoveredCitiesInput(existing.primaryCity);
        setSpecialtyTowns(existing.neighborhoods.join('، '));
        setSpecialties(existing.specializations);
        setCommissionSplit(existing.commissionSplit);
        setTrustTier(existing.performanceTier === 'neutral' ? 'عادی' : existing.performanceTier);
        setCooperationStatus(existing.cooperationStatus);
        if (existing.nextFollowupDate) setNextFollowUpDate(existing.nextFollowupDate);
        setNotes(existing.privateNotes || '');
      }
    } else {
      generateNextCode('H').then(setAutoCode);
      const draftRaw = sessionStorage.getItem('kelid_draft_collaborator_new');
      if (draftRaw) {
        try {
          const d = JSON.parse(draftRaw);
          if (d.fullName) setFullName(d.fullName);
          if (d.coveredCitiesInput) setCoveredCitiesInput(d.coveredCitiesInput);
          if (d.agencyName) setAgencyName(d.agencyName);
          if (d.notes) setNotes(d.notes);
          sessionStorage.removeItem('kelid_draft_collaborator_new');
        } catch {
          // ignore
        }
      }
    }
  }, [isEdit, id, snapshot]);

  const toggleSpecialty = (spec: string) => {
    setSpecialties((prev) =>
      prev.includes(spec) ? prev.filter((s) => s !== spec) : [...prev, spec]
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
      },
      onSilenceTimeout: (msg) => {
        setIsVoiceActive(false);
        showToast(msg, 'info');
      },
      onRecordingComplete: () => {
        setIsVoiceActive(false);
        showToast('یادداشت صوتی در پرونده همکار ثبت شد.', 'success');
      },
      onError: (err) => {
        setIsVoiceActive(false);
        showToast(err, 'error');
      },
    });
    voiceRef.current = session;
    await session.start();
  };

  const handleCaptureLocation = async () => {
    const allowed = await askPermission('geolocation');
    if (!allowed) return;
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => {
          showToast('موقعیت مکانی دفتر املاک ثبت شد.', 'success');
        },
        () => {
          showToast('موقعیت پیش‌فرض منطقه کلارآباد ثبت شد.', 'info');
        }
      );
    }
  };

  const validationErrors = useMemo(() => {
    const errors: { fullName?: string; agencyName?: string; phone?: string } = {};
    if (!fullName.trim()) {
      errors.fullName = 'وارد کردن نام و نام خانوادگی همکار الزامی است.';
    }
    if (!agencyName.trim()) {
      errors.agencyName = 'وارد کردن نام دفتر املاک یا مجموعه الزامی است.';
    }
    if (!validateIranianMobile(phone)) {
      errors.phone = 'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود.';
    }
    return errors;
  }, [fullName, agencyName, phone]);

  const handleSave = async (createPropertyNext = false) => {
    if (isViewer) return;
    setSubmittedOnce(true);

    if (validationErrors.fullName || validationErrors.agencyName || validationErrors.phone) {
      showToast('لطفاً فیلدهای ضروری مشخص‌شده را تکمیل نمایید.', 'error');
      if (validationErrors.fullName) {
        nameFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (validationErrors.agencyName) {
        agencyFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (validationErrors.phone) {
        phoneFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setSaving(true);
    try {
      const coveredCities = coveredCitiesInput
        .split(/[،,\/]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const hoods = specialtyTowns
        .split(/[،,\/]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const c of coveredCities) {
        await registerPlaceUsage(c, hoods);
      }

      const saved = await saveCollaborator({
        id: isEdit ? id : undefined,
        code: autoCode,
        name: fullName.trim(),
        agencyName: agencyName.trim(),
        role: roleType,
        phone: phone.trim(),
        gender: 'male',
        performanceTier: trustTier,
        primaryCity: coveredCities[0] || 'کلارآباد',
        neighborhoods: hoods,
        specializations: specialties.length ? specialties : ['زمین‌های مسکونی و شهرکی'],
        masteryBadges: ['داخل بافت', 'تک‌برگ عرصه'],
        commissionSplit,
        commissionNotes: bankInfo.trim() || officeAddress.trim(),
        cooperationStatus,
        nextFollowupDate: nextFollowUpDate,
        lastContactDate: getTodayJalali(true),
        lastContactResult: 'موفق',
        privateNotes: notes.trim(),
        successfulDealsCount: 0,
      });

      if (autoPeriodicReminder && !isEdit) {
        await saveReminder({
          title: `استعلام فایل جدید — ${saved.name} (${saved.agencyName || ''})`,
          transcript: `تماس دوره‌ای (${inquiryCycle}) جهت دریافت فایل‌های جدید منطقه ${saved.primaryCity}`,
          jalaliDate: nextFollowUpDate,
          time: nextFollowUpTime,
          timeDisplay: `${toPersianDigits(nextFollowUpTime)} صبح`,
          categories: ['phone'],
          priority: 'normal',
          status: 'pending',
          linkedCollaboratorId: saved.id,
          customLinks: [],
          smsNotification: true,
          registerInCartable: true,
          calendarStatus: 'none',
          syncStatus: 'local',
          aiFilledFields: [],
        });
      }

      setIsDirty(false);
      await refreshSnapshot();
      showToast(`پرونده همکار «${saved.name}» با موفقیت ذخیره شد.`, 'success');

      markReturningToList();
      runWithViewTransition(() => {
        if (createPropertyNext) {
          navigate(`/properties/new?collaboratorId=${encodeURIComponent(saved.id)}`);
        } else {
          navigate('/collaborators');
        }
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCollaborator = async () => {
    if (!isEdit || !id || isViewer) return;
    const confirmed = await askConfirm({
      title: `حذف همکار (${autoCode})`,
      message: 'آیا مطمئن هستید؟ این عمل قابل بازگشت نیست.',
      confirmLabel: 'حذف همکار',
      danger: true,
    });
    if (!confirmed) return;
    await deleteCollaborator(id);
    setIsDirty(false);
    await refreshSnapshot();
    showToast(`پرونده همکار ${autoCode} حذف شد`, 'info');
    markReturningToList();
    runWithViewTransition(() => navigate('/collaborators'));
  };

  const handleCloseWithGuard = async () => {
    if (isDirty) {
      const discard = await askConfirm({
        title: 'خروج بدون ذخیره تغییرات؟',
        message: 'اطلاعات واردشده در فرم همکار هنوز ذخیره نشده‌اند. آیا از خروج اطمینان دارید؟',
        confirmLabel: 'بله، خروج',
        danger: true,
      });
      if (!discard) return;
    }
    markReturningToList();
    runWithViewTransition(() => navigate('/collaborators'));
  };

  return (
    <div className="relative z-10 max-w-md mx-auto min-h-screen flex flex-col pb-48 bg-transparent">
      {/* Sticky Header (Exact match to Image 16.html) */}
      <header className="sticky top-0 z-30 bg-[#080d1a]/60 backdrop-blur-2xl border-b border-white/10 px-4 pt-5 pb-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCloseWithGuard}
              className="w-10 h-10 rounded-xl glass-card flex items-center justify-center border border-white/15 text-white hover:border-[#f1cb83]/50 active:scale-95 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
            <KelidLogoIcon className="w-10 h-10" />
            <div>
              <h1 className="text-lg font-extrabold text-white gold-text-glow">
                {isEdit ? 'ویرایش پرونده همکار' : 'ثبت همکار جدید'}
              </h1>
              <p className="text-[11px] text-slate-300 font-medium">
                افزودن به شبکه تبادل فایل و دفاتر منطقه
              </p>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/40 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[#f1cb83] text-sm">badge</span>
            <span className="text-xs font-extrabold text-[#f1cb83]">
              کد همکار: {autoCode} (خودکار)
            </span>
          </div>
        </div>
      </header>

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
              <h2 className="text-xs font-extrabold text-white">ثبت صوتی سریع اطلاعات همکار</h2>
              <p className="text-[11px] text-slate-300 mt-0.5">
                نام دفتر، محدوده فعالیت و شماره تماس را بیان کنید تا فرم پر شود
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

        {/* Section 1: Personal & Agency Identity */}
        <section className="glass-card gold-border-glow rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">storefront</span>
              <h2 className="text-sm font-extrabold text-white">
                ۱. مشخصات فردی و دفتر املاک
              </h2>
            </div>
            <span className="text-[10px] text-[#f1cb83] bg-[#f1cb83]/10 px-2 py-0.5 rounded-md border border-[#f1cb83]/30">
              اطلاعات هویتی
            </span>
          </div>

          <div className="space-y-3.5">
            <div ref={nameFieldRef}>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                نام و نام خانوادگی همکار <span className="text-[#f1cb83]">*</span>
              </label>
              <div
                className={`glass-input rounded-xl px-3 py-2.5 flex items-center gap-2 ${
                  submittedOnce && validationErrors.fullName ? 'border border-red-500' : ''
                }`}
              >
                <span className="material-symbols-outlined text-slate-400 text-lg">person</span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    setIsDirty(true);
                  }}
                  placeholder="مثال: مهندس کامران نادری"
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-semibold"
                />
              </div>
              {submittedOnce && validationErrors.fullName && (
                <p className="text-[11px] text-red-400 font-semibold mt-1">
                  {validationErrors.fullName}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div ref={agencyFieldRef}>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  نام دفتر املاک / مجموعه <span className="text-[#f1cb83]">*</span>
                </label>
                <div
                  className={`glass-input rounded-xl px-3 py-2.5 flex items-center gap-2 ${
                    submittedOnce && validationErrors.agencyName ? 'border border-red-500' : ''
                  }`}
                >
                  <span className="material-symbols-outlined text-[#f1cb83] text-lg">
                    apartment
                  </span>
                  <input
                    type="text"
                    value={agencyName}
                    onChange={(e) => {
                      setAgencyName(e.target.value);
                      setIsDirty(true);
                    }}
                    placeholder="مثال: املاک بزرگ رویال"
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-semibold"
                  />
                </div>
                {submittedOnce && validationErrors.agencyName && (
                  <p className="text-[11px] text-red-400 font-semibold mt-1">
                    {validationErrors.agencyName}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  نوع همکاری و سمت
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <select
                    value={roleType}
                    onChange={(e) => {
                      setRoleType(e.target.value as CollaboratorRecord['role']);
                      setIsDirty(true);
                    }}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-medium"
                  >
                    <option value="مدیر آژانس" className="bg-[#080f20]">
                      مدیر دفتر املاک
                    </option>
                    <option value="مشاور مستقل" className="bg-[#080f20]">
                      مشاور مستقل / فایل‌یاب
                    </option>
                    <option value="سرمایه‌گذار سازنده" className="bg-[#080f20]">
                      سازنده و سرمایه‌گذار
                    </option>
                    <option value="سرپرست رنج" className="bg-[#080f20]">
                      سرپرست رنج / کارشناس
                    </option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div ref={phoneFieldRef}>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  شماره همراه اول (اصلی) <span className="text-[#f1cb83]">*</span>
                </label>
                <div
                  className={`glass-input rounded-xl px-3 py-2.5 flex items-center gap-2 ${
                    submittedOnce && validationErrors.phone ? 'border border-red-500' : ''
                  }`}
                >
                  <span className="material-symbols-outlined text-slate-400 text-lg">
                    phone_iphone
                  </span>
                  <input
                    type="tel"
                    dir="ltr"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setIsDirty(true);
                    }}
                    placeholder="09111942233"
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-semibold text-left"
                  />
                </div>
                {submittedOnce && validationErrors.phone && (
                  <p className="text-[11px] text-red-400 font-semibold mt-1">
                    {validationErrors.phone}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  شماره واتساپ / خط دوم
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-400 text-lg">chat</span>
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
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  تلفن ثابت دفتر
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-400 text-lg">call</span>
                  <input
                    type="tel"
                    dir="ltr"
                    value={officeLandline}
                    onChange={(e) => setOfficeLandline(e.target.value)}
                    placeholder="011-5462XXXX"
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium text-left"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  سابقه فعالیت در منطقه
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <select
                    value={experienceYears}
                    onChange={(e) => setExperienceYears(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-medium"
                  >
                    <option value="بیش از ۱۰ سال" className="bg-[#080f20]">
                      بیش از ۱۰ سال
                    </option>
                    <option value="۵ تا ۱۰ سال" className="bg-[#080f20]">
                      ۵ تا ۱۰ سال
                    </option>
                    <option value="۲ تا ۵ سال" className="bg-[#080f20]">
                      ۲ تا ۵ سال
                    </option>
                    <option value="کمتر از ۲ سال" className="bg-[#080f20]">
                      کمتر از ۲ سال
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Coverage & Specialty */}
        <section className="glass-card gold-border-glow rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">
                explore_nearby
              </span>
              <h2 className="text-sm font-extrabold text-white">
                ۲. محدوده فعالیت و حوزه تخصص
              </h2>
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  شهرها و مناطق تحت پوشش اصلی <span className="text-[#f1cb83]">*</span>
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#f1cb83] text-lg">
                    location_on
                  </span>
                  <input
                    type="text"
                    value={coveredCitiesInput}
                    onChange={(e) => setCoveredCitiesInput(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-semibold"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  شهرک‌ها یا خیابان‌های تخصصی
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-400 text-lg">map</span>
                  <input
                    type="text"
                    value={specialtyTowns}
                    onChange={(e) => setSpecialtyTowns(e.target.value)}
                    placeholder="شهرک امیردشت، خوشامیان..."
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-2">
                حوزه تخصصی تبادل فایل (چند انتخابی)
              </label>
              <div className="flex flex-wrap gap-2">
                {SPECIALTY_OPTIONS.map((spec) => {
                  const selected = specialties.includes(spec);
                  return (
                    <button
                      key={spec}
                      type="button"
                      onClick={() => toggleSpecialty(spec)}
                      className={`px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 transition-all cursor-pointer ${
                        selected
                          ? 'bg-[#f1cb83]/20 border border-[#f1cb83] text-[#f1cb83] font-bold'
                          : 'bg-white/5 border border-white/15 text-slate-300 font-medium'
                      }`}
                    >
                      {selected && (
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                      )}
                      <span>{spec}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                آدرس دقیق دفتر املاک
              </label>
              <div className="glass-input rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1">
                  <span className="material-symbols-outlined text-slate-400 text-lg">pin_drop</span>
                  <input
                    type="text"
                    value={officeAddress}
                    onChange={(e) => setOfficeAddress(e.target.value)}
                    placeholder="کلارآباد، بلوار امام خمینی، جنب بانک ملت..."
                    className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCaptureLocation}
                  className="px-2.5 py-1 rounded-lg bg-[#f1cb83]/15 border border-[#f1cb83]/40 text-[#f1cb83] text-[10px] font-bold shrink-0 flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-xs">my_location</span>
                  <span>لوکیشن</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Commission Agreement & Trust Level */}
        <section className="glass-card gold-border-glow rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">handshake</span>
              <h2 className="text-sm font-extrabold text-white">
                ۳. شرایط همکاری، کمیسیون و سطح اعتماد
              </h2>
            </div>
            <span className="text-[10px] text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-md border border-emerald-400/30 font-bold">
              توافق مالی
            </span>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                توافق تقسیم کمیسیون (پورسانت مشترک)
              </label>
              <div className="glass-input rounded-xl px-3 py-2.5">
                <select
                  value={commissionSplit}
                  onChange={(e) => setCommissionSplit(e.target.value as '50_50' | 'bonus')}
                  className="bg-transparent border-none outline-none text-xs text-[#f1cb83] w-full font-extrabold"
                >
                  <option value="50_50" className="bg-[#080f20]">
                    ۵۰ / ۵۰ (نصف کامل توافقی)
                  </option>
                  <option value="bonus" className="bg-[#080f20]">
                    ۶۰ / ۴۰ به نفع معرفی‌کننده فایل
                  </option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-2">
                سطح اعتبار و خوش‌حسابی
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      tier: 'عالی' as CreditTier,
                      label: 'همکار ویژه (VIP)',
                      icon: 'verified',
                    },
                    {
                      tier: 'خوب' as CreditTier,
                      label: 'خوش‌حساب و تایید شده',
                      icon: 'thumb_up',
                    },
                    {
                      tier: 'عادی' as CreditTier,
                      label: 'همکار جدید',
                      icon: 'hourglass_top',
                    },
                  ] as const
                ).map((item) => {
                  const active = trustTier === item.tier;
                  return (
                    <button
                      key={item.tier}
                      type="button"
                      onClick={() => setTrustTier(item.tier)}
                      className={`py-2 px-2 rounded-xl text-[11px] flex flex-col items-center gap-1 transition-all cursor-pointer ${
                        active
                          ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-extrabold'
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

            <div className="flex items-center justify-between p-3 rounded-xl bg-[#080f20]/70 border border-white/10">
              <div>
                <p className="text-xs font-bold text-white">امتیاز عملکرد و پاسخگویی</p>
                <p className="text-[10px] text-slate-300">
                  بر اساس صحت اطلاعات فایل‌ها و سرعت هماهنگی بازدید
                </p>
              </div>
              <div className="flex items-center gap-0.5 text-amber-400">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="cursor-pointer"
                  >
                    <span
                      className={`material-symbols-outlined text-lg ${
                        star <= rating ? 'text-amber-400' : 'text-slate-600'
                      }`}
                    >
                      star
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                توضیحات مالی یا شماره کارت / شبا (اختیاری)
              </label>
              <div className="glass-input rounded-xl px-3 py-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-slate-400 text-lg">
                  credit_card
                </span>
                <input
                  type="text"
                  value={bankInfo}
                  onChange={(e) => setBankInfo(e.target.value)}
                  placeholder="شماره شبا یا شرایط تسویه کمیسیون..."
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: Follow-up & Confidential Notes */}
        <section className="glass-card gold-border-glow rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">event_repeat</span>
              <h2 className="text-sm font-extrabold text-white">
                ۴. برنامه پیگیری و یادداشت‌های مدیریتی
              </h2>
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  وضعیت همکاری
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <select
                    value={cooperationStatus}
                    onChange={(e) =>
                      setCooperationStatus(
                        e.target.value as CollaboratorRecord['cooperationStatus']
                      )
                    }
                    className="bg-transparent border-none outline-none text-xs text-white w-full font-medium"
                  >
                    <option value="همکاری فعال (VIP)" className="bg-[#080f20]">
                      فعال (در حال تبادل مستمر فایل)
                    </option>
                    <option value="تازه آشنا / جدید" className="bg-[#080f20]">
                      تازه آشنا / جدید
                    </option>
                    <option value="در حال ارزیابی" className="bg-[#080f20]">
                      در حال ارزیابی
                    </option>
                    <option value="غیرفعال / راکد" className="bg-[#080f20]">
                      غیرفعال موقت
                    </option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  دوره استعلام فایل‌های جدید
                </label>
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <select
                    value={inquiryCycle}
                    onChange={(e) => setInquiryCycle(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-[#f1cb83] w-full font-bold"
                  >
                    <option value="هر هفته (پنجشنبه‌ها)" className="bg-[#080f20]">
                      هر هفته (پنجشنبه‌ها)
                    </option>
                    <option value="هر دو هفته یک‌بار" className="bg-[#080f20]">
                      هر دو هفته یک‌بار
                    </option>
                    <option value="ماهانه" className="bg-[#080f20]">
                      ماهانه
                    </option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  تاریخ تماس بعدی جهت استعلام فایل
                </label>
                <button
                  type="button"
                  onClick={() => setIsDatePickerOpen(true)}
                  className="w-full glass-input rounded-xl px-3 py-2.5 flex items-center justify-between cursor-pointer"
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
                    ثبت یادآور استعلام دوره‌ای در تقویم هوشمند
                  </p>
                  <p className="text-[10px] text-slate-300">
                    یادآوری خودکار جهت دریافت فایل‌های جدید همکار
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={autoPeriodicReminder}
                onChange={(e) => setAutoPeriodicReminder(e.target.checked)}
                className="w-4 h-4 accent-[#f1cb83] rounded cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-1.5">
                یادداشت‌های محرمانه مدیر (سوابق، اخلاق حرفه‌ای، نکات مهم)
              </label>
              <div className="glass-input rounded-xl p-3">
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setIsDirty(true);
                  }}
                  placeholder="توضیحات درباره نحوه تعامل، فایل‌های اختصاصی که دارد، میزان صداقت در اعلام قیمت مالک..."
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium resize-none leading-relaxed"
                />
                <div className="flex items-center justify-between pt-2 border-t border-white/10 mt-1">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-[#f1cb83]">lock</span>
                    قابل مشاهده فقط برای مدیر سیستم
                  </span>
                  <VoiceMicButton
                    currentValue={notes}
                    append={true}
                    variant="gold-pill"
                    idleLabel="تایپ صوتی یادداشت"
                    onTextChange={(txt) => {
                      setNotes(txt);
                      setIsDirty(true);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Fixed Bottom Action Bar (Above BottomNav with safe-area support) */}
      <div className="fixed bottom-[76px] left-0 right-0 z-50 px-4 pb-2 pt-2 bg-gradient-to-t from-[#050b18] via-[#050b18]/95 to-transparent">
        <div className="max-w-md mx-auto glass-card rounded-2xl p-2.5 border border-[#f1cb83]/40 shadow-2xl space-y-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave(false)}
            className="w-full gold-pill-btn py-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 active:scale-98 transition-transform cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">save</span>
            <span>{isEdit ? 'بروزرسانی پرونده همکار' : 'ثبت و ذخیره پرونده همکار'}</span>
          </button>
          <div className="grid grid-cols-3 gap-2">
            {isEdit && !isViewer ? (
              <button
                type="button"
                onClick={handleDeleteCollaborator}
                className="col-span-1 py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/50 text-rose-300 text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-transform cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">delete</span>
                <span>حذف همکار</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSave(true)}
                className="col-span-2 py-2.5 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/50 text-[#f1cb83] text-xs font-extrabold flex items-center justify-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">add_home</span>
                <span>ذخیره و ثبت اولین ملک برای این همکار</span>
              </button>
            )}
            {isEdit && (
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSave(true)}
                className="col-span-1 py-2.5 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/50 text-[#f1cb83] text-[11px] font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-transform cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">add_home</span>
                <span>ثبت ملک</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseWithGuard}
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
          title="انتخاب تاریخ تماس بعدی با همکار"
          onClose={() => setIsDatePickerOpen(false)}
          onSelect={(d) => {
            setNextFollowUpDate(d);
            setIsDirty(true);
            setIsDatePickerOpen(false);
          }}
        />
      )}
    </div>
  );
};
