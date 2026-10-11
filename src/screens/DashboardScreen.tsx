import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KelidLogoIcon } from '../components/Layout';
import { VoiceMicButton } from '../components/VoiceMicButton';
import { getMediaBlobUrl } from '../db/repositories';
import { db, PropertyRecord } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { triggerPhoneCall } from '../services/maps';
import {
  searchApplicantsSmart,
  searchCollaboratorsSmart,
  searchPropertiesSmart,
  searchRemindersSmart,
} from '../services/search';
import {
  exportBackupPackage,
  getStorageQuotaEstimate,
  mergeSnapshotIntoLocalDb,
  parseUploadedBackupFile,
  runCloudBackupAndSync,
  runPullOnlyRefresh,
  SnapshotPackage,
} from '../services/sync';
import { VoiceSessionController } from '../services/voice';
import {
  formatToman,
  getRelativeTimePersian,
  getTodayDashChip,
  toPersianDigits,
} from '../utils/persian';

const PropertyThumbImage: React.FC<{ property: PropertyRecord; className?: string }> = ({
  property,
  className = 'w-full h-full object-cover transition-transform duration-500 hover:scale-110',
}) => {
  const firstPhoto = property.photos?.[0];
  const [src, setSrc] = useState<string>(
    firstPhoto?.fallbackUrl || './images/kelarabad-land.jpg'
  );

  useEffect(() => {
    let active = true;
    if (firstPhoto?.mediaId) {
      getMediaBlobUrl(firstPhoto.mediaId).then((url) => {
        if (active && url) setSrc(url);
      });
    } else if (firstPhoto?.fallbackUrl) {
      setSrc(firstPhoto.fallbackUrl);
    }
    return () => {
      active = false;
    };
  }, [firstPhoto?.mediaId, firstPhoto?.fallbackUrl]);

  return <img src={src} alt={property.title} className={className} />;
};

