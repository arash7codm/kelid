import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AmbientBackground, BottomNavAndQuickMenu, KelidLogoIcon } from '../components/Layout';
import { db } from '../db/schema';
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

export const DashboardScreen: React.FC = () => {
  const navigate = useNavigate();
  const {
    snapshot,
    loading,
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
  const [storageInfo, setStorageInfo] = useState({ usageMB: 0, quotaMB: 0, percent: 0, nearFull: false });
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
        ? searchPropertiesSmart(snapshot.properties, q).filter((h) =>
            filterByCityAndStatus(h.item.city, h.item.status)
          )
        : [];

    const apps =
      globalFilterEntity === 'all' || globalFilterEntity === 'applicants'
        ? searchApplicantsSmart(snapshot.applicants, q).filter((h) =>
            filterByCityAndStatus(h.item.cities.join(' '), h.item.status)
          )
        : [];

    const cols =
      globalFilterEntity === 'all' || globalFilterEntity === 'collaborators'
        ? searchCollaboratorsSmart(snapshot.collaborators, snapshot.properties, q).filter((h) =>
            filterByCityAndStatus(h.item.primaryCity, h.item.cooperationStatus)
          )
        : [];

    const rems =
      globalFilterEntity === 'all' || globalFilterEntity === 'reminders'
        ? searchRemindersSmart(
            snapshot.reminders,
            snapshot.properties,
            snapshot.applicants,
            snapshot.collaborators,
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
    if (!snapshot) return [];
    return snapshot.matchLinks
      .filter((m) => !m.dismissed && m.score >= 70)
      .sort((a, b) => b.score - a.score)
      .map((m) => {
        const applicant = snapshot.applicants.find((a) => a.id === m.applicantId);
        const property = snapshot.properties.find((p) => p.id === m.propertyId);
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

  return (
    <div className="min-h-screen bg-[#080d1a] text-[#dae2ff] relative overflow-x-hidden">
      <AmbientBackground />

      {/* Header (Glass Transparent with Role Badge & Frameless Logo from Stitch Image 8.html) */}
      <header className="fixed top-0 inset-x-0 z-40 pt-safe bg-[#080d1a]/65 backdrop-blur-xl border-b border-[#f1cb83]/15 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <div className="h-20 px-5 flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full crystal-glass-subtle border border-[#f1cb83]/30 shadow-sm hover:border-[#f1cb83]/60 active:scale-95 transition-all cursor-pointer group"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 live-dot-pulse" />
              <span className="text-[11px] font-bold text-[#f1cb83]">{currentUser.role}</span>
              <span className="text-[#d1c5b4]/40 text-[12px]">|</span>
              <span className="text-[11px] font-semibold text-[#dae2ff] group-hover:text-white truncate max-w-[130px]">
                {currentUser.name}
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 cursor-pointer"
          >
            <KelidLogoIcon className="h-11 w-11" />
          </button>
        </div>
      </header>

      {/* Main Scrollable Dashboard Content */}
      <main className="page-enter-tab flex flex-col relative w-full pt-24 pb-32 min-h-screen bg-transparent z-10 max-w-lg mx-auto px-5 space-y-4">
        {/* 1. Manager Security & Backup Indicator Pill (Crystal Glass) */}
        <div
          className="stagger-item-0 relative overflow-hidden rounded-xl p-3 crystal-glass border border-[#f1cb83]/35"
        >
          <div className="flex items-center justify-between gap-2 relative z-10 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={handleCloudBackup}
                disabled={isSyncing}
                title="پشتیبان‌گیری و همگام‌سازی ابری (Get -> Merge -> Upload)"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f1cb83] shrink-0 bg-[#f1cb83]/15 border border-[#f1cb83]/45 hover:bg-[#f1cb83]/25 cursor-pointer"
              >
                <span className={`material-symbols-outlined text-[19px] ${isSyncing ? 'animate-spin' : ''}`}>
                  {isSyncing ? 'sync' : 'cloud_done'}
                </span>
              </button>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#f1cb83] font-bold truncate">
                    پشتیبان‌گیری سرور امن
                  </span>
                  <span className={`w-2.5 h-2.5 rounded-full live-dot-pulse ${statusDotClass}`} />
                  {snapshot && snapshot.pendingUnsyncedCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-400/30">
                      {toPersianDigits(snapshot.pendingUnsyncedCount)} تغییر محلی
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[#f1cb83]/85 truncate font-medium">
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

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handlePullRefresh}
                disabled={isSyncing}
                title="دریافت آخرین نسخه سرور (Pull Only)"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#f1cb83]/12 border border-[#f1cb83]/40 text-[#f1cb83] hover:bg-[#f1cb83]/25 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
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
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[#f1cb83] text-[11px] font-bold bg-[#f1cb83]/12 border border-[#f1cb83]/40 hover:bg-[#f1cb83]/20 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">upload_file</span>
                <span>بارگذاری JSON</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  await exportBackupPackage(false);
                  await refreshSnapshot();
                  showToast('بسته پشتیبان نسخه JSON با موفقیت ذخیره شد', 'success');
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[#f1cb83] text-[11px] font-bold bg-[#f1cb83]/20 border border-[#f1cb83]/50 hover:bg-[#f1cb83]/30 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">download</span>
                <span>JSON</span>
              </button>
            </div>
          </div>

          {storageInfo.nearFull && (
            <div className="mt-2 p-2 rounded-lg bg-red-500/20 border border-red-400/40 text-red-200 text-[11px] font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">warning</span>
              <span>هشدار: فضای ذخیره‌سازی گوشی رو به اتمام است ({toPersianDigits(storageInfo.percent)}٪ پر شده).</span>
            </div>
          )}
        </div>

        {/* 2. Global Smart Search Bar (Typed + Voice + Filter Sheet) */}
        <div className="stagger-item-1 relative overflow-hidden rounded-xl crystal-glass p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between gap-2.5 relative z-10 w-full">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-9 h-9 rounded-lg bg-[#f1cb83]/10 border border-[#f1cb83]/25 flex items-center justify-center text-[#f1cb83] shrink-0">
                <span className="material-symbols-outlined text-[20px]">search</span>
              </div>
              <input
                type="text"
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                placeholder="جستجوی هوشمند (نام، کد، زمین ۳۰۰ متری زیر ۱۲ میلیارد...)"
                className="w-full bg-transparent border-0 outline-none focus:ring-0 p-0 text-xs font-medium text-[#dae2ff] placeholder:text-[#d1c5b4]/70 text-right"
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
              <button
                type="button"
                onClick={handleVoiceSearch}
                title="جستجوی صوتی فارسی"
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                  isVoiceListening
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-[#f1cb83]/15 text-[#f1cb83] hover:bg-[#f1cb83]/25'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">mic</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFilterSheetOpen(!filterSheetOpen)}
              className="relative shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[#261900] bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[11px] font-bold shadow-[0_0_14px_rgba(241,203,131,0.35)] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">
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

          {/* Collapsible Global Search Filter Sheet */}
          {filterSheetOpen && (
            <div className="mt-3 pt-3 border-t border-[#f1cb83]/20 space-y-3 relative z-10">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-[#d1c5b4] mb-1">بخش سامانه</label>
                  <select
                    value={globalFilterEntity}
                    onChange={(e) => setGlobalFilterEntity(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg bg-[#050b17] border border-[#f1cb83]/25 text-xs text-[#dae2ff]"
                  >
                    <option value="all">همه بخش‌ها</option>
                    <option value="properties">ملک‌ها</option>
                    <option value="applicants">متقاضیان</option>
                    <option value="collaborators">همکاران</option>
                    <option value="reminders">یادآورها</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#d1c5b4] mb-1">شهر / منطقه</label>
                  <select
                    value={globalFilterCity}
                    onChange={(e) => setGlobalFilterCity(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg bg-[#050b17] border border-[#f1cb83]/25 text-xs text-[#dae2ff]"
                  >
                    <option value="all">همه شهرها</option>
                    <option value="کلارآباد">کلارآباد</option>
                    <option value="متل قو">متل قو (سلمان‌شهر)</option>
                    <option value="نمک‌آبرود">چالوس و نمک‌آبرود</option>
                    <option value="عباس‌آباد">عباس‌آباد</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-[#d1c5b4] mb-1">وضعیت</label>
                  <select
                    value={globalFilterStatus}
                    onChange={(e) => setGlobalFilterStatus(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg bg-[#050b17] border border-[#f1cb83]/25 text-xs text-[#dae2ff]"
                  >
                    <option value="all">همه</option>
                    <option value="فعال">فعال</option>
                    <option value="در مذاکره">در مذاکره</option>
                    <option value="در حال پیگیری">در حال پیگیری</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setGlobalFilterEntity('all');
                    setGlobalFilterCity('all');
                    setGlobalFilterStatus('all');
                  }}
                  className="px-3 py-1 rounded-lg bg-white/10 text-[11px] text-[#d1c5b4] cursor-pointer"
                >
                  بازنشانی
                </button>
                <button
                  type="button"
                  onClick={() => setFilterSheetOpen(false)}
                  className="px-3 py-1 rounded-lg bg-[#f1cb83] text-[#261900] text-[11px] font-bold cursor-pointer"
                >
                  بستن فیلتر
                </button>
              </div>
            </div>
          )}

          {/* Global Search Results Dropdown */}
          {globalSearchResults && (
            <div className="mt-3 pt-3 border-t border-white/10 space-y-2.5 max-h-80 overflow-y-auto relative z-10">
              <div className="flex items-center justify-between text-[11px] text-[#f1cb83]">
                <span>نتایج جستجوی سراسری کلید:</span>
                <span>{toPersianDigits(globalSearchResults.total)} مورد یافت شد</span>
              </div>

              {globalSearchResults.total === 0 && (
                <div className="p-4 text-center text-xs text-[#d1c5b4]">
                  موردی با این عبارت در املاک، متقاضیان، همکاران یا یادآورها یافت نشد.
                </div>
              )}

              {globalSearchResults.props.map(({ item, matchedFields }) => (
                <div
                  key={item.id}
                  onClick={() => navigate(`/properties/${item.id}`)}
                  className="p-2.5 rounded-xl bg-[#050b17]/80 border border-[#f1cb83]/25 hover:border-[#f1cb83] flex items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-[#f1cb83]/20 text-[#f1cb83] text-[10px] font-bold">
                        ملک {item.code}
                      </span>
                      <span className="text-xs font-bold text-[#dae2ff] truncate">{item.title}</span>
                    </div>
                    <span className="text-[10px] text-[#d1c5b4] mt-0.5">
                      {item.city} • {toPersianDigits(item.area)} متر • {formatToman(item.totalPrice)}
                    </span>
                    {matchedFields.length > 0 && (
                      <span className="text-[10px] text-emerald-300 mt-0.5">
                        تطبیق در: {matchedFields.join('، ')}
                      </span>
                    )}
                  </div>
                  <span className="material-symbols-outlined text-[#f1cb83] text-[18px]">arrow_back</span>
                </div>
              ))}

              {globalSearchResults.apps.map(({ item, matchedFields }) => (
                <div
                  key={item.id}
                  onClick={() => navigate(`/applicants/${item.id}/edit`)}
                  className="p-2.5 rounded-xl bg-[#050b17]/80 border border-sky-400/25 hover:border-sky-400 flex items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-sky-400/20 text-sky-300 text-[10px] font-bold">
                        متقاضی {item.code}
                      </span>
                      <span className="text-xs font-bold text-[#dae2ff] truncate">{item.name}</span>
                    </div>
                    <span className="text-[10px] text-[#d1c5b4] mt-0.5">
                      بودجه تا {formatToman(item.maxBudget)} • {matchedFields.join('، ')}
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-sky-400 text-[18px]">arrow_back</span>
                </div>
              ))}

              {globalSearchResults.cols.map(({ item, matchedFields }) => (
                <div
                  key={item.id}
                  onClick={() => navigate(`/collaborators/${item.id}/edit`)}
                  className="p-2.5 rounded-xl bg-[#050b17]/80 border border-emerald-400/25 hover:border-emerald-400 flex items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-400/20 text-emerald-300 text-[10px] font-bold">
                        همکار {item.code}
                      </span>
                      <span className="text-xs font-bold text-[#dae2ff] truncate">{item.name}</span>
                    </div>
                    <span className="text-[10px] text-[#d1c5b4] mt-0.5">
                      {item.agencyName || item.primaryCity} • {matchedFields.join('، ')}
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-emerald-400 text-[18px]">arrow_back</span>
                </div>
              ))}

              {globalSearchResults.rems.map(({ item }) => (
                <div
                  key={item.id}
                  onClick={() => navigate('/inbox')}
                  className="p-2.5 rounded-xl bg-[#050b17]/80 border border-amber-400/25 hover:border-amber-400 flex items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 text-[10px] font-bold">
                        یادآور {item.code}
                      </span>
                      <span className="text-xs font-bold text-[#dae2ff] truncate">{item.title}</span>
                    </div>
                    <span className="text-[10px] text-[#d1c5b4] mt-0.5">
                      موعد: {item.jalaliDate} ساعت {item.timeDisplay}
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-amber-400 text-[18px]">arrow_back</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. Top Hero Stat Summary («وضعیت پورتفوی کلید» from Stitch Image 8.html) */}
        <div className="stagger-item-2 relative overflow-hidden rounded-xl crystal-glass p-4">
          <div className="flex items-center justify-between mb-3 relative z-10">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#f1cb83] shadow-[0_0_12px_rgba(241,203,131,0.95)] live-dot-pulse" />
              <span className="text-[17px] font-bold text-[#dae2ff]">وضعیت پورتفوی کلید</span>
            </div>
            {/* Real Today's Jalali Date (fixed from sample 17 Mehr) */}
            <div className="px-2.5 py-0.5 rounded-full bg-[#f1cb83]/15 border border-[#f1cb83]/25 text-[#f1cb83] text-[11px] font-medium">
              {getTodayDashChip()}
            </div>
          </div>

          {loading || !snapshot ? (
            <div className="grid grid-cols-3 gap-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-lg bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 relative z-10">
              {/* 1. کل فایل‌ها */}
              <button
                type="button"
                onClick={() => openPropertiesWithFilter({ status: 'همه وضعیت‌ها' })}
                className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.03] transition-all group"
              >
                <span className="text-[11px] text-[#d1c5b4] font-medium group-hover:text-[#f1cb83]">
                  کل فایل‌ها
                </span>
                <span className="text-[26px] font-bold text-[#f1cb83] mt-0.5 leading-tight">
                  {toPersianDigits(snapshot.propertyStats.total)}
                </span>
                <span className="text-[10px] text-[#d1c5b4]/60">پروژه ثبت‌شده</span>
              </button>

              {/* 2. فایل‌های فعال */}
              <button
                type="button"
                onClick={() => openPropertiesWithFilter({ status: 'فعال' })}
                className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.03] transition-all group"
              >
                <span className="text-[11px] text-emerald-400 font-medium">فایل‌های فعال</span>
                <span className="text-[26px] font-bold text-[#dae2ff] mt-0.5 leading-tight group-hover:text-emerald-300">
                  {toPersianDigits(snapshot.propertyStats.active)}
                </span>
                <span className="text-[10px] text-emerald-400/80">عرضه در بازار</span>
              </button>

              {/* 3. نیاز به پیگیری -> Opens Inbox filtered to overdue */}
              <button
                type="button"
                onClick={() => {
                  setInboxInitialTab('overdue');
                  navigate('/inbox');
                }}
                className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.03] transition-all group"
              >
                <span className="text-[11px] text-[#ffb4ab] font-medium">نیاز به پیگیری</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[26px] font-bold text-[#ffb4ab] leading-tight">
                    {toPersianDigits(snapshot.propertyStats.needFollowup)}
                  </span>
                  {snapshot.propertyStats.needFollowup > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                  )}
                </div>
                <span className="text-[10px] text-[#ffb4ab]/80">اقدام ضروری</span>
              </button>

              {/* 4. در حال مذاکره */}
              <button
                type="button"
                onClick={() => openPropertiesWithFilter({ status: 'در مذاکره' })}
                className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.03] transition-all group"
              >
                <span className="text-[11px] text-[#d1c5b4] font-medium group-hover:text-[#38bdf8]">
                  در حال مذاکره
                </span>
                <span className="text-[22px] font-bold text-[#38bdf8] mt-0.5 leading-tight">
                  {toPersianDigits(snapshot.propertyStats.negotiating)}
                </span>
                <span className="text-[10px] text-[#d1c5b4]/60">جلسه نهایی</span>
              </button>

              {/* 5. فروخته شده */}
              <button
                type="button"
                onClick={() => openPropertiesWithFilter({ status: 'فروخته‌شده' })}
                className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.03] transition-all group"
              >
                <span className="text-[11px] text-[#d1c5b4] font-medium">فروخته شده</span>
                <span className="text-[22px] font-bold text-[#d1c5b4] mt-0.5 leading-tight">
                  {toPersianDigits(snapshot.propertyStats.sold)}
                </span>
                <span className="text-[10px] text-[#d1c5b4]/60">موفق / تسویه‌شده</span>
              </button>

              {/* 6. فایل جدید ماه */}
              <button
                type="button"
                onClick={() => openPropertiesWithFilter({ sortBy: 'newest' })}
                className="flex flex-col items-center justify-center p-2.5 rounded-lg crystal-glass-inner cursor-pointer hover:scale-[1.03] transition-all group"
              >
                <span className="text-[11px] text-[#f1cb83] font-medium">فایل جدید ماه</span>
                <span className="text-[22px] font-bold text-[#f1cb83] mt-0.5 leading-tight">
                  +{toPersianDigits(snapshot.propertyStats.newThisMonth)}
                </span>
                <span className="text-[10px] text-[#d1c5b4]/60">ورودی جدید</span>
              </button>
            </div>
          )}
        </div>

        {/* 4. Accordion 1: «پیشنهاد فایل به مشتری» (Intelligent Match Recommendations) */}
        <div className="stagger-item-3 relative overflow-hidden rounded-xl crystal-glass">
          <button
            type="button"
            onClick={() => setMatchAccordionOpen(!matchAccordionOpen)}
            className="w-full p-4 flex items-center justify-between text-right cursor-pointer select-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#f1cb83]/30 to-[#d4b06a]/10 border border-[#f1cb83]/25 flex items-center justify-center text-[#f1cb83] shrink-0">
                <span className="material-symbols-outlined text-[22px]">lightbulb</span>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[15px] font-bold text-[#dae2ff] truncate">
                    پیشنهاد فایل به مشتری
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#f1cb83]/20 border border-[#f1cb83]/30 text-[#f1cb83] text-[11px] font-semibold shrink-0">
                    {toPersianDigits(activeSuggestions.length)} پیشنهاد
                  </span>
                </div>
                <span className="text-[11px] text-[#d1c5b4] truncate">
                  انطباق الگوریتم بر مبنای بودجه و علایق متقاضی
                </span>
              </div>
            </div>
            <div
              className={`w-8 h-8 rounded-full bg-[#2c344b]/40 border border-[#f1cb83]/15 flex items-center justify-center text-[#d1c5b4] transition-transform duration-300 ${
                matchAccordionOpen ? 'rotate-180' : ''
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">expand_more</span>
            </div>
          </button>

          {matchAccordionOpen && (
            <div className="px-4 pb-4 space-y-3 pt-1 relative z-10">
              {activeSuggestions.length === 0 ? (
                <div className="p-4 rounded-xl crystal-glass-inner text-center text-xs text-[#d1c5b4]">
                  در حال حاضر پیشنهاد تطبیق جدیدی بالای ۷۰٪ وجود ندارد.
                </div>
              ) : (
                activeSuggestions.map(({ link, applicant, property }) => (
                  <div
                    key={link.id}
                    className="rounded-xl crystal-glass-inner p-3 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-[#21293f] border border-[#f1cb83]/15 flex items-center justify-center text-[#f1cb83] shrink-0">
                          <span className="material-symbols-outlined text-[20px]">person_check</span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-[#dae2ff] truncate">
                              {applicant.name}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-[#2c344b]/60 text-[#d1c5b4] text-[10px]">
                              {applicant.code}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#f1cb83] truncate">
                            بودجه تا {formatToman(applicant.maxBudget)} • {applicant.cities.join('، ')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
                          {toPersianDigits(link.score)}٪ همپوشانی
                        </span>
                        <button
                          type="button"
                          onClick={() => dismissMatchPair(link.id)}
                          title="رد کردن پیشنهاد"
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
                          <img
                            src={property.photos[0]?.fallbackUrl || '/images/kelarabad-land.jpg'}
                            alt={property.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[11px] font-bold text-[#dae2ff] truncate">
                            {property.title} ({property.code})
                          </span>
                          <span className="text-[10px] text-[#d1c5b4] truncate">
                            {toPersianDigits(property.area)} متر مربع • {property.deedType}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-[#f1cb83] shrink-0">
                        {formatToman(property.totalPrice)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => navigate(`/applicants/${applicant.id}/edit`)}
                        className="h-9 rounded-lg bg-[#21293f]/80 hover:bg-[#30394f] border border-white/10 text-[#dae2ff] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[17px]">account_box</span>
                        <span>اطلاعات مشتری</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/properties/${property.id}`)}
                        className="h-9 rounded-lg bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#261900] text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[17px]">visibility</span>
                        <span>رویت فایل {property.code}</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 5. Accordion 2: «هشدارها و پیگیری‌ها» (Urgent Alerts & Follow-ups) */}
        <div className="stagger-item-4 relative overflow-hidden rounded-xl crystal-glass">
          <button
            type="button"
            onClick={() => setAlertsAccordionOpen(!alertsAccordionOpen)}
            className="w-full p-4 flex items-center justify-between text-right cursor-pointer select-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500/30 to-red-900/10 border border-red-400/30 flex items-center justify-center text-[#ffb4ab] shrink-0">
                <span className="material-symbols-outlined text-[22px]">warning</span>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold text-[#dae2ff]">هشدارها و پیگیری‌ها</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#93000a]/80 border border-red-400/40 text-[#ffdad6] text-[11px] font-semibold">
                    {toPersianDigits(snapshot?.dashboardAlerts.length || 0)} مورد
                  </span>
                </div>
                <span className="text-[11px] text-[#d1c5b4] truncate">
                  نیازمند اقدام فوری مشاور و مدیر املاک
                </span>
              </div>
            </div>
            <div
              className={`w-8 h-8 rounded-full bg-[#2c344b]/40 border border-[#f1cb83]/15 flex items-center justify-center text-[#d1c5b4] transition-transform duration-300 ${
                alertsAccordionOpen ? 'rotate-180' : ''
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">expand_more</span>
            </div>
          </button>

          {alertsAccordionOpen && (
            <div className="px-4 pb-4 space-y-3 pt-1 relative z-10">
              {!snapshot || snapshot.dashboardAlerts.length === 0 ? (
                <div className="p-4 rounded-xl crystal-glass-inner text-center text-xs text-emerald-300">
                  تمام پیگیری‌ها و مجوزهای پرونده‌ها به‌روز هستند ✓
                </div>
              ) : (
                snapshot.dashboardAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="rounded-xl crystal-glass-inner p-3 flex flex-col gap-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-red-500/20 border border-red-400/30 text-[#ffb4ab] text-[10px] font-bold">
                          {alert.badge}
                        </span>
                        <span className="text-[11px] text-[#d1c5b4]">{alert.codeLabel}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[#ffb4ab] font-medium">
                          {alert.delayLabel}
                        </span>
                        {alert.propertyIdForDismiss && (
                          <button
                            type="button"
                            onClick={() => dismissPermitWarning(alert.propertyIdForDismiss!)}
                            className="text-[10px] text-[#d1c5b4] hover:text-[#f1cb83] underline cursor-pointer"
                          >
                            دیگر نشان نده
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div
                        onClick={() => navigate(alert.targetRoute)}
                        className="flex flex-col min-w-0 cursor-pointer"
                      >
                        <span className="text-xs font-bold text-[#dae2ff] truncate hover:text-[#f1cb83]">
                          {alert.title}
                        </span>
                        <span className="text-[11px] text-[#d1c5b4] line-clamp-1">
                          {alert.subtitle}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (alert.phone) {
                            triggerPhoneCall(alert.phone, () =>
                              showToast('شماره تماسی برای این رکورد ثبت نشده است', 'error')
                            );
                          } else {
                            navigate(alert.targetRoute);
                          }
                        }}
                        className="shrink-0 h-9 px-3 rounded-lg bg-[#f1cb83] hover:brightness-110 text-[#261900] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">phone_in_talk</span>
                        <span>{alert.actionLabel}</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 6. «آخرین وضعیت فایل‌های ممتاز» (Top 3 Highest Total-Price Active Properties) */}
        <div className="stagger-item-5 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">
                workspace_premium
              </span>
              <span className="text-[16px] font-bold text-[#dae2ff]">
                آخرین وضعیت فایل‌های ممتاز
              </span>
            </div>
            <button
              type="button"
              onClick={() => openPropertiesWithFilter({ sortBy: 'cheapest', sortAsc: false })}
              className="text-[11px] text-[#f1cb83] font-semibold hover:underline cursor-pointer"
            >
              مشاهده همه
            </button>
          </div>

          {!snapshot || snapshot.propertyStats.premiumTop3.length === 0 ? (
            <div className="rounded-xl crystal-glass p-5 text-center space-y-3">
              <KelidLogoIcon className="w-12 h-12 mx-auto" />
              <p className="text-xs font-bold text-[#dae2ff]">
                هنوز هیچ پرونده ملکی در سامانه ثبت نشده است
              </p>
              <p className="text-[11px] text-[#d1c5b4] leading-relaxed">
                برای شروع کار با کلید، اولین ملک، متقاضی خرید یا همکار املاک خود را ثبت کنید یا فایل پشتیبان قبلی را بارگذاری نمایید.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => navigate('/properties/new')}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#261900] text-xs font-extrabold cursor-pointer"
                >
                  + ثبت اولین ملک
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/applicants/new')}
                  className="px-3 py-2 rounded-xl bg-white/10 border border-white/15 text-[#dae2ff] text-xs font-bold cursor-pointer"
                >
                  + ثبت متقاضی
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/collaborators/new')}
                  className="px-3 py-2 rounded-xl bg-white/10 border border-white/15 text-[#dae2ff] text-xs font-bold cursor-pointer"
                >
                  + ثبت همکار
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {snapshot.propertyStats.premiumTop3.map((prop) => (
                <div
                  key={prop.id}
                  onClick={() => navigate(`/properties/${prop.id}`)}
                  className="relative overflow-hidden rounded-xl crystal-glass p-3 flex items-center gap-3 cursor-pointer hover:border-[#f1cb83]/50 transition-all group"
                >
                  <div className="w-16 h-16 rounded-xl bg-[#21293f] overflow-hidden shrink-0 border border-[#f1cb83]/25">
                    <img
                      src={prop.photos[0]?.fallbackUrl || '/images/kelarabad-land.jpg'}
                      alt={prop.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-[#dae2ff] truncate group-hover:text-[#f1cb83]">
                        {prop.title}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#f1cb83]/20 border border-[#f1cb83]/25 text-[#f1cb83] text-[10px] font-bold shrink-0">
                        {prop.code}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#d1c5b4] truncate mt-0.5">
                      {prop.propertyType} {toPersianDigits(prop.area)} متر مربع • {prop.deedType}
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs font-bold text-[#f1cb83]">
                        {formatToman(prop.totalPrice)}
                      </span>
                      <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot-pulse" />
                        {prop.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Import JSON Preview & Merge Confirmation Modal */}
      {importPreviewModal && (
        <div
          className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setImportPreviewModal(null)}
        >
          <div
            className="sheet-enter-up w-full max-w-sm rounded-2xl bg-[#0a152d]/95 border border-[#f1cb83]/40 p-5 shadow-2xl space-y-4 text-right"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h3 className="text-sm font-bold text-[#f1cb83]">پیش‌نمایش ادغام فایل پشتیبان</h3>
              <button
                type="button"
                onClick={() => setImportPreviewModal(null)}
                className="text-[#d1c5b4]"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p className="text-xs text-[#dae2ff] leading-relaxed">
              بسته پشتیبان (نسخه {toPersianDigits(importPreviewModal.pkg.version)}) اعتبارسنجی شد.
              طبق قانون ادغام ایمن، هیچ رکوردی از گوشی حذف نمی‌شود:
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-400/30">
                <span className="block text-base font-bold text-emerald-300">
                  {toPersianDigits(importPreviewModal.preview.addedCount)}
                </span>
                <span className="text-[10px] text-emerald-200">رکورد جدید</span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/30">
                <span className="block text-base font-bold text-[#f1cb83]">
                  {toPersianDigits(importPreviewModal.preview.updatedCount)}
                </span>
                <span className="text-[10px] text-[#f1cb83]">به‌روزرسانی</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                <span className="block text-base font-bold text-[#d1c5b4]">
                  {toPersianDigits(importPreviewModal.preview.unchangedCount)}
                </span>
                <span className="text-[10px] text-[#d1c5b4]">بدون تغییر</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={confirmMergeImport}
                className="py-2.5 rounded-xl bg-gradient-to-r from-[#d4b06a] to-[#f1cb83] text-[#261900] text-xs font-bold cursor-pointer"
              >
                تایید و ادغام ایمن
              </button>
              <button
                type="button"
                onClick={() => setImportPreviewModal(null)}
                className="py-2.5 rounded-xl bg-white/10 text-xs text-[#d1c5b4] cursor-pointer"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNavAndQuickMenu />
    </div>
  );
};
