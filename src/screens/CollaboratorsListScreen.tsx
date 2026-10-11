import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { JalaliDatePickerModal } from '../components/JalaliDatePickerModal';
import { KelidLogoIcon } from '../components/Layout';
import { saveCollaborator, softDeleteEntity } from '../db/repositories';
import { CollaboratorRecord } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { runWithViewTransition } from '../motion';
import { triggerPhoneCall, triggerSms } from '../services/maps';
import { VoiceSessionController } from '../services/voice';
import { normalizePersianText, toPersianDigits } from '../utils/persian';

export const CollaboratorsListScreen: React.FC = () => {
  const navigate = useNavigate();
  const {
    snapshot,
    currentUser,
    setPropertyFilters,
    resetPropertyFilters,
    collaboratorFilters,
    setCollaboratorFilters,
    refreshSnapshot,
    showToast,
    askConfirm,
    askPermission,
  } = useApp();

  const searchQuery = collaboratorFilters.searchQuery;
  const setSearchQuery = (val: string) =>
    setCollaboratorFilters((prev) => ({ ...prev, searchQuery: val }));
  const activeTab = (collaboratorFilters.cityChip || 'all') as
    | 'all'
    | 'agency'
    | 'independent'
    | 'builder'
    | 'withFiles';
  const setActiveTab = (
    val: 'all' | 'agency' | 'independent' | 'builder' | 'withFiles'
  ) => setCollaboratorFilters((prev) => ({ ...prev, cityChip: val }));
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [datePickerCollab, setDatePickerCollab] = useState<CollaboratorRecord | null>(null);
  const [detailCollab, setDetailCollab] = useState<CollaboratorRecord | null>(null);
  const voiceRef = useRef<VoiceSessionController | null>(null);

  const isViewer = currentUser.role === 'بیننده';
  const collaborators = snapshot?.collaborators || [];
  const properties = snapshot?.properties || [];
  const stats = snapshot?.collaboratorStats;

  const getCollaboratorProperties = (collab: CollaboratorRecord) => {
    return properties.filter(
      (p) =>
        !p.deleted &&
        (p.referrerCollaboratorId === collab.id ||
          (p.contactPartnerName &&
            normalizePersianText(p.contactPartnerName).includes(
              normalizePersianText(collab.name)
            )))
    );
  };

  const tabCounts = useMemo(() => {
    const all = collaborators.length;
    const agency = collaborators.filter((c) => c.role === 'مدیر آژانس').length;
    const independent = collaborators.filter(
      (c) => c.role === 'مشاور مستقل' || c.role === 'سرپرست رنج'
    ).length;
    const builder = collaborators.filter((c) => c.role === 'سرمایه‌گذار سازنده').length;
    return { all, agency, independent, builder };
  }, [collaborators]);

  const filteredCollaborators = useMemo(() => {
    let list = [...collaborators];
    if (activeTab === 'agency') {
      list = list.filter((c) => c.role === 'مدیر آژانس');
    } else if (activeTab === 'independent') {
      list = list.filter((c) => c.role === 'مشاور مستقل' || c.role === 'سرپرست رنج');
    } else if (activeTab === 'builder') {
      list = list.filter((c) => c.role === 'سرمایه‌گذار سازنده');
    } else if (activeTab === 'withFiles') {
      list = list.filter((c) => getCollaboratorProperties(c).length > 0);
    }

    if (searchQuery.trim()) {
      const q = normalizePersianText(searchQuery);
      list = list.filter((c) => {
        const hay = normalizePersianText(
          [
            c.code,
            c.name,
            c.agencyName || '',
            c.role,
            c.phone,
            c.primaryCity,
            c.neighborhoods.join(' '),
            c.specializations.join(' '),
          ].join(' ')
        );
        return q.split(' ').every((tok) => hay.includes(tok));
      });
    }
    return list;
  }, [collaborators, activeTab, searchQuery, properties]);

  const totalSuccessfulDeals = useMemo(() => {
    return collaborators.reduce((acc, c) => acc + (c.successfulDealsCount || 0), 0);
  }, [collaborators]);

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
      onLiveTranscript: (text) => setSearchQuery(text),
      onSilenceTimeout: (msg) => {
        setIsVoiceListening(false);
        showToast(msg, 'info');
      },
      onRecordingComplete: () => setIsVoiceListening(false),
      onError: (err) => {
        setIsVoiceListening(false);
        showToast(err, 'error');
      },
    });
    voiceRef.current = session;
    await session.start();
  };

  const handleUpdateFollowUpDate = async (newDate: string) => {
    if (!datePickerCollab) return;
    await saveCollaborator({
      ...datePickerCollab,
      nextFollowupDate: newDate,
    });
    await refreshSnapshot();
    setDatePickerCollab(null);
    showToast(`زمان تماس بعدی با همکار به ${toPersianDigits(newDate)} تغییر یافت.`, 'success');
  };

  const handleDeleteCollaborator = async (collab: CollaboratorRecord) => {
    if (isViewer) return;
    const confirmed = await askConfirm({
      title: 'حذف پرونده همکار',
      message: `آیا از حذف پرونده «${collab.name}» (${collab.code}) اطمینان دارید؟`,
      confirmLabel: 'بله، حذف شود',
      danger: true,
    });
    if (!confirmed) return;

    const undo = await softDeleteEntity('collaborators', collab.id);
    await refreshSnapshot();
    if (detailCollab?.id === collab.id) setDetailCollab(null);
    showToast(`پرونده «${collab.name}» حذف شد.`, 'info', async () => {
      await undo();
      await refreshSnapshot();
      showToast('پرونده همکار بازیابی شد.', 'success');
    });
  };

  const handleViewCollaboratorProperties = (collab: CollaboratorRecord) => {
    resetPropertyFilters();
    setPropertyFilters((prev) => ({
      ...prev,
      collaboratorIdFilter: collab.id,
      searchQuery: collab.name,
    }));
    runWithViewTransition(() => {
      navigate('/properties');
    });
  };

  const goRoute = (path: string) => {
    runWithViewTransition(() => {
      navigate(path);
    });
  };

  return (
    <div className="relative z-10 max-w-md mx-auto min-h-screen flex flex-col pb-28">
      {/* Header Section (Exact match to Image 6.html) */}
      <header className="pt-5 px-4 pb-3 sticky top-0 z-30 bg-[#050b18]/85 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2.5">
            <KelidLogoIcon className="w-10 h-10" />
            <div>
              <h1 className="text-lg font-extrabold text-white tracking-tight gold-text-glow">
                مدیریت همکاران و دفاتر
              </h1>
              <p className="text-[11px] text-slate-300 font-medium">
                شبکه تبادل فایل و مشاورین منطقه
              </p>
            </div>
          </div>

          {!isViewer && (
            <button
              type="button"
              onClick={() => goRoute('/collaborators/new')}
              className="gold-pill-btn px-3.5 py-2 rounded-xl flex items-center gap-1.5 text-xs font-extrabold active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-base font-bold">person_add</span>
              <span>افزودن همکار</span>
            </button>
          )}
        </div>

        {/* Search & Quick Add Bar */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 glass-input rounded-xl px-3 py-2 flex items-center gap-2 border border-white/15 focus-within:border-[#f1cb83]/60 transition-colors">
            <span className="material-symbols-outlined text-[#f1cb83] text-lg">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجوی نام همکار، نام دفتر، شماره یا منطقه..."
              className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleVoiceSearch}
              className={`transition-colors flex items-center justify-center ${
                isVoiceListening ? 'text-rose-400 animate-pulse' : 'text-slate-400 hover:text-[#f1cb83]'
              }`}
            >
              <span className="material-symbols-outlined text-lg">mic</span>
            </button>
          </div>

          {!isViewer && (
            <button
              type="button"
              onClick={() => goRoute('/collaborators/new?quick=1')}
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
            { id: 'all', label: `همه همکاران (${toPersianDigits(tabCounts.all)})` },
            { id: 'agency', label: `دفاتر املاک (${toPersianDigits(tabCounts.agency)})` },
            { id: 'independent', label: `مشاورین آزاد (${toPersianDigits(tabCounts.independent)})` },
            {
              id: 'builder',
              label: `سازندگان و سرمایه‌گذاران (${toPersianDigits(tabCounts.builder)})`,
            },
            { id: 'withFiles', label: 'دارای فایل فعال' },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all cursor-pointer ${
                  active
                    ? 'gold-pill-btn font-extrabold shadow-sm'
                    : 'glass-card text-slate-200 border border-white/15 hover:border-[#f1cb83]/40'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="px-4 pt-4 space-y-4 flex-1">
        {/* Quick Summary KPI Strip */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="glass-card rounded-xl p-2.5 border border-white/10 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#f1cb83]/15 border border-[#f1cb83]/30 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[#f1cb83] text-lg">folder_shared</span>
            </div>
            <div>
              <p className="text-sm font-extrabold text-white">
                {toPersianDigits(stats?.receivedFilesCount ?? 0)} فایل
              </p>
              <p className="text-[10px] text-slate-300">املاک مشترک فعال</p>
            </div>
          </div>

          <div className="glass-card rounded-xl p-2.5 border border-white/10 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-emerald-400 text-lg">verified</span>
            </div>
            <div>
              <p className="text-sm font-extrabold text-white">
                {toPersianDigits(collaborators.length)} همکار
              </p>
              <p className="text-[10px] text-slate-300">همکاران تایید شده</p>
            </div>
          </div>

          <div className="glass-card rounded-xl p-2.5 border border-white/10 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-400/30 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-amber-400 text-lg">
                workspace_premium
              </span>
            </div>
            <div>
              <p className="text-sm font-extrabold text-white">
                {toPersianDigits(totalSuccessfulDeals)} معامله
              </p>
              <p className="text-[10px] text-slate-300">معاملات مشترک موفق</p>
            </div>
          </div>
        </div>

        {/* Collaborator Cards */}
        {filteredCollaborators.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center border border-white/15 my-6">
            <div className="mb-2 flex justify-center">
              <KelidLogoIcon className="w-12 h-12" />
            </div>
            <p className="text-sm font-bold text-white mb-1">هنوز همکاری در شبکه ثبت نشده است</p>
            <p className="text-xs text-slate-400 mb-4">
              برای تبادل فایل و ثبت املاک مشترک، اولین همکار یا دفتر املاک منطقه را اضافه کنید.
            </p>
            {!isViewer && (
              <button
                type="button"
                onClick={() => goRoute('/collaborators/new')}
                className="gold-pill-btn px-4 py-2 rounded-xl text-xs font-extrabold cursor-pointer"
              >
                + ثبت همکار جدید
              </button>
            )}
          </div>
        ) : (
          filteredCollaborators.map((collab) => {
            const linkedProps = getCollaboratorProperties(collab);
            const activeFilesCount = linkedProps.length;
            const isVip = collab.cooperationStatus.includes('VIP');

          return (
            <article
              key={collab.id}
              className="glass-card gold-border-glow rounded-2xl p-4 relative overflow-hidden"
            >
              {/* Top-left Trust Badge */}
              <div
                className={`absolute top-0 left-0 px-2.5 py-0.5 rounded-br-xl flex items-center gap-1 border-b border-r ${
                  isVip
                    ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                    : 'bg-sky-500/20 border-sky-400/40 text-sky-200'
                }`}
              >
                <span className="material-symbols-outlined text-xs">
                  {isVip ? 'verified' : 'thumb_up'}
                </span>
                <span className="text-[10px] font-bold">
                  {isVip ? 'همکار ویژه (VIP)' : collab.performanceTier}
                </span>
              </div>

              {/* Card Header */}
              <div
                onClick={() => setDetailCollab(collab)}
                className="flex items-start justify-between gap-2 mb-3 pt-1 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#f1cb83]/30 to-[#0f172a] border border-[#f1cb83]/50 flex items-center justify-center shrink-0 shadow-md">
                    <span className="material-symbols-outlined text-[#f1cb83] text-2xl">
                      {collab.role === 'مدیر آژانس' ? 'storefront' : 'person_pin_circle'}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-[#f1cb83]/15 border border-[#f1cb83]/40 text-[#f1cb83] text-[10px] font-bold">
                        {collab.code}
                      </span>
                      <h2 className="text-base font-extrabold text-white hover:text-[#f1cb83] transition-colors">
                        {collab.name}
                      </h2>
                    </div>
                    <p className="text-xs text-[#f1cb83] font-bold mt-0.5 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">apartment</span>
                      <span>{collab.agencyName || collab.role}</span>
                    </p>
                  </div>
                </div>

                {/* Star Rating */}
                <div className="flex flex-col items-end gap-1 pt-3">
                  <div className="flex items-center gap-0.5 text-amber-400">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span key={star} className="material-symbols-outlined text-xs text-amber-400">
                        star
                      </span>
                    ))}
                  </div>
                  <span className="text-[10px] text-slate-300 font-medium">اعتبار: عالی (۵/۵)</span>
                </div>
              </div>

              {/* Shared Portfolio Stats Box */}
              <div className="bg-[#080f20]/70 rounded-xl p-3 border border-white/10 mb-3 grid grid-cols-3 gap-2 text-center">
                <div className="border-l border-white/10 pl-2">
                  <p className="text-xs font-extrabold text-[#f1cb83]">
                    {toPersianDigits(activeFilesCount)} فایل فعال
                  </p>
                  <p className="text-[10px] text-slate-300 mt-0.5">املاک ارسالی</p>
                </div>
                <div className="border-l border-white/10 pl-2">
                  <p className="text-xs font-extrabold text-emerald-300">
                    {toPersianDigits(collab.successfulDealsCount)} معامله
                  </p>
                  <p className="text-[10px] text-slate-300 mt-0.5">همکاری موفق</p>
                </div>
                <div>
                  <p className="text-xs font-extrabold text-white">
                    {collab.commissionSplit === '50_50' ? '۵۰ / ۵۰' : 'درصد ویژه'}
                  </p>
                  <p className="text-[10px] text-slate-300 mt-0.5">توافق کمیسیون</p>
                </div>
              </div>

              {/* Specialties & Area Tags */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-200 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                    location_on
                  </span>
                  {collab.primaryCity}{' '}
                  {collab.neighborhoods.length > 0 ? `/ ${collab.neighborhoods.join('، ')}` : ''}
                </span>
                {collab.specializations.slice(0, 2).map((spec) => (
                  <span
                    key={spec}
                    className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-200 flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                      landscape
                    </span>
                    {spec}
                  </span>
                ))}
              </div>

              {/* Linked Properties Banner */}
              <div className="rounded-xl bg-gradient-to-l from-[#f1cb83]/20 via-[#f1cb83]/10 to-transparent border border-[#f1cb83]/40 p-2.5 mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#f1cb83]/20 flex items-center justify-center border border-[#f1cb83]/50">
                    <span className="material-symbols-outlined text-[#f1cb83] text-base">
                      real_estate_agent
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-extrabold text-white">
                      املاک ثبت‌شده توسط این همکار: {toPersianDigits(activeFilesCount)} فایل فعال
                    </p>
                    <p className="text-[10px] text-[#f1cb83]">
                      {linkedProps.length > 0
                        ? `آخرین فایل: ${linkedProps[0].title} (کد ${linkedProps[0].code})`
                        : 'آماده تبادل فایل در منطقه'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleViewCollaboratorProperties(collab)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#f1cb83] text-[#050b18] text-[11px] font-extrabold shrink-0 flex items-center gap-0.5 shadow-sm active:scale-95 transition-transform cursor-pointer"
                >
                  <span>مشاهده فایل‌ها</span>
                  <span className="material-symbols-outlined text-xs">chevron_left</span>
                </button>
              </div>

              {/* Last Interaction & Follow-up Status */}
              <div className="flex items-center justify-between pt-2.5 border-t border-white/10 text-[11px]">
                <div className="space-y-0.5">
                  <p className="text-slate-300 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-slate-400">
                      history
                    </span>
                    آخرین تبادل فایل:{' '}
                    <span className="text-white font-semibold">
                      {toPersianDigits(collab.lastContactDate || 'ثبت نشده')}
                    </span>
                  </p>
                  <p className="text-amber-300 flex items-center gap-1 font-semibold">
                    <span className="material-symbols-outlined text-xs">event_repeat</span>
                    پیگیری بعدی استعلام فایل:{' '}
                    <span>{toPersianDigits(collab.nextFollowupDate || 'تعیین نشده')}</span>
                  </p>
                </div>

                {!isViewer && (
                  <button
                    type="button"
                    onClick={() => setDatePickerCollab(collab)}
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
                  onClick={() => triggerPhoneCall(collab.phone)}
                  className="py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">call</span>
                  <span>تماس</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerSms(
                      collab.phone,
                      `سلام و عرض ادب خدمت ${collab.name} گرامی، جهت استعلام فایل‌های جدید کلارآباد و متل قو مزاحم شدم.`
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
                    goRoute(`/properties/new?collaboratorId=${encodeURIComponent(collab.id)}`)
                  }
                  className="py-2 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/30 text-[#f1cb83] flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">add_home</span>
                  <span>ثبت فایل</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    goRoute(`/reminders?newForCollaborator=${encodeURIComponent(collab.id)}`)
                  }
                  className="py-2 rounded-xl bg-white/10 border border-white/15 text-slate-200 flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">add_task</span>
                  <span>ثبت پیگیری</span>
                </button>
              </div>
            </article>
          );
        })
        )}
      </main>

      {/* Collaborator Detail Modal */}
      {detailCollab && (
        <div
          onClick={() => setDetailCollab(null)}
          className="fixed inset-0 z-50 bg-[#050a16]/80 backdrop-blur-xl flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sheet-enter-up w-full max-w-md rounded-3xl p-5 bg-[#0c1326]/95 border border-[#f1cb83]/35 shadow-2xl space-y-3.5"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <span className="text-[10px] font-bold text-[#f1cb83] bg-[#f1cb83]/15 px-2 py-0.5 rounded">
                  {detailCollab.code}
                </span>
                <h3 className="text-base font-black text-white mt-1">{detailCollab.name}</h3>
                <p className="text-xs text-[#f1cb83] font-bold">
                  {detailCollab.agencyName || detailCollab.role}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailCollab(null)}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-200 bg-white/5 p-3.5 rounded-2xl border border-white/10">
              <p>
                <span className="text-slate-400">شماره همراه: </span>
                <span dir="ltr">{toPersianDigits(detailCollab.phone)}</span>
              </p>
              <p>
                <span className="text-slate-400">توافق کمیسیون: </span>
                {detailCollab.commissionSplit === '50_50' ? '۵۰ / ۵۰ (نصف کامل)' : 'پورسانت ویژه'}
              </p>
              <p>
                <span className="text-slate-400">منطقه اصلی: </span>
                {detailCollab.primaryCity} ({detailCollab.neighborhoods.join('، ')})
              </p>
              {currentUser.role === 'مدیر' && detailCollab.privateNotes && (
                <p className="pt-2 border-t border-white/10 leading-relaxed text-slate-300">
                  {detailCollab.privateNotes}
                </p>
              )}
            </div>

            {!isViewer && (
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = detailCollab.id;
                    setDetailCollab(null);
                    goRoute(`/collaborators/${id}/edit`);
                  }}
                  className="flex-1 gold-pill-btn py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                  <span>ویرایش پرونده همکار</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteCollaborator(detailCollab)}
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

      {datePickerCollab && (
        <JalaliDatePickerModal
          initialValue={datePickerCollab.nextFollowupDate}
          title="تغییر تاریخ پیگیری همکار"
          onClose={() => setDatePickerCollab(null)}
          onSelect={(d) => handleUpdateFollowUpDate(d)}
        />
      )}
    </div>
  );
};