export const DashboardScreen: React.FC = () => {
  const navigate = useNavigate();
  const {
    snapshot,
    currentUser,
    refreshSnapshot,
    showToast,
    askPermission,
    setPropertyFilters,
    resetPropertyFilters,
    setInboxInitialTab,
  } = useApp();

  const [matchAccordionOpen, setMatchAccordionOpen] = useState(true);
  const [alertsAccordionOpen, setAlertsAccordionOpen] = useState(true);

  // Global Smart Search & Filter Sheet
  const [globalQuery, setGlobalQuery] = useState('');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [globalFilterEntity, setGlobalFilterEntity] = useState<string>('all');
  const [globalFilterStatus, setGlobalFilterStatus] = useState<string>('all');
  const [globalFilterCity, setGlobalFilterCity] = useState<string>('all');
  const [isVoiceListening, setIsVoiceListening] = useState(false);

  // Sync & Backup States
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStepText, setSyncStepText] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState({
    usageMB: 0,
    quotaMB: 0,
    percent: 0,
    nearFull: false,
  });
  const [importPreviewModal, setImportPreviewModal] = useState<{
    pkg: SnapshotPackage;
    preview: { addedCount: number; updatedCount: number; unchangedCount: number };
  } | null>(null);

  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<VoiceSessionController | null>(null);

  useEffect(() => {
    getStorageQuotaEstimate().then(setStorageInfo);
    return () => {
      voiceRef.current?.cancel();
    };
  }, [snapshot]);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (globalFilterEntity !== 'all') c++;
    if (globalFilterStatus !== 'all') c++;
    if (globalFilterCity !== 'all') c++;
    return c;
  }, [globalFilterEntity, globalFilterStatus, globalFilterCity]);

  // Global Search Results across all entities
  const globalSearchResults = useMemo(() => {
    if (!snapshot) return null;
    const q = globalQuery.trim();
    if (!q && activeFilterCount === 0) return null;

    const filterByCityAndStatus = (city?: string, status?: string) => {
      if (globalFilterCity !== 'all' && city && !city.includes(globalFilterCity)) return false;
      if (globalFilterStatus !== 'all' && status && status !== globalFilterStatus) return false;
      return true;
    };

    const props =
      globalFilterEntity === 'all' || globalFilterEntity === 'properties'
        ? searchPropertiesSmart(snapshot.properties || [], q).filter((h) =>
            filterByCityAndStatus(h.item.city, h.item.status)
          )
        : [];

    const apps =
      globalFilterEntity === 'all' || globalFilterEntity === 'applicants'
        ? searchApplicantsSmart(snapshot.applicants || [], q).filter((h) =>
            filterByCityAndStatus((h.item.cities || []).join(' '), h.item.status)
          )
        : [];

    const cols =
      globalFilterEntity === 'all' || globalFilterEntity === 'collaborators'
        ? searchCollaboratorsSmart(
            snapshot.collaborators || [],
            snapshot.properties || [],
            q
          ).filter((h) => filterByCityAndStatus(h.item.primaryCity, h.item.cooperationStatus))
        : [];

    const rems =
      globalFilterEntity === 'all' || globalFilterEntity === 'reminders'
        ? searchRemindersSmart(
            snapshot.reminders || [],
            snapshot.properties || [],
            snapshot.applicants || [],
            snapshot.collaborators || [],
            q
          )
        : [];

    return {
      props,
      apps,
      cols,
      rems,
      total: props.length + apps.length + cols.length + rems.length,
    };
  }, [snapshot, globalQuery, globalFilterEntity, globalFilterStatus, globalFilterCity, activeFilterCount]);

  // Active Match Suggestions (>= 70% and not dismissed)
  const activeSuggestions = useMemo(() => {
    if (!snapshot?.matchLinks) return [];
    return snapshot.matchLinks
      .filter((m) => !m.dismissed && m.score >= 70)
      .sort((a, b) => b.score - a.score)
      .map((m) => {
        const applicant = (snapshot.applicants || []).find((a) => a.id === m.applicantId);
        const property = (snapshot.properties || []).find((p) => p.id === m.propertyId);
        if (!applicant || !property) return null;
        return { link: m, applicant, property };
      })
      .filter(Boolean) as Array<{
      link: (typeof snapshot.matchLinks)[0];
      applicant: (typeof snapshot.applicants)[0];
      property: (typeof snapshot.properties)[0];
    }>;
  }, [snapshot]);

  const handleVoiceSearch = async () => {
    if (isVoiceListening) {
      voiceRef.current?.stop();
      setIsVoiceListening(false);
      return;
    }
    const allowed = await askPermission('microphone');
    if (!allowed) return;

    const ctrl = new VoiceSessionController({
      onLiveTranscript: (txt) => setGlobalQuery(txt),
      onSilenceTimeout: (msg) => {
        setIsVoiceListening(false);
        showToast(msg, 'info');
      },
      onRecordingComplete: ({ transcript }) => {
        setIsVoiceListening(false);
        if (transcript) setGlobalQuery(transcript);
      },
      onError: (err) => {
        setIsVoiceListening(false);
        showToast(err, 'error');
      },
    });
    voiceRef.current = ctrl;
    const started = await ctrl.start();
    if (started) setIsVoiceListening(true);
  };

  const handleCloudBackup = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await runCloudBackupAndSync((step) => setSyncStepText(step));
      await refreshSnapshot();
      showToast(`پشتیبان‌گیری ابری انجام شد: ${res.message}`, 'success');
    } catch (e: any) {
      showToast(e?.message || 'خطا در پشتیبان‌گیری ابری', 'error');
    } finally {
      setIsSyncing(false);
      setSyncStepText(null);
    }
  };

  const handlePullRefresh = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await runPullOnlyRefresh((step) => setSyncStepText(step));
      await refreshSnapshot();
      showToast(`به‌روزرسانی انجام شد: ${res.message}`, 'success');
    } catch (e: any) {
      showToast(e?.message || 'خطا در دریافت آخرین نسخه', 'error');
    } finally {
      setIsSyncing(false);
      setSyncStepText(null);
    }
  };

  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const result = await parseUploadedBackupFile(file);
      setImportPreviewModal(result);
    } catch (err: any) {
      showToast(err?.message || 'خطا در خواندن فایل پشتیبان', 'error');
    }
  };

  const confirmMergeImport = async () => {
    if (!importPreviewModal) return;
    try {
      const summary = await mergeSnapshotIntoLocalDb(importPreviewModal.pkg);
      setImportPreviewModal(null);
      await refreshSnapshot();
      showToast(summary.message, 'success');
    } catch (err: any) {
      showToast(err?.message || 'خطا در ادغام فایل پشتیبان', 'error');
    }
  };

  const dismissMatchPair = async (linkId: string) => {
    await db.matchLinks.update(linkId, { dismissed: true });
    await refreshSnapshot();
    showToast('پیشنهاد از فهرست فعلی بسته شد', 'info');
  };

  const dismissPermitWarning = async (propertyId: string) => {
    await db.properties.update(propertyId, { dismissPermitWarning: true });
    await refreshSnapshot();
    showToast('هشدار انقضای جواز این ملک دیگر نمایش داده نمی‌شود', 'info');
  };

  const openPropertiesWithFilter = (opts: {
    status?: string;
    sortBy?: 'cheapest' | 'ppm' | 'area' | 'newest';
    sortAsc?: boolean;
  }) => {
    resetPropertyFilters();
    setPropertyFilters((prev) => ({
      ...prev,
      status: opts.status || 'همه وضعیت‌ها',
      sortBy: opts.sortBy || 'newest',
      sortAsc: opts.sortAsc ?? false,
    }));
    navigate('/properties');
  };

  const statusDotClass =
    snapshot?.syncStatusColor === 'red'
      ? 'bg-red-500 shadow-[0_0_10px_#ef4444]'
      : snapshot?.syncStatusColor === 'yellow'
      ? 'bg-amber-400 shadow-[0_0_10px_#f59e0b]'
      : 'bg-emerald-400 shadow-[0_0_10px_#34d399]';

  const alertsList = snapshot?.dashboardAlerts || [];
  const alertsCount = alertsList.length;

  return (
    <div className="min-h-screen bg-transparent text-[#dae2ff] relative overflow-x-hidden">
      {/* ۱. هدر شیشه‌ای شفاف با نشان نقش کاربر و لوگوی درخشان (از داشبورد.html) */}
      <header className="fixed top-0 inset-x-0 z-40 pt-safe bg-[#080d1a]/60 backdrop-blur-2xl border-b border-[#f1cb83]/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-300">
        <div className="h-20 px-5 flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full crystal-glass-subtle border border-[#f1cb83]/25 shadow-sm hover:border-[#f1cb83]/55 active:scale-95 transition-all duration-300 cursor-pointer group"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 live-dot-pulse" />
              <span className="text-[11px] font-bold text-[#f1cb83] group-hover:drop-shadow-[0_0_8px_rgba(241,203,131,0.7)] transition-all">
                {currentUser.role}
              </span>
              <span className="text-[#d1c5b4]/40 text-[12px]">|</span>
              <span className="text-[11px] font-semibold text-[#dae2ff] group-hover:text-white transition-colors truncate max-w-[140px]">
                {currentUser.name}
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <KelidLogoIcon className="h-12 w-12" />
          </button>
        </div>
      </header>

      {/* محتوای اصلی اسکرول‌پذیر داشبورد (کاملاً شفاف روی پس‌زمینه نورانی سراسری) */}
      <main
        id="dashboard-content"
        className="flex flex-col relative w-full pt-24 pb-28 min-h-screen bg-transparent z-10 transition-all duration-500 max-w-lg mx-auto px-5 space-y-5"
      >
        {/* ۲. کارت پشتیبان‌گیری سرور امن (Manager Security & Backup Indicator Pill از داشبورد.html) */}
        <div
          style={{
            background: 'rgba(241, 203, 131, 0.08)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(241, 203, 131, 0.35)',
            boxShadow:
              'rgba(255, 235, 175, 0.3) 0px 1px 2px inset, rgba(0, 0, 0, 0.35) 0px 8px 32px, rgba(241, 203, 131, 0.12) 0px 0px 18px',
          }}
          className="fade-in-1 relative overflow-hidden rounded-2xl p-4 w-full transition-all duration-300 group"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#f1cb83]/15 via-transparent to-[#f1cb83]/10 pointer-events-none group-hover:opacity-100 transition-opacity" />

          {/* ردیف ۱: هدر وضعیت (آیکون ابری در راست، عنوان و زیرعنوان در وسط، نقطه وضعیت و بج تغییرات در چپ) */}
          <div className="relative z-10 flex items-center justify-between gap-3 pb-3.5 border-b border-[#f1cb83]/15">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={handleCloudBackup}
                disabled={isSyncing}
                title="پشتیبان‌گیری و همگام‌سازی ابری (Get -> Merge -> Upload)"
                style={{
                  background: 'rgba(241, 203, 131, 0.14)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  border: '1px solid rgba(241, 203, 131, 0.45)',
                  boxShadow:
                    '0 0 12px rgba(241, 203, 131, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.3)',
                }}
                className="w-12 h-12 rounded-xl flex items-center justify-center text-[#f1cb83] shrink-0 transition-all duration-300 hover:border-[#f1cb83]/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f1cb83]/60 active:scale-[0.97] disabled:opacity-60 disabled:pointer-events-none cursor-pointer"
              >
                <span
                  className={`material-symbols-outlined text-[22px] drop-shadow-[0_0_8px_rgba(241,203,131,0.85)] ${
                    isSyncing ? 'animate-spin' : ''
                  }`}
                >
                  {isSyncing ? 'sync' : 'cloud_done'}
                </span>
              </button>

              <div className="flex flex-col min-w-0 flex-1 gap-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[13px] text-white font-extrabold leading-snug drop-shadow-[0_0_6px_rgba(241,203,131,0.35)]">
                    پشتیبان‌گیری سرور امن
                  </span>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 animate-[pulse_2s_ease-in-out_infinite] ${statusDotClass}`}
                    />
                    {snapshot && snapshot.pendingUnsyncedCount > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f1cb83]/15 text-[#f1cb83] border border-[#f1cb83]/35 font-bold whitespace-nowrap leading-none">
                        {toPersianDigits(snapshot.pendingUnsyncedCount)} تغییر محلی
                      </span>
                    )}
                  </div>
                </div>

                <span className="text-[11px] text-[#f1cb83]/80 font-medium leading-relaxed break-words">
                  {syncStepText ||
                    (snapshot?.syncMeta.lastBackupAt
                      ? `${getRelativeTimePersian(snapshot.syncMeta.lastBackupAt)}${
                          storageInfo.usageMB > 0
                            ? ` • حافظه: ${toPersianDigits(storageInfo.usageMB)} مگابایت`
                            : ''
                        }`
                      : 'هنوز هیچ پشتیبان‌گیری انجام نشده است')}
                </span>
              </div>
            </div>
          </div>

          {/* ردیف ۲: دکمه‌های عملیاتی در گرید ۳ ستونه هم‌عرض و هم‌ارتفاع */}
          <div className="relative z-10 grid grid-cols-3 gap-2.5 pt-3.5">
            <button
              type="button"
              onClick={handlePullRefresh}
              disabled={isSyncing}
              title="دریافت آخرین نسخه سرور (Pull Only)"
              className="h-12 px-2 rounded-xl bg-gradient-to-l from-[#f6d992] via-[#e4be6c] to-[#c4973b] text-[#050b18] border border-[#f1cb83]/70 shadow-[0_4px_14px_rgba(241,203,131,0.28)] flex items-center justify-center gap-1.5 text-[12px] font-extrabold whitespace-nowrap active:scale-[0.97] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f1cb83] transition-all duration-200 disabled:opacity-60 disabled:pointer-events-none cursor-pointer"
            >
              <span
                className={`material-symbols-outlined text-[17px] shrink-0 ${
                  isSyncing ? 'animate-spin' : ''
                }`}
              >
                {isSyncing ? 'progress_activity' : 'refresh'}
              </span>
              <span className="truncate">همگام‌سازی</span>
            </button>

            <input
              ref={jsonFileInputRef}
              type="file"
              accept=".json,.zip,application/json"
              onChange={handleJsonUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => jsonFileInputRef.current?.click()}
              disabled={isSyncing}
              style={{
                background: 'rgba(8, 13, 26, 0.55)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                border: '1px solid rgba(241, 203, 131, 0.35)',
                boxShadow:
                  'inset 0 1px 1px rgba(255, 235, 175, 0.18), 0 4px 12px rgba(0, 0, 0, 0.25)',
              }}
              className="h-12 px-2 rounded-xl text-[#f1cb83] flex items-center justify-center gap-1.5 text-[12px] font-bold whitespace-nowrap active:scale-[0.97] hover:border-[#f1cb83]/70 hover:bg-[#f1cb83]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f1cb83]/60 transition-all duration-200 disabled:opacity-60 disabled:pointer-events-none cursor-pointer"
            >
              <span className="material-symbols-outlined text-[17px] text-[#f1cb83] shrink-0 drop-shadow-[0_0_6px_rgba(241,203,131,0.75)]">
                upload_file
              </span>
              <span className="truncate">بارگذاری JSON</span>
            </button>

            <button
              type="button"
              disabled={isSyncing}
              onClick={async () => {
                await exportBackupPackage(false);
                await refreshSnapshot();
                showToast('بسته پشتیبان نسخه JSON با موفقیت ذخیره شد', 'success');
              }}
              style={{
                background: 'rgba(8, 13, 26, 0.55)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                border: '1px solid rgba(241, 203, 131, 0.35)',
                boxShadow:
                  'inset 0 1px 1px rgba(255, 235, 175, 0.18), 0 4px 12px rgba(0, 0, 0, 0.25)',
              }}
              className="h-12 px-2 rounded-xl text-[#f1cb83] flex items-center justify-center gap-1.5 text-[12px] font-bold whitespace-nowrap active:scale-[0.97] hover:border-[#f1cb83]/70 hover:bg-[#f1cb83]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f1cb83]/60 transition-all duration-200 disabled:opacity-60 disabled:pointer-events-none cursor-pointer"
            >
              <span className="material-symbols-outlined text-[17px] text-[#f1cb83] shrink-0 drop-shadow-[0_0_6px_rgba(241,203,131,0.75)]">
                download
              </span>
              <span className="truncate">دانلود JSON</span>
            </button>
          </div>

          {storageInfo.nearFull && (
            <div className="mt-3 p-2.5 rounded-xl bg-red-500/20 border border-red-400/40 text-red-200 text-[11px] font-bold flex items-center gap-1.5 relative z-10">
              <span className="material-symbols-outlined text-[16px]">warning</span>
              <span>
                هشدار: فضای ذخیره‌سازی گوشی رو به اتمام است ({toPersianDigits(storageInfo.percent)}٪
                پر شده).
              </span>
            </div>
          )}
        </div>

        {/* ۳. نوار جستجوی هوشمند (Search Bar از داشبورد.html) */}
        <div className="fade-in-2 relative overflow-hidden rounded-xl crystal-glass p-2.5 transition-all duration-300 search-container shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <div className="absolute inset-0 bg-gradient-to-r from-[#f1cb83]/10 via-transparent to-[#f1cb83]/15 pointer-events-none transition-all" />
          <div className="flex items-center justify-between gap-2.5 relative z-10 w-full">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-9 h-9 rounded-lg bg-[#f1cb83]/10 border border-[#f1cb83]/25 flex items-center justify-center text-[#f1cb83] shadow-[0_0_12px_rgba(241,203,131,0.25)] shrink-0 transition-transform duration-300">
                <span className="material-symbols-outlined text-[20px] drop-shadow-[0_0_6px_rgba(241,203,131,0.7)]">
                  search
                </span>
              </div>
              <input
                type="text"
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                placeholder="جستجوی هوشمند ..."
                className="w-full bg-transparent border-0 outline-none focus:ring-0 p-0 text-[12px] font-medium text-[#dae2ff] placeholder:text-[#d1c5b4] text-right"
              />
              {globalQuery && (
                <button
                  type="button"
                  onClick={() => setGlobalQuery('')}
                  className="text-[#d1c5b4] hover:text-white p-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[17px]">close</span>
                </button>
              )}
              <VoiceMicButton
                currentValue={globalQuery}
                append={false}
                variant="square-icon"
                title="جستجوی صوتی فارسی"
                onTextChange={(txt) => setGlobalQuery(txt)}
              />
            </div>
            <button
              type="button"
              onClick={() => setFilterSheetOpen(!filterSheetOpen)}
              className="relative shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-lg active:scale-95 hover:scale-105 text-[#402d00] bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[11px] font-bold shadow-[0_0_14px_rgba(241,203,131,0.35)] hover:shadow-[0_0_22px_rgba(241,203,131,0.6)] hover:brightness-110 transition-all duration-300 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px] transition-transform">
                {filterSheetOpen ? 'close' : 'tune'}
              </span>
              <span>فیلتر</span>
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-[#080d1a] text-[#f1cb83] text-[10px] font-extrabold flex items-center justify-center">
                  {toPersianDigits(activeFilterCount)}
                </span>
              )}
            </button>
          </div>

          {/* شیت فیلتر جستجوی سراسری */}
          {filterSheetOpen && (
            <div className="mt-3 pt-3 border-t border-[#f1cb83]/20 space-y-3 relative z-10">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-[#d1c5b4] mb-1">بخش سامانه</label>
                  <select
                    value={globalFilterEntity}
                    onChange={(e) => setGlobalFilterEntity(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg glass-input text-xs text-[#dae2ff]"
                  >
                    <option value="all" className="bg-[#080d1a]">همه بخش‌ها</option>
                    <option value="properties" className="bg-[#080d1a]">ملک‌ها</option>
                    <option value="applicants" className="bg-[#080d1a]">متقاضیان</option>
                    <option value="collaborators" className="bg-[#080d1a]">همکاران</option>
                    <option value="reminders" className="bg-[#080d1a]">یادآورها</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#d1c5b4] mb-1">شهر / منطقه</label>
                  <select
                    value={globalFilterCity}
                    onChange={(e) => setGlobalFilterCity(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg glass-input text-xs text-[#dae2ff]"
                  >
                    <option value="all" className="bg-[#080d1a]">همه شهرها</option>
                    <option value="کلارآباد" className="bg-[#080d1a]">کلارآباد</option>
                    <option value="متل قو" className="bg-[#080d1a]">متل قو (سلمان‌شهر)</option>
                    <option value="نمک‌آبرود" className="bg-[#080d1a]">نمک‌آبرود</option>
                    <option value="عباس‌آباد" className="bg-[#080d1a]">عباس‌آباد</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#d1c5b4] mb-1">وضعیت پرونده</label>
                  <select
                    value={globalFilterStatus}
                    onChange={(e) => setGlobalFilterStatus(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg glass-input text-xs text-[#dae2ff]"
                  >
                    <option value="all" className="bg-[#080d1a]">همه وضعیت‌ها</option>
                    <option value="فعال" className="bg-[#080d1a]">فعال</option>
                    <option value="در حال مذاکره" className="bg-[#080d1a]">در حال مذاکره</option>
                    <option value="نیاز به پیگیری" className="bg-[#080d1a]">نیاز به پیگیری</option>
                    <option value="فروخته شده" className="bg-[#080d1a]">فروخته شده</option>
                  </select>
                </div>
              </div>
              {activeFilterCount > 0 && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setGlobalFilterEntity('all');
                      setGlobalFilterCity('all');
                      setGlobalFilterStatus('all');
                    }}
                    className="text-[11px] text-[#f1cb83] underline cursor-pointer"
                  >
                    پاک کردن فیلترها
                  </button>
                </div>
              )}
            </div>
          )}

          {/* نتایج زنده جستجوی هوشمند */}
          {globalSearchResults && (
            <div className="mt-3 pt-3 border-t border-[#f1cb83]/20 space-y-2.5 max-h-96 overflow-y-auto relative z-10">
              <div className="flex items-center justify-between text-[11px] text-[#d1c5b4]">
                <span>نتایج جستجوی هوشمند در کل سامانه:</span>
                <span className="text-[#f1cb83] font-bold">
                  {toPersianDigits(globalSearchResults.total)} مورد یافت شد
                </span>
              </div>

              {globalSearchResults.total === 0 ? (
                <div className="p-4 text-center text-xs text-[#d1c5b4]/70">
                  موردی منطبق با عبارت جستجو یافت نشد.
                </div>
              ) : (
                <>
                  {globalSearchResults.props.map(({ item: p }) => (
                    <div
                      key={p.id}
                      onClick={() => navigate(`/properties/${p.id}`)}
                      className="p-2.5 rounded-lg crystal-glass-inner flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-[#f1cb83]/20 text-[#f1cb83] text-[10px] font-bold shrink-0">
                          {p.code}
                        </span>
                        <span className="text-xs font-bold text-[#dae2ff] truncate">{p.title}</span>
                      </div>
                      <span className="text-[11px] text-[#f1cb83] font-bold shrink-0">
                        {formatToman(p.totalPrice)}
                      </span>
                    </div>
                  ))}

                  {globalSearchResults.apps.map(({ item: a }) => (
                    <div
                      key={a.id}
                      onClick={() => navigate('/applicants')}
                      className="p-2.5 rounded-lg crystal-glass-inner flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-bold shrink-0">
                          {a.code}
                        </span>
                        <span className="text-xs font-bold text-[#dae2ff] truncate">{a.name}</span>
                      </div>
                      <span className="text-[11px] text-sky-300 font-bold shrink-0">
                        بودجه: {formatToman(a.maxBudget)}
                      </span>
                    </div>
                  ))}

                  {globalSearchResults.cols.map(({ item: c }) => (
                    <div
                      key={c.id}
                      onClick={() => navigate('/collaborators')}
                      className="p-2.5 rounded-lg crystal-glass-inner flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold shrink-0">
                          همکار
                        </span>
                        <span className="text-xs font-bold text-[#dae2ff] truncate">
                          {c.name} ({c.agencyName})
                        </span>
                      </div>
                      <span className="text-[11px] text-emerald-300 shrink-0">{c.primaryCity}</span>
                    </div>
                  ))}

                  {globalSearchResults.rems.map(({ item: r }) => (
                    <div
                      key={r.id}
                      onClick={() => navigate('/reminders')}
                      className="p-2.5 rounded-lg crystal-glass-inner flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold shrink-0">
                          یادآور
                        </span>
                        <span className="text-xs font-bold text-[#dae2ff] truncate">{r.title}</span>
                      </div>
                      <span className="text-[11px] text-amber-300 shrink-0">
                        {toPersianDigits(r.jalaliDate || '')}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* ۴. کارت وضعیت پورتفوی کلید و ۶ کارت آماری (Top Hero Stat Summary از داشبورد.html) */}
        <div className="fade-in-3 relative overflow-hidden rounded-xl crystal-glass p-5 transition-all duration-300 hover:scale-[1.01]">
          <div className="absolute -top-12 -left-12 w-36 h-36 bg-[#f1cb83]/20 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between mb-3 relative z-10">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f1cb83] shadow-[0_0_12px_rgba(241,203,131,0.95)] live-dot-pulse" />
              <span className="text-[18px] leading-7 font-bold text-[#dae2ff]">
                وضعیت پورتفوی کلید
              </span>
            </div>
            <div className="px-2.5 py-0.5 rounded-full bg-[#f1cb83]/15 border border-[#f1cb83]/25 text-[#f1cb83] text-[11px] font-medium hover:bg-[#f1cb83]/25 transition-colors cursor-default">
              {getTodayDashChip()}
            </div>
          </div>

          {/* شبکه ۶ کارت آماری در ۲ ردیف ۳ ستونی */}
          <div className="grid grid-cols-3 gap-2.5 relative z-10">
            {/* کل فایل‌ها */}
            <button
              type="button"
              onClick={() => openPropertiesWithFilter({ status: 'همه وضعیت‌ها' })}
              className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.04] active:scale-95 transition-all duration-300 group"
            >
              <span className="text-[11px] text-[#d1c5b4] font-medium group-hover:text-[#f1cb83] transition-colors">
                کل فایل‌ها
              </span>
              <span className="text-[28px] leading-10 font-bold text-[#f1cb83] mt-0.5 group-hover:scale-110 group-hover:drop-shadow-[0_0_10px_rgba(241,203,131,0.7)] transition-transform duration-300">
                {toPersianDigits(snapshot?.propertyStats?.total || 0)}
              </span>
              <span className="text-[11px] text-[#d1c5b4]/60">پروژه ثبت‌شده</span>
            </button>

            {/* فایل‌های فعال */}
            <button
              type="button"
              onClick={() => openPropertiesWithFilter({ status: 'فعال' })}
              className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.04] active:scale-95 transition-all duration-300 group"
            >
              <span className="text-[11px] text-emerald-400 font-medium">فایل‌های فعال</span>
              <span className="text-[28px] leading-10 font-bold text-[#dae2ff] mt-0.5 group-hover:scale-110 group-hover:text-emerald-300 transition-all duration-300">
                {toPersianDigits(snapshot?.propertyStats?.active || 0)}
              </span>
              <span className="text-[11px] text-emerald-400/80">عرضه در بازار</span>
            </button>

            {/* نیاز به پیگیری */}
            <button
              type="button"
              onClick={() => navigate('/reminders')}
              className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.04] active:scale-95 transition-all duration-300 group"
            >
              <span className="text-[11px] text-[#ffb4ab] font-medium">نیاز به پیگیری</span>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[28px] leading-10 font-bold text-[#ffb4ab] group-hover:scale-110 transition-transform duration-300">
                  {toPersianDigits(snapshot?.propertyStats?.needFollowup || 0)}
                </span>
                {(snapshot?.propertyStats?.needFollowup || 0) > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ffb4ab] animate-ping" />
                )}
              </div>
              <span className="text-[11px] text-[#ffb4ab]/80">اقدام ضروری</span>
            </button>

            {/* در حال مذاکره */}
            <button
              type="button"
              onClick={() => openPropertiesWithFilter({ status: 'در مذاکره' })}
              className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.04] active:scale-95 transition-all duration-300 group"
            >
              <span className="text-[11px] text-[#d1c5b4] font-medium group-hover:text-[#b8c5f5] transition-colors">
                در حال مذاکره
              </span>
              <span className="text-[22px] leading-8 font-bold text-[#b8c5f5] mt-0.5 group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_rgba(184,197,245,0.5)] transition-all duration-300">
                {toPersianDigits(snapshot?.propertyStats?.negotiating || 0)}
              </span>
              <span className="text-[11px] text-[#d1c5b4]/60">جلسه نهایی</span>
            </button>

            {/* فروخته شده */}
            <button
              type="button"
              onClick={() => openPropertiesWithFilter({ status: 'فروخته‌شده' })}
              className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.04] active:scale-95 transition-all duration-300 group"
            >
              <span className="text-[11px] text-[#d1c5b4] font-medium">فروخته شده</span>
              <span className="text-[22px] leading-8 font-bold text-[#d1c5b4] mt-0.5 group-hover:scale-110 group-hover:text-white transition-all duration-300">
                {toPersianDigits(snapshot?.propertyStats?.sold || 0)}
              </span>
              <span className="text-[11px] text-[#d1c5b4]/60">موفق / تسویه‌شده</span>
            </button>

            {/* فایل جدید ماه */}
            <button
              type="button"
              onClick={() => openPropertiesWithFilter({ sortBy: 'newest', sortAsc: false })}
              className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.04] active:scale-95 transition-all duration-300 group"
            >
              <span className="text-[11px] text-[#f1cb83] font-medium">فایل جدید ماه</span>
              <span className="text-[22px] leading-8 font-bold text-[#f1cb83] mt-0.5 group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_rgba(241,203,131,0.6)] transition-all duration-300">
                {toPersianDigits(snapshot?.propertyStats?.newThisMonth || 0)}+
              </span>
              <span className="text-[11px] text-[#d1c5b4]/60">ورودی جدید</span>
            </button>
          </div>
        </div>

        {/* ۵. بخش پیشنهاد فایل به مشتری (Accordion 1: Intelligent Match Recommendations از داشبورد.html) */}
        <div className="fade-in-4 relative overflow-hidden rounded-xl crystal-glass transition-all duration-300 hover:scale-[1.01]">
          <button
            type="button"
            onClick={() => setMatchAccordionOpen(!matchAccordionOpen)}
            className="w-full p-5 flex items-center justify-between text-right cursor-pointer select-none active:scale-[0.99] transition-transform duration-200 group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#f1cb83]/30 to-[#d4b06a]/10 border border-[#f1cb83]/25 flex items-center justify-center text-[#f1cb83] shadow-[0_0_14px_rgba(241,203,131,0.3)] shrink-0 transition-transform duration-300 group-hover:scale-105">
                <span className="material-symbols-outlined text-[22px]">lightbulb</span>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
                  <span className="text-[16px] font-bold text-[#dae2ff] truncate">
                    پیشنهاد فایل به مشتری
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#f1cb83]/20 border border-[#f1cb83]/30 text-[#f1cb83] text-[11px] font-semibold shrink-0 shadow-[0_0_8px_rgba(241,203,131,0.2)]">
                    {toPersianDigits(activeSuggestions.length)} پیشنهاد
                  </span>
                </div>
                <span className="text-[11px] text-[#d1c5b4] truncate">
                  انطباق الگوریتم بر مبنای بودجه و علایق متقاضی
                </span>
              </div>
            </div>
            <div
              className="w-8 h-8 rounded-full bg-[#2c344b]/40 border border-[#f1cb83]/15 flex items-center justify-center text-[#d1c5b4] transition-all duration-300 hover:bg-[#f1cb83]/20 hover:text-[#f1cb83] shrink-0"
              style={{ transform: matchAccordionOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <span className="material-symbols-outlined text-[20px]">expand_more</span>
            </div>
          </button>

          <div className={`accordion-content ${matchAccordionOpen ? 'open' : ''}`}>
            <div>
              <div className="px-5 pb-5 space-y-3 pt-1">
                {activeSuggestions.length === 0 ? (
                  <div className="p-4 rounded-xl crystal-glass-inner text-center text-xs text-[#d1c5b4]/80">
                    در حال حاضر پیشنهاد منطبق جدیدی بالای ۷۰٪ وجود ندارد.
                  </div>
                ) : (
                  activeSuggestions.slice(0, 6).map(({ link, applicant, property }) => (
                    <div
                      key={link.id}
                      className="rounded-xl crystal-glass-inner p-3 space-y-3 hover:scale-[1.01] active:scale-[0.99] transition-all relative z-10"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-[#21293f]/80 border border-[#f1cb83]/15 flex items-center justify-center text-[#f1cb83] shrink-0">
                            <span className="material-symbols-outlined text-[20px]">
                              person_check
                            </span>
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-semibold text-[#dae2ff] truncate">
                                {applicant.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-[#2c344b]/60 text-[#d1c5b4] text-[11px]">
                                {applicant.code}
                              </span>
                            </div>
                            <span className="text-[11px] text-[#f1cb83] truncate">
                              بودجه: {formatToman(applicant.maxBudget)} •{' '}
                              {(applicant.cities || []).join('، ')}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold shadow-[0_0_10px_rgba(52,211,153,0.25)]">
                            {toPersianDigits(link.score)}٪ همپوشانی
                          </span>
                          <button
                            type="button"
                            onClick={() => dismissMatchPair(link.id)}
                            title="رد کردن این پیشنهاد"
                            className="w-6 h-6 rounded-full bg-white/5 hover:bg-red-500/20 text-[#d1c5b4] hover:text-red-300 flex items-center justify-center cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">close</span>
                          </button>
                        </div>
                      </div>

                      <div
                        onClick={() => navigate(`/properties/${property.id}`)}
                        className="rounded-lg crystal-glass-subtle p-2.5 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-12 h-12 rounded-lg bg-[#21293f] overflow-hidden shrink-0 border border-[#f1cb83]/20">
                            <PropertyThumbImage property={property} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-[11px] font-semibold text-[#dae2ff] truncate">
                              {property.title} ({property.code})
                            </span>
                            <span className="text-[11px] text-[#d1c5b4] truncate">
                              {toPersianDigits(property.area)} مترمربع • {property.deedType} •{' '}
                              {property.city}
                            </span>
                          </div>
                        </div>
                        <span className="text-sm font-bold text-[#f1cb83] shrink-0">
                          {formatToman(property.totalPrice)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => navigate(`/applicants/${applicant.id}/edit`)}
                          className="h-10 rounded-lg bg-[#21293f]/60 hover:bg-[#30394f]/80 border border-white/10 active:scale-95 text-[#dae2ff] text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-300 shadow-sm cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px]">account_box</span>
                          <span>اطلاعات مشتری</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/properties/${property.id}`)}
                          className="h-10 rounded-lg bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#402d00] text-xs font-bold flex items-center justify-center gap-1.5 shadow-[0_0_16px_rgba(241,203,131,0.35)] hover:shadow-[0_0_24px_rgba(241,203,131,0.6)] hover:brightness-110 active:scale-95 transition-all duration-300 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                          <span>رویت فایل {property.code}</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {activeSuggestions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setInboxInitialTab('suggestions');
                      navigate('/inbox');
                    }}
                    className="w-full py-2 text-center text-xs font-bold text-[#f1cb83] hover:underline cursor-pointer"
                  >
                    مشاهده همه پیشنهادها در صندوق هوشمند ({toPersianDigits(activeSuggestions.length)}
                    )
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ۶. بخش هشدارها و پیگیری‌ها (Accordion 2: Urgent Alerts & Escalated Follow-ups از داشبورد.html) */}
        <div className="fade-in-5 relative overflow-hidden rounded-xl crystal-glass transition-all duration-300 hover:scale-[1.01]">
          <button
            type="button"
            onClick={() => setAlertsAccordionOpen(!alertsAccordionOpen)}
            className="w-full p-5 flex items-center justify-between text-right cursor-pointer select-none active:scale-[0.99] transition-transform duration-200 group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ffb4ab]/30 to-[#93000a]/10 border border-[#ffb4ab]/30 flex items-center justify-center text-[#ffb4ab] shadow-[0_0_14px_rgba(255,180,171,0.25)] shrink-0 transition-transform duration-300 group-hover:scale-105">
                <span className="material-symbols-outlined text-[22px]">warning</span>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[18px] leading-7 font-bold text-[#dae2ff]">
                    هشدارها و پیگیری‌ها
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#93000a]/80 border border-[#ffb4ab]/40 text-[#ffdad6] text-[11px] font-semibold live-urgent-pulse">
                    {toPersianDigits(alertsCount)} مورد
                  </span>
                </div>
                <span className="text-[11px] text-[#d1c5b4] truncate">
                  نیازمند اقدام فوری مشاور و مدیر املاک
                </span>
              </div>
            </div>
            <div
              className="w-8 h-8 rounded-full bg-[#2c344b]/40 border border-[#f1cb83]/15 flex items-center justify-center text-[#d1c5b4] transition-all duration-300 hover:bg-[#f1cb83]/20 hover:text-[#f1cb83] shrink-0"
              style={{ transform: alertsAccordionOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <span className="material-symbols-outlined text-[20px]">expand_more</span>
            </div>
          </button>

          <div className={`accordion-content ${alertsAccordionOpen ? 'open' : ''}`}>
            <div>
              <div className="px-5 pb-5 space-y-3 pt-1">
                {alertsCount === 0 ? (
                  <div className="p-4 rounded-xl crystal-glass-inner text-center text-xs text-emerald-300">
                    هیچ جواز منقضی یا پیگیری عقب‌افتاده‌ای وجود ندارد.
                  </div>
                ) : (
                  <>
                    {alertsList.slice(0, 8).map((alert) => {
                      const isPermitAlert = Boolean(alert.propertyIdForDismiss);
                      return (
                        <div
                          key={alert.id}
                          className="rounded-xl crystal-glass-inner p-3 flex flex-col gap-2.5 hover:scale-[1.01] active:scale-[0.99] transition-all relative z-10"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                  isPermitAlert
                                    ? 'bg-[#ffb4ab]/20 border border-[#ffb4ab]/30 text-[#ffb4ab]'
                                    : 'bg-[#d6b067]/30 border border-[#f1cb83]/25 text-[#ffdea4]'
                                }`}
                              >
                                {alert.badge}
                              </span>
                              <span className="text-[11px] text-[#d1c5b4]">{alert.codeLabel}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[11px] font-medium ${
                                  isPermitAlert ? 'text-[#ffb4ab]' : 'text-[#f4cb7f]'
                                }`}
                              >
                                {alert.delayLabel}
                              </span>
                              {alert.propertyIdForDismiss && (
                                <button
                                  type="button"
                                  onClick={() => dismissPermitWarning(alert.propertyIdForDismiss!)}
                                  title="نادیده گرفتن هشدار جواز این ملک"
                                  className="text-[10px] text-[#d1c5b4]/70 hover:text-white underline cursor-pointer"
                                >
                                  بستن
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div
                              onClick={() => navigate(alert.targetRoute)}
                              className="flex flex-col min-w-0 cursor-pointer"
                            >
                              <span className="text-sm font-semibold text-[#dae2ff] truncate">
                                {alert.title}
                              </span>
                              <span className="text-[11px] text-[#d1c5b4] truncate">
                                {alert.subtitle}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                alert.phone
                                  ? triggerPhoneCall(alert.phone)
                                  : navigate(alert.targetRoute)
                              }
                              className={`shrink-0 h-9 px-3 rounded-lg active:scale-95 hover:scale-105 text-[11px] flex items-center gap-1 transition-all duration-300 cursor-pointer ${
                                isPermitAlert
                                  ? 'bg-[#21293f]/80 hover:bg-[#30394f] border border-white/10 text-[#dae2ff] font-semibold'
                                  : 'bg-[#f1cb83] hover:bg-[#ffdea3] text-[#402d00] font-bold shadow-[0_0_12px_rgba(241,203,131,0.3)] hover:shadow-[0_0_20px_rgba(241,203,131,0.5)]'
                              }`}
                            >
                              <span
                                className={`material-symbols-outlined text-[16px] ${
                                  isPermitAlert ? 'text-[#ffb4ab]' : ''
                                }`}
                              >
                                {isPermitAlert ? 'call' : 'phone_in_talk'}
                              </span>
                              <span>{alert.actionLabel}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => navigate('/reminders')}
                      className="w-full py-1.5 text-center text-xs font-bold text-[#f1cb83] hover:underline cursor-pointer"
                    >
                      مدیریت همه یادآورها و هشدارها
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ۷. بخش آخرین وضعیت فایل‌های ممتاز (Quick Portfolio Activity Feed Strip از داشبورد.html) */}
        <div className="fade-in-6 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-[20px] drop-shadow-[0_0_6px_rgba(241,203,131,0.6)]">
                cloud_upload
              </span>
              <span className="text-[18px] leading-7 font-bold text-[#dae2ff]">
                آخرین وضعیت فایل‌های ممتاز
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/properties')}
              className="text-[11px] text-[#f1cb83] font-semibold hover:underline hover:drop-shadow-[0_0_6px_rgba(241,203,131,0.5)] transition-all active:scale-95 cursor-pointer"
            >
              مشاهده همه
            </button>
          </div>

          <div className="space-y-2.5">
            {!snapshot?.properties || snapshot.properties.length === 0 ? (
              <div className="p-5 rounded-xl crystal-glass text-center text-xs text-[#d1c5b4]/80">
                هنوز ملکی ثبت نشده است. با دکمه + در نوار پایین اولین ملک را ثبت کنید.
              </div>
            ) : (
              (snapshot.propertyStats?.premiumTop3?.length
                ? snapshot.propertyStats.premiumTop3
                : snapshot.properties.slice(0, 3)
              ).map((prop) => (
                <div
                  key={prop.id}
                  onClick={() => navigate(`/properties/${prop.id}`)}
                  className="relative overflow-hidden rounded-xl crystal-glass p-3 flex items-center gap-3 cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-all duration-300 group"
                >
                  <div className="w-16 h-16 rounded-xl bg-[#21293f] overflow-hidden shrink-0 border border-[#f1cb83]/25 shadow-md group-hover:border-[#f1cb83]/50 transition-all duration-300 relative z-10">
                    <PropertyThumbImage
                      property={prop}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1 relative z-10">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-semibold text-[#dae2ff] truncate group-hover:text-[#f1cb83] transition-colors">
                        {prop.title}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#f1cb83]/20 border border-[#f1cb83]/25 text-[#f1cb83] text-[11px] font-bold shrink-0">
                        {prop.code}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#d1c5b4] truncate mt-0.5">
                      {prop.propertyType} {toPersianDigits(prop.area)} مترمربع • {prop.deedType} •{' '}
                      {prop.city}
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-sm font-bold text-[#f1cb83] drop-shadow-[0_0_8px_rgba(241,203,131,0.4)] group-hover:drop-shadow-[0_0_12px_rgba(241,203,131,0.7)] transition-all">
                        {formatToman(prop.totalPrice)}
                      </span>
                      <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399] live-dot-pulse" />
                        {prop.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* مودال شیشه‌ای پیش‌نمایش بارگذاری و ادغام فایل پشتیبان JSON */}
      {importPreviewModal && (
        <div
          onClick={() => setImportPreviewModal(null)}
          className="fixed inset-0 z-50 bg-[#050a16]/75 backdrop-blur-xl flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sheet-enter-up w-full max-w-sm rounded-3xl crystal-glass border border-[#f1cb83]/40 p-5 shadow-2xl space-y-4 text-right"
          >
            <div className="flex items-center gap-2.5 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/35 flex items-center justify-center text-[#f1cb83]">
                <span className="material-symbols-outlined text-[22px]">merge</span>
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-white">پیش‌نمایش ادغام فایل پشتیبان</h3>
                <p className="text-[11px] text-[#d1c5b4]">
                  اطلاعات جدید بدون حذف رکوردهای فعلی ادغام می‌شوند
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl crystal-glass-inner text-center relative z-10">
              <div>
                <span className="block text-base font-extrabold text-emerald-400">
                  +{toPersianDigits(importPreviewModal.preview.addedCount)}
                </span>
                <span className="text-[10px] text-[#d1c5b4]">رکورد جدید</span>
              </div>
              <div>
                <span className="block text-base font-extrabold text-[#f1cb83]">
                  {toPersianDigits(importPreviewModal.preview.updatedCount)}
                </span>
                <span className="text-[10px] text-[#d1c5b4]">بروزرسانی</span>
              </div>
              <div>
                <span className="block text-base font-extrabold text-slate-400">
                  {toPersianDigits(importPreviewModal.preview.unchangedCount)}
                </span>
                <span className="text-[10px] text-[#d1c5b4]">بدون تغییر</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 relative z-10">
              <button
                type="button"
                onClick={() => setImportPreviewModal(null)}
                className="h-10 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-[#d1c5b4] cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={confirmMergeImport}
                className="h-10 rounded-xl gold-pill-btn text-xs font-extrabold cursor-pointer"
              >
                تایید و ادغام ایمن
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
