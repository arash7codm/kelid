import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { JalaliDatePickerModal } from '../components/JalaliDatePickerModal';
import { KelidLogoIcon } from '../components/Layout';
import { saveApplicant, softDeleteEntity } from '../db/repositories';
import { ApplicantRecord, PropertyRecord } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { runWithViewTransition } from '../motion';
import { triggerPhoneCall, triggerSms } from '../services/maps';
import { calculateMatchScore } from '../services/matching';
import { VoiceSessionController } from '../services/voice';
import {
  amountToTomanWords,
  formatToman,
  isJalaliDateOverdue,
  normalizePersianText,
  parseNumericInput,
  rangeToTomanWords,
  toPersianDigits,
} from '../utils/persian';

export const ApplicantsListScreen: React.FC = () => {
  const navigate = useNavigate();
  const {
    snapshot,
    currentUser,
    applicantFilters,
    setApplicantFilters,
    resetApplicantFilters,
    refreshSnapshot,
    showToast,
    askConfirm,
    askPermission,
  } = useApp();

  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [datePickerApplicant, setDatePickerApplicant] = useState<ApplicantRecord | null>(null);
  const [matchedModalApplicant, setMatchedModalApplicant] = useState<ApplicantRecord | null>(null);
  const [detailApplicant, setDetailApplicant] = useState<ApplicantRecord | null>(null);
  const voiceRef = useRef<VoiceSessionController | null>(null);

  const isViewer = currentUser.role === 'بیننده';
  const applicants = snapshot?.applicants || [];
  const properties = snapshot?.properties || [];
  const stats = snapshot?.applicantStats;

  const filteredApplicants = useMemo(() => {
    let list = [...applicants];

    if (applicantFilters.tab === 'following') {
      list = list.filter((a) => a.status === 'در حال پیگیری');
    } else if (applicantFilters.tab === 'new') {
      list = list.filter((a) => a.status === 'جدید');
    } else if (applicantFilters.tab === 'visit') {
      list = list.filter((a) => a.status === 'بازدید');
    } else if (applicantFilters.tab === 'done') {
      list = list.filter((a) => a.status === 'معامله‌شده');
    } else if (applicantFilters.tab === 'overdue') {
      list = list.filter(
        (a) =>
          a.nextFollowupDate &&
          isJalaliDateOverdue(a.nextFollowupDate) &&
          a.status !== 'معامله‌شده'
      );
    }

    if (applicantFilters.searchQuery.trim()) {
      const q = normalizePersianText(applicantFilters.searchQuery);
      list = list.filter((a) => {
        const hay = normalizePersianText(
          [
            a.code,
            a.name,
            a.phone,
            a.cities.join(' '),
            a.neighborhoods.join(' '),
            a.desiredPropertyTypes.join(' '),
            a.dealTypes.join(' '),
            a.confidentialNotes || '',
            a.barterDescription || '',
          ].join(' ')
        );
        return q.split(' ').every((tok) => hay.includes(tok));
      });
    }

    if (applicantFilters.dealType) {
      list = list.filter((a) => a.dealTypes.includes(applicantFilters.dealType));
    }
    if (applicantFilters.city) {
      const c = normalizePersianText(applicantFilters.city);
      list = list.filter((a) =>
        a.cities.some((city) => normalizePersianText(city).includes(c))
      );
    }
    if (applicantFilters.priority) {
      list = list.filter((a) => a.priority === applicantFilters.priority);
    }
    if (applicantFilters.creditTier) {
      list = list.filter((a) => a.creditTier === applicantFilters.creditTier);
    }
    const minB = parseNumericInput(applicantFilters.minBudget);
    const maxB = parseNumericInput(applicantFilters.maxBudget);
    if (minB > 0) {
      list = list.filter((a) => a.maxBudget >= minB);
    }
    if (maxB > 0) {
      list = list.filter((a) => a.maxBudget <= maxB);
    }

    return list;
  }, [applicants, applicantFilters]);

  const getApplicantMatches = (
    applicant: ApplicantRecord
  ): { property: PropertyRecord; score: number; reasons: string[] }[] => {
    return properties
      .filter((p) => !p.deleted && p.status !== 'فروخته‌شده' && p.status !== 'غیرفعال')
      .map((prop) => {
        const res = calculateMatchScore(applicant, prop);
        return {
          property: prop,
          score: res.score,
          reasons: res.reasons,
        };
      })
      .filter((m) => m.score >= 70)
      .sort((a, b) => b.score - a.score);
  };

  const handleVoiceSearch = async () => {
    if (isVoiceListening) {
      voiceRef.current?.stop();
      setIsVoiceListening(false);
      return;
    }
    const allowed = await askPermission('microphone');
    if (!allowed) return;
    setIsVoiceListening(true);
    const session = new VoiceSessionController({
      onLiveTranscript: (text) => {
        setApplicantFilters((prev) => ({ ...prev, searchQuery: text }));
      },
      onSilenceTimeout: (msg) => {
        setIsVoiceListening(false);
        showToast(msg, 'info');
      },
      onRecordingComplete: () => {
        setIsVoiceListening(false);
      },
      onError: (err) => {
        setIsVoiceListening(false);
        showToast(err, 'error');
      },
    });
    voiceRef.current = session;
    await session.start();
  };

  const handleUpdateFollowUpDate = async (newDate: string) => {
    if (!datePickerApplicant) return;
    await saveApplicant({
      ...datePickerApplicant,
      nextFollowupDate: newDate,
    });
    await refreshSnapshot();
    setDatePickerApplicant(null);
    showToast(`زمان پیگیری بعدی به ${toPersianDigits(newDate)} تغییر یافت.`, 'success');
  };

  const handleDeleteApplicant = async (applicant: ApplicantRecord) => {
    if (isViewer) return;
    const confirmed = await askConfirm({
      title: 'حذف پرونده متقاضی',
      message: `آیا از حذف پرونده «${applicant.name}» (${applicant.code}) اطمینان دارید؟`,
      confirmLabel: 'بله، حذف شود',
      danger: true,
    });
    if (!confirmed) return;

    const undo = await softDeleteEntity('applicants', applicant.id);
    await refreshSnapshot();
    if (detailApplicant?.id === applicant.id) setDetailApplicant(null);
    showToast(`پرونده «${applicant.name}» حذف شد.`, 'info', async () => {
      await undo();
      await refreshSnapshot();
      showToast('پرونده متقاضی بازیابی شد.', 'success');
    });
  };

  const goRoute = (path: string) => {
    runWithViewTransition(() => {
      navigate(path);
    });
  };

  const priorityLabel = (p: ApplicantRecord['priority']) => {
    if (p === 'vip') return 'VIP ویژه';
    if (p === 'urgent') return 'فوری';
    if (p === 'cash') return 'خریدار نقد';
    return 'اولویت عادی';
  };

  return (
    <div className="relative z-10 max-w-md mx-auto min-h-screen flex flex-col pb-28">
      {/* Header Section (Exact match to Image 4.html) */}
      <header className="pt-5 px-4 pb-3 sticky top-0 z-30 bg-[#050b18]/85 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2.5">
            <KelidLogoIcon className="w-10 h-10" />
            <div>
              <h1 className="text-lg font-extrabold text-white tracking-tight gold-text-glow">
                مدیریت متقاضیان و مشتریان
              </h1>
              <p className="text-[11px] text-slate-300 font-medium">
                لیست یکپارچه خریداران و سرمایه‌گذاران
              </p>
            </div>
          </div>

          {!isViewer && (
            <button
              type="button"
              onClick={() => goRoute('/applicants/new')}
              className="gold-pill-btn px-3.5 py-2 rounded-xl flex items-center gap-1.5 text-xs font-extrabold active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-base font-bold">add</span>
              <span>افزودن متقاضی</span>
            </button>
          )}
        </div>

        {/* Search & Quick Add Bar */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 glass-input rounded-xl px-3 py-2 flex items-center gap-2 border border-white/15 focus-within:border-[#f1cb83]/60 transition-colors">
            <span className="material-symbols-outlined text-[#f1cb83] text-lg">search</span>
            <input
              type="text"
              value={applicantFilters.searchQuery}
              onChange={(e) =>
                setApplicantFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
              }
              placeholder="جستجوی نام، شماره، بودجه یا منطقه..."
              className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
            />
            {applicantFilters.searchQuery && (
              <button
                type="button"
                onClick={() => setApplicantFilters((prev) => ({ ...prev, searchQuery: '' }))}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleVoiceSearch}
              title="جستجوی صوتی"
              className={`transition-colors flex items-center justify-center ${
                isVoiceListening ? 'text-rose-400 animate-pulse' : 'text-slate-400 hover:text-[#f1cb83]'
              }`}
            >
              <span className="material-symbols-outlined text-lg">mic</span>
            </button>
            <span className="w-[1px] h-4 bg-white/15 mx-0.5" />
            <button
              type="button"
              onClick={() => setIsFilterSheetOpen(true)}
              title="فیلتر پیشرفته"
              className="text-[#f1cb83] hover:text-white transition-colors flex items-center justify-center relative"
            >
              <span className="material-symbols-outlined text-lg">tune</span>
            </button>
          </div>

          {!isViewer && (
            <button
              type="button"
              onClick={() => goRoute('/applicants/new?quick=1')}
              className="glass-card px-3 py-2 rounded-xl border border-[#f1cb83]/30 flex items-center gap-1 text-[#f1cb83] text-xs font-bold shrink-0 active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">bolt</span>
              <span>ثبت سریع</span>
            </button>
          )}
        </div>

        {/* Horizontal Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {[
            { id: 'all', label: `همه (${toPersianDigits(stats?.total ?? applicants.length)})` },
            {
              id: 'following',
              label: `در حال پیگیری (${toPersianDigits(stats?.following ?? 0)})`,
            },
            { id: 'new', label: `جدید (${toPersianDigits(stats?.newCount ?? 0)})` },
            { id: 'visit', label: `مشتاق بازدید (${toPersianDigits(stats?.visitCount ?? 0)})` },
            { id: 'done', label: `انجام‌شده (${toPersianDigits(stats?.doneCount ?? 0)})` },
            {
              id: 'overdue',
              label: `معوقه (${toPersianDigits(stats?.overdue ?? 0)})`,
              isDanger: true,
            },
          ].map((tab) => {
            const active = applicantFilters.tab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() =>
                  setApplicantFilters((prev) => ({
                    ...prev,
                    tab: tab.id as typeof prev.tab,
                  }))
                }
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all cursor-pointer flex items-center gap-1 ${
                  active
                    ? 'gold-pill-btn font-extrabold shadow-sm'
                    : tab.isDanger
                    ? 'glass-card text-rose-300 border border-rose-500/30 hover:border-rose-400/60'
                    : 'glass-card text-slate-200 border border-white/15 hover:border-[#f1cb83]/40'
                }`}
              >
                {tab.isDanger && !active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                )}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content: Applicant Cards List */}
      <main className="px-4 pt-4 space-y-4 flex-1">
        {filteredApplicants.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center border border-white/15 my-6">
            <div className="mb-2 flex justify-center">
              <KelidLogoIcon className="w-12 h-12" />
            </div>
            <p className="text-sm font-bold text-white mb-1">متقاضی منطبق با فیلتر یافت نشد</p>
            <p className="text-xs text-slate-400 mb-4">
              می‌توانید فیلترها را پاک کنید یا یک پرونده متقاضی جدید ثبت نمایید.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={resetApplicantFilters}
                className="px-4 py-2 rounded-xl bg-white/10 text-xs font-bold text-white border border-white/15"
              >
                پاک کردن فیلترها
              </button>
              {!isViewer && (
                <button
                  type="button"
                  onClick={() => goRoute('/applicants/new')}
                  className="gold-pill-btn px-4 py-2 rounded-xl text-xs font-extrabold"
                >
                  افزودن متقاضی جدید
                </button>
              )}
            </div>
          </div>
        ) : (
          filteredApplicants.map((applicant) => {
            const matches = getApplicantMatches(applicant);
            const isOverdue =
              Boolean(applicant.nextFollowupDate) &&
              isJalaliDateOverdue(applicant.nextFollowupDate) &&
              applicant.status !== 'معامله‌شده';

            return (
              <article
                key={applicant.id}
                className="glass-card gold-border-glow rounded-2xl p-4 relative overflow-hidden transition-all"
              >
                {isOverdue && (
                  <div className="absolute top-0 left-0 bg-rose-500/20 border-b border-r border-rose-400/40 px-2.5 py-0.5 rounded-br-xl flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                    <span className="text-[10px] font-bold text-rose-200">معوقه</span>
                  </div>
                )}

                <div
                  onClick={() => setDetailApplicant(applicant)}
                  className="flex items-start justify-between gap-2 mb-3 cursor-pointer"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-[#f1cb83]/15 border border-[#f1cb83]/40 text-[#f1cb83] text-[10px] font-bold">
                        {applicant.code}
                      </span>
                      <h2 className="text-base font-extrabold text-white hover:text-[#f1cb83] transition-colors">
                        {applicant.name}
                      </h2>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                        person_check
                      </span>
                      <span>
                        {applicant.dealTypes.join(' / ')} ({applicant.status})
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1 pt-2">
                    <div className="flex items-center gap-1">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-0.5 border ${
                          applicant.priority === 'urgent'
                            ? 'bg-rose-500/25 border-rose-400/50 text-rose-200'
                            : applicant.priority === 'vip'
                            ? 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                            : 'bg-sky-500/20 border-sky-400/40 text-sky-200'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[12px]">
                          local_fire_department
                        </span>
                        {priorityLabel(applicant.priority)}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold">
                        {applicant.creditTier}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Budget Box with Words */}
                <div className="bg-[#080f20]/70 rounded-xl p-3 border border-white/10 mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-slate-300 font-medium flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm text-[#f1cb83]">
                        account_balance_wallet
                      </span>
                      بودجه خرید:
                    </span>
                    <span className="text-sm font-extrabold text-[#f1cb83] tracking-tight">
                      {formatToman(applicant.maxBudget)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300/90 text-left font-medium border-t border-white/5 pt-1">
                    {rangeToTomanWords(applicant.minBudget, applicant.maxBudget) ||
                      amountToTomanWords(applicant.maxBudget)}
                  </p>
                </div>

                {/* Desired Property Requirements Tags */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-200 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                      home_work
                    </span>
                    {applicant.desiredPropertyTypes.join(' / ')}
                  </span>
                  {applicant.cities.length > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-200 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                        location_on
                      </span>
                      {applicant.cities.join(' / ')}
                    </span>
                  )}
                  {applicant.minArea > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-200 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                        square_foot
                      </span>
                      حداقل {toPersianDigits(applicant.minArea)} متر
                    </span>
                  )}
                  {applicant.desiredDeeds.length > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-200 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                        verified
                      </span>
                      {applicant.desiredDeeds[0]}
                    </span>
                  )}
                  {applicant.barterDescription && (
                    <span className="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-400/30 text-[11px] text-purple-200 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-purple-300">
                        swap_horiz
                      </span>
                      {applicant.barterDescription}
                    </span>
                  )}
                </div>

                {/* Smart Match Banner */}
                <div className="rounded-xl bg-gradient-to-l from-[#f1cb83]/20 via-[#f1cb83]/10 to-transparent border border-[#f1cb83]/40 p-2.5 mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#f1cb83]/20 flex items-center justify-center border border-[#f1cb83]/50">
                      <span className="material-symbols-outlined text-[#f1cb83] text-base">
                        auto_awesome
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-extrabold text-white">
                        تطبیق هوشمند: {toPersianDigits(matches.length)} ملک با امتیاز بالای ۷۰٪ یافت
                        شد
                      </p>
                      <p className="text-[10px] text-[#f1cb83]">
                        {matches.length > 0
                          ? `بهترین تطبیق: ${matches[0].property.title} (${toPersianDigits(
                              matches[0].score
                            )}٪)`
                          : 'بر اساس منطقه، متراژ و بودجه متقاضی'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMatchedModalApplicant(applicant)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#f1cb83] text-[#050b18] text-[11px] font-extrabold shrink-0 flex items-center gap-0.5 shadow-sm active:scale-95 transition-transform cursor-pointer"
                  >
                    <span>مشاهده املاک</span>
                    <span className="material-symbols-outlined text-xs">chevron_left</span>
                  </button>
                </div>

                {/* Follow-up Status & Quick Actions Footer */}
                <div className="flex items-center justify-between pt-2.5 border-t border-white/10 text-[11px]">
                  <div className="space-y-0.5">
                    <p className="text-slate-300 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-slate-400">
                        history
                      </span>
                      آخرین تماس:{' '}
                      <span className="text-white font-semibold">
                        {toPersianDigits(applicant.lastContactDate || 'ثبت نشده')}
                      </span>
                    </p>
                    <p
                      className={`flex items-center gap-1 font-semibold ${
                        isOverdue ? 'text-rose-300 font-bold' : 'text-amber-300'
                      }`}
                    >
                      <span className="material-symbols-outlined text-xs">
                        {isOverdue ? 'warning' : 'notifications_active'}
                      </span>
                      پیگیری بعدی:{' '}
                      <span>{toPersianDigits(applicant.nextFollowupDate || 'تعیین نشده')}</span>
                    </p>
                  </div>

                  {!isViewer && (
                    <button
                      type="button"
                      onClick={() => setDatePickerApplicant(applicant)}
                      className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/15 text-[10px] text-slate-200 hover:border-[#f1cb83]/50 flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                        edit_calendar
                      </span>
                      تغییر زمان
                    </button>
                  )}
                </div>

                {/* Action Buttons Bar */}
                <div className="grid grid-cols-4 gap-2 mt-3 pt-2.5 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => triggerPhoneCall(applicant.phone)}
                    className="py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">call</span>
                    <span>تماس</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerSms(
                        applicant.phone,
                        `سلام ${applicant.name} عزیز، از مشاورین املاک کلید جهت معرفی فایل‌های منتخب با شما در تماس هستم.`
                      )
                    }
                    className="py-2 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-300 flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">sms</span>
                    <span>پیامک</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      goRoute(`/reminders?newForApplicant=${encodeURIComponent(applicant.id)}`)
                    }
                    className="py-2 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/30 text-[#f1cb83] flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">add_task</span>
                    <span>ثبت پیگیری</span>
                  </button>
                  {!isViewer ? (
                    <button
                      type="button"
                      onClick={() => goRoute(`/applicants/${applicant.id}/edit`)}
                      className="py-2 rounded-xl bg-white/10 border border-white/15 text-slate-200 flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                      <span>ویرایش</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDetailApplicant(applicant)}
                      className="py-2 rounded-xl bg-white/10 border border-white/15 text-slate-200 flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">visibility</span>
                      <span>جزئیات</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </main>

      {/* Matched Properties Modal */}
      {matchedModalApplicant && (
        <div
          onClick={() => setMatchedModalApplicant(null)}
          className="fixed inset-0 z-50 bg-[#050a16]/80 backdrop-blur-xl flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sheet-enter-up w-full max-w-md rounded-3xl p-5 bg-[#0c1326]/95 border border-[#f1cb83]/35 shadow-2xl max-h-[82vh] flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
              <div>
                <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[#f1cb83]">auto_awesome</span>
                  املاک منطبق با «{matchedModalApplicant.name}»
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  امتیاز تطبیق بالای ۷۰٪ بر اساس بودجه، منطقه، متراژ و سند
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMatchedModalApplicant(null)}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {getApplicantMatches(matchedModalApplicant).length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  در حال حاضر ملکی با امتیاز بالای ۷۰٪ برای این متقاضی یافت نشد.
                </div>
              ) : (
                getApplicantMatches(matchedModalApplicant).map((m) => (
                  <div
                    key={m.property.id}
                    onClick={() => {
                      setMatchedModalApplicant(null);
                      goRoute(`/properties/${m.property.id}`);
                    }}
                    className="p-3 rounded-2xl bg-white/5 border border-white/10 hover:border-[#f1cb83]/45 transition-all cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={m.property.photos[0]?.fallbackUrl || '/images/kelarabad-land.jpg'}
                        alt={m.property.title}
                        className="w-14 h-14 rounded-xl object-cover border border-white/15 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-[#f1cb83] bg-[#f1cb83]/15 px-1.5 py-0.5 rounded">
                            {m.property.code}
                          </span>
                          <h4 className="text-xs font-extrabold text-white truncate">
                            {m.property.title}
                          </h4>
                        </div>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          {m.property.city} • {toPersianDigits(m.property.area)} متر •{' '}
                          {formatToman(m.property.totalPrice)}
                        </p>
                        <p className="text-[10px] text-emerald-300 mt-0.5 truncate">
                          {m.reasons.join(' • ')}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-black">
                        {toPersianDigits(m.score)}٪
                      </span>
                      <span className="text-[10px] text-[#f1cb83] mt-1">مشاهده ملک</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Applicant Details Sheet */}
      {detailApplicant && (
        <div
          onClick={() => setDetailApplicant(null)}
          className="fixed inset-0 z-50 bg-[#050a16]/80 backdrop-blur-xl flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sheet-enter-up w-full max-w-md rounded-3xl p-5 bg-[#0c1326]/95 border border-[#f1cb83]/35 shadow-2xl space-y-3.5"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <span className="text-[10px] font-bold text-[#f1cb83] bg-[#f1cb83]/15 px-2 py-0.5 rounded">
                  {detailApplicant.code}
                </span>
                <h3 className="text-base font-black text-white mt-1">{detailApplicant.name}</h3>
                <p className="text-xs text-slate-400" dir="ltr">
                  {toPersianDigits(detailApplicant.phone)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailApplicant(null)}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-200 bg-white/5 p-3.5 rounded-2xl border border-white/10">
              <p>
                <span className="text-slate-400">بودجه: </span>
                <strong className="text-[#f1cb83]">
                  {amountToTomanWords(detailApplicant.maxBudget)}
                </strong>
              </p>
              <p>
                <span className="text-slate-400">مناطق مورد نظر: </span>
                {detailApplicant.cities.join('، ')}{' '}
                {detailApplicant.neighborhoods.length > 0
                  ? `(${detailApplicant.neighborhoods.join('، ')})`
                  : ''}
              </p>
              <p>
                <span className="text-slate-400">معرف: </span>
                {detailApplicant.referrerLabel}
              </p>
              {currentUser.role === 'مدیر' && detailApplicant.confidentialNotes && (
                <p className="pt-2 border-t border-white/10 leading-relaxed text-slate-300">
                  {detailApplicant.confidentialNotes}
                </p>
              )}
            </div>

            {!isViewer && (
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = detailApplicant.id;
                    setDetailApplicant(null);
                    goRoute(`/applicants/${id}/edit`);
                  }}
                  className="flex-1 gold-pill-btn py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                  <span>ویرایش کامل پرونده</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteApplicant(detailApplicant)}
                  className="px-4 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/35 text-rose-300 text-xs font-bold flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                  <span>حذف</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter Drawer Sheet */}
      {isFilterSheetOpen && (
        <div
          onClick={() => setIsFilterSheetOpen(false)}
          className="fixed inset-0 z-50 bg-[#050a16]/80 backdrop-blur-xl flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sheet-enter-up w-full max-w-md rounded-3xl p-5 bg-[#0c1326]/95 border border-[#f1cb83]/35 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#f1cb83]">tune</span>
                فیلتر پیشرفته متقاضیان
              </h3>
              <button
                type="button"
                onClick={() => setIsFilterSheetOpen(false)}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">نوع معامله</label>
                <select
                  value={applicantFilters.dealType}
                  onChange={(e) =>
                    setApplicantFilters((prev) => ({ ...prev, dealType: e.target.value }))
                  }
                  className="w-full glass-input rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="">همه</option>
                  <option value="خرید قطعی">خرید قطعی</option>
                  <option value="سرمایه‌گذاری">سرمایه‌گذاری</option>
                  <option value="مشارکت در ساخت">مشارکت در ساخت</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">سطح اعتبار</label>
                <select
                  value={applicantFilters.creditTier}
                  onChange={(e) =>
                    setApplicantFilters((prev) => ({ ...prev, creditTier: e.target.value }))
                  }
                  className="w-full glass-input rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="">همه</option>
                  <option value="خوش‌حساب / VIP">خوش‌حساب / VIP</option>
                  <option value="معمولی">معمولی</option>
                  <option value="نیاز به بررسی">نیاز به بررسی</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsFilterSheetOpen(false)}
                className="flex-1 gold-pill-btn py-2.5 rounded-xl text-xs font-extrabold"
              >
                اعمال فیلترها
              </button>
              <button
                type="button"
                onClick={() => {
                  resetApplicantFilters();
                  setIsFilterSheetOpen(false);
                }}
                className="px-4 py-2.5 rounded-xl bg-white/10 text-xs font-bold text-slate-300"
              >
                بازنشانی
              </button>
            </div>
          </div>
        </div>
      )}

      {datePickerApplicant && (
        <JalaliDatePickerModal
          initialValue={datePickerApplicant.nextFollowupDate}
          title="تغییر تاریخ پیگیری متقاضی"
          onClose={() => setDatePickerApplicant(null)}
          onSelect={(d) => handleUpdateFollowUpDate(d)}
        />
      )}
    </div>
  );
};
