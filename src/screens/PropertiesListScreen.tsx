import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AmbientBackground, BottomNavAndQuickMenu, KelidLogoIcon } from '../components/Layout';
import { PropertyRecord } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { searchPropertiesSmart } from '../services/search';
import { VoiceSessionController } from '../services/voice';
import {
  amountToTomanWords,
  areaToPersianWords,
  compareJalaliDates,
  formatToman,
  formatWithSeparator,
  normalizePersianText,
  parseNumericInput,
  rangeToAreaWords,
  rangeToTomanWords,
  toPersianDigits,
} from '../utils/persian';

let savedPropertiesVisibleLimit = 25;

export const PropertiesListScreen: React.FC = () => {
  const navigate = useNavigate();
  const {
    snapshot,
    loading,
    currentUser,
    propertyFilters,
    setPropertyFilters,
    resetPropertyFilters,
    openMapChooser,
    askPermission,
    showToast,
  } = useApp();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [selectedMapProperty, setSelectedMapProperty] = useState<PropertyRecord | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(savedPropertiesVisibleLimit);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const voiceRef = useRef<VoiceSessionController | null>(null);

  const isViewer = currentUser.role === 'بیننده';

  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 400 &&
        visibleLimit < (snapshot?.properties.length || 0)
      ) {
        setVisibleLimit((prev) => {
          const next = prev + 30;
          savedPropertiesVisibleLimit = next;
          return next;
        });
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      voiceRef.current?.cancel();
    };
  }, [visibleLimit, snapshot?.properties.length]);

  const minAreaNum = parseNumericInput(propertyFilters.minArea);
  const maxAreaNum = parseNumericInput(propertyFilters.maxArea);
  const areaRangeInvalid = minAreaNum > 0 && maxAreaNum > 0 && minAreaNum > maxAreaNum;

  const minBudgetNum = parseNumericInput(propertyFilters.minBudget);
  const maxBudgetNum = parseNumericInput(propertyFilters.maxBudget);
  const budgetRangeInvalid = minBudgetNum > 0 && maxBudgetNum > 0 && minBudgetNum > maxBudgetNum;

  // Real count of active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (propertyFilters.propertyTypes.length > 0) count++;
    if (propertyFilters.city && propertyFilters.city !== 'همه') count++;
    if (propertyFilters.status && propertyFilters.status !== 'همه وضعیت‌ها') count++;
    if (propertyFilters.zoning && propertyFilters.zoning !== 'همه') count++;
    if (propertyFilters.deed) count++;
    if (minAreaNum > 0 || maxAreaNum > 0) count++;
    if (minBudgetNum > 0 || maxBudgetNum > 0) count++;
    if (propertyFilters.collaboratorIdFilter) count++;
    return count;
  }, [propertyFilters, minAreaNum, maxAreaNum, minBudgetNum, maxBudgetNum]);

  // Filtered & Sorted Properties
  const filteredProperties = useMemo(() => {
    if (!snapshot) return [];
    const searchHits = searchPropertiesSmart(snapshot.properties, propertyFilters.searchQuery);

    const list = searchHits
      .map((h) => h.item)
      .filter((prop) => {
        if (
          propertyFilters.collaboratorIdFilter &&
          prop.referrerCollaboratorId !== propertyFilters.collaboratorIdFilter
        ) {
          return false;
        }
        if (propertyFilters.propertyTypes.length > 0) {
          if (!propertyFilters.propertyTypes.includes(prop.propertyType)) return false;
        }
        if (propertyFilters.city && propertyFilters.city !== 'همه') {
          if (!normalizePersianText(prop.city).includes(normalizePersianText(propertyFilters.city))) {
            return false;
          }
        }
        if (propertyFilters.status && propertyFilters.status !== 'همه وضعیت‌ها') {
          if (prop.status !== propertyFilters.status) return false;
        }
        if (propertyFilters.zoning && propertyFilters.zoning !== 'همه') {
          const zNorm = normalizePersianText(`${prop.zoningStatus} ${prop.zoningCustom || ''}`);
          if (propertyFilters.zoning === 'داخل بافت' && !zNorm.includes('داخل بافت')) return false;
          if (propertyFilters.zoning === 'خارج بافت' && !zNorm.includes('خارج بافت')) return false;
          if (propertyFilters.zoning === 'داخل حریم' && !zNorm.includes('حریم')) return false;
        }
        if (propertyFilters.deed) {
          const dNorm = normalizePersianText(`${prop.deedType} ${prop.deedCustom || ''}`);
          if (!dNorm.includes(normalizePersianText(propertyFilters.deed))) return false;
        }
        if (!areaRangeInvalid) {
          if (minAreaNum > 0 && prop.area < minAreaNum) return false;
          if (maxAreaNum > 0 && prop.area > maxAreaNum) return false;
        }
        if (!budgetRangeInvalid) {
          if (minBudgetNum > 0 && prop.totalPrice < minBudgetNum) return false;
          if (maxBudgetNum > 0 && prop.totalPrice > maxBudgetNum) return false;
        }
        return true;
      });

    // Sort
    const dir = propertyFilters.sortAsc ? 1 : -1;
    list.sort((a, b) => {
      if (propertyFilters.sortBy === 'cheapest') {
        return ((a.totalPrice || 0) - (b.totalPrice || 0)) * (propertyFilters.sortAsc ? 1 : -1);
      }
      if (propertyFilters.sortBy === 'ppm') {
        return ((a.pricePerMeter || 0) - (b.pricePerMeter || 0)) * dir;
      }
      if (propertyFilters.sortBy === 'area') {
        return ((b.area || 0) - (a.area || 0)) * (propertyFilters.sortAsc ? -1 : 1);
      }
      return compareJalaliDates(b.registerDate, a.registerDate) * (propertyFilters.sortAsc ? -1 : 1);
    });

    return list;
  }, [snapshot, propertyFilters, minAreaNum, maxAreaNum, minBudgetNum, maxBudgetNum, areaRangeInvalid, budgetRangeInvalid]);

  const propertiesWithCoords = useMemo(
    () =>
      filteredProperties.filter(
        (p) => typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng)
      ),
    [filteredProperties]
  );

  const missingCoordsProperties = useMemo(
    () =>
      filteredProperties.filter(
        (p) => typeof p.lat !== 'number' || typeof p.lng !== 'number' || isNaN(p.lat) || isNaN(p.lng)
      ),
    [filteredProperties]
  );

  // Quick Chips & Panel Property Type share one state
  const handleQuickChip = (chipType: string) => {
    if (chipType === 'all') {
      setPropertyFilters((prev) => ({
        ...prev,
        quickChip: 'all',
        propertyTypes: [],
        zoning: 'همه',
        deed: '',
        collaboratorIdFilter: undefined,
      }));
    } else if (chipType === 'land') {
      setPropertyFilters((prev) => ({
        ...prev,
        quickChip: 'land',
        propertyTypes: ['زمین', 'باغ'],
      }));
    } else if (chipType === 'villa') {
      setPropertyFilters((prev) => ({
        ...prev,
        quickChip: 'villa',
        propertyTypes: ['ویلا'],
      }));
    } else if (chipType === 'baft') {
      setPropertyFilters((prev) => ({
        ...prev,
        quickChip: 'baft',
        zoning: prev.zoning === 'داخل بافت' ? 'همه' : 'داخل بافت',
      }));
    } else if (chipType === 'sanad') {
      setPropertyFilters((prev) => ({
        ...prev,
        quickChip: 'sanad',
        deed: prev.deed === 'تک‌برگ' ? '' : 'تک‌برگ',
      }));
    }
  };

  const togglePropertyTypeInPanel = (typeLabel: string) => {
    setPropertyFilters((prev) => {
      const exists = prev.propertyTypes.includes(typeLabel);
      const nextTypes = exists
        ? prev.propertyTypes.filter((t) => t !== typeLabel)
        : [...prev.propertyTypes, typeLabel];
      return {
        ...prev,
        propertyTypes: nextTypes,
        quickChip: nextTypes.length === 0 ? 'all' : 'custom',
      };
    });
  };

  const handleSortClick = (sortKey: 'cheapest' | 'ppm' | 'area' | 'newest') => {
    setPropertyFilters((prev) => {
      if (prev.sortBy === sortKey) {
        return { ...prev, sortAsc: !prev.sortAsc };
      }
      return {
        ...prev,
        sortBy: sortKey,
        sortAsc: sortKey === 'cheapest',
      };
    });
  };

  const handleVoiceSearch = async () => {
    if (isVoiceListening) {
      voiceRef.current?.stop();
      setIsVoiceListening(false);
      return;
    }
    const allowed = await askPermission('microphone');
    if (!allowed) return;
    const ctrl = new VoiceSessionController({
      onLiveTranscript: (txt) =>
        setPropertyFilters((prev) => ({ ...prev, searchQuery: txt })),
      onSilenceTimeout: (msg) => {
        setIsVoiceListening(false);
        showToast(msg, 'info');
      },
      onRecordingComplete: ({ transcript }) => {
        setIsVoiceListening(false);
        if (transcript) {
          setPropertyFilters((prev) => ({ ...prev, searchQuery: transcript }));
        }
      },
      onError: (err) => {
        setIsVoiceListening(false);
        showToast(err, 'error');
      },
    });
    voiceRef.current = ctrl;
    if (await ctrl.start()) setIsVoiceListening(true);
  };

  return (
    <div className="min-h-screen bg-[#070d1a] text-[#dae2ff] relative overflow-x-hidden">
      <AmbientBackground />

      <main className="page-enter-tab flex flex-col relative w-full pb-32 min-h-screen bg-transparent z-10 max-w-lg mx-auto">
        {/* Header & Brand Top Bar with Glass Finish (Stitch Image 10.html — removed fake dots unless loading) */}
        <header className="px-5 pt-3 pb-3 flex flex-col gap-2.5 border-b border-[#f1cb83]/20 bg-[#050d22]/75 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="w-11 h-11 flex items-center justify-center p-0 m-0 cursor-pointer"
              >
                <KelidLogoIcon className="w-10 h-10" />
              </button>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <h1 className="text-[20px] font-bold text-[#dae2ff] tracking-tight">
                    جستجو و بایگانی
                  </h1>
                  {loading && (
                    <div className="flex items-center gap-1 pr-1">
                      <span className="w-2 h-2 rounded-full bg-[#f1cb83] animate-ping" />
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-[#d1c5b4]/80">
                  سامانه مشاورین املاک شمال کشور
                </span>
              </div>
            </div>

            {/* Real Active Files Counter Badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f1cb83]/10 border border-[#f1cb83]/35 shadow-[0_0_14px_rgba(241,203,131,0.22)]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 live-dot-pulse" />
              <span className="text-xs font-bold text-[#f1cb83]">
                {toPersianDigits(snapshot?.propertyStats.active || 0)} فایل فعال
              </span>
            </div>
          </div>

          {/* Search Bar & Filter Toggle Button */}
          <div className="flex items-center gap-2 mt-1">
            <div className="relative flex-1 group">
              <div className="flex items-center w-full rounded-2xl bg-[#0b1426]/80 border border-[#f1cb83]/35 px-3 py-2 transition-all focus-within:border-[#f1cb83]">
                <span className="material-symbols-outlined text-[#f1cb83] text-[20px] ml-2">
                  search
                </span>
                <input
                  type="text"
                  value={propertyFilters.searchQuery}
                  onChange={(e) =>
                    setPropertyFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
                  }
                  placeholder="جستجوی کد فایل، منطقه، مالک یا برچسب..."
                  className="w-full bg-transparent text-xs text-[#dae2ff] placeholder:text-[#d1c5b4]/60 focus:outline-none"
                />
                {propertyFilters.searchQuery && (
                  <button
                    type="button"
                    onClick={() => setPropertyFilters((prev) => ({ ...prev, searchQuery: '' }))}
                    className="text-[#d1c5b4]/60 hover:text-[#dae2ff] p-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[17px]">cancel</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleVoiceSearch}
                  title="جستجوی صوتی"
                  className={`w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer ${
                    isVoiceListening ? 'bg-red-500 text-white animate-pulse' : 'text-[#f1cb83]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">mic</span>
                </button>
              </div>
            </div>

            {/* Toggle Filter Drawer Button with Real Active Filter Badge */}
            <button
              type="button"
              onClick={() => setDrawerOpen(!drawerOpen)}
              className={`relative flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-2xl border transition-all cursor-pointer ${
                drawerOpen
                  ? 'bg-[#f1cb83] text-[#261900] border-[#f1cb83] font-bold shadow-[0_4px_16px_rgba(241,203,131,0.3)]'
                  : 'bg-[#0b1426]/80 text-[#f1cb83] border-[#f1cb83]/35 font-bold'
              }`}
            >
              <span
                className={`material-symbols-outlined text-[21px] transition-transform duration-300 ${
                  drawerOpen ? 'rotate-180' : ''
                }`}
              >
                {drawerOpen ? 'close' : 'tune'}
              </span>
              <span className="text-xs font-bold hidden sm:inline">فیلترها</span>
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#f1cb83] text-[#261900] border border-[#070d1a] font-extrabold text-[10px] flex items-center justify-center shadow">
                  {toPersianDigits(activeFilterCount)}
                </span>
              )}
            </button>
          </div>

          {/* Quick Chips Row (Shares one state with panel's نوع کاربری) */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5">
            <button
              type="button"
              onClick={() => handleQuickChip('all')}
              className={`px-3 py-1 rounded-xl text-[11px] whitespace-nowrap flex items-center gap-1 cursor-pointer transition-all ${
                propertyFilters.quickChip === 'all' && activeFilterCount === 0
                  ? 'bg-[#f1cb83] text-[#261900] font-bold shadow-[0_0_12px_rgba(241,203,131,0.4)]'
                  : 'bg-[#21293f]/50 text-[#d1c5b4] border border-[#f1cb83]/20'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">grid_view</span>
              <span>همه فایل‌ها</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickChip('land')}
              className={`px-3 py-1 rounded-xl text-[11px] whitespace-nowrap flex items-center gap-1 cursor-pointer transition-all ${
                propertyFilters.propertyTypes.includes('زمین')
                  ? 'bg-[#f1cb83] text-[#261900] font-bold'
                  : 'bg-[#21293f]/50 text-[#d1c5b4] border border-[#f1cb83]/20'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">landscape</span>
              <span>زمین و باغات</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickChip('villa')}
              className={`px-3 py-1 rounded-xl text-[11px] whitespace-nowrap flex items-center gap-1 cursor-pointer transition-all ${
                propertyFilters.propertyTypes.includes('ویلا')
                  ? 'bg-[#f1cb83] text-[#261900] font-bold'
                  : 'bg-[#21293f]/50 text-[#d1c5b4] border border-[#f1cb83]/20'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">villa</span>
              <span>ویلا مستقل</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickChip('baft')}
              className={`px-3 py-1 rounded-xl text-[11px] whitespace-nowrap flex items-center gap-1 cursor-pointer transition-all ${
                propertyFilters.zoning === 'داخل بافت'
                  ? 'bg-[#f1cb83] text-[#261900] font-bold'
                  : 'bg-[#21293f]/50 text-[#d1c5b4] border border-[#f1cb83]/20'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">verified</span>
              <span>داخل بافت</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickChip('sanad')}
              className={`px-3 py-1 rounded-xl text-[11px] whitespace-nowrap flex items-center gap-1 cursor-pointer transition-all ${
                propertyFilters.deed === 'تک‌برگ'
                  ? 'bg-[#f1cb83] text-[#261900] font-bold'
                  : 'bg-[#21293f]/50 text-[#d1c5b4] border border-[#f1cb83]/20'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">description</span>
              <span>سند تک‌برگ</span>
            </button>
          </div>
        </header>

        <div className="px-5 flex flex-col gap-4 mt-3">
          {/* COLLAPSIBLE ADVANCED FILTER PANEL («فیلترهای پیشرفته» from Stitch Image 10.html) */}
          {drawerOpen && (
            <div className="sheet-enter-up relative rounded-3xl crystal-glass p-4 border border-[#f1cb83]/35 flex flex-col gap-4">
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#f1cb83]/20">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#f1cb83]/20 flex items-center justify-center text-[#f1cb83] border border-[#f1cb83]/30">
                    <span className="material-symbols-outlined text-[20px]">filter_list</span>
                  </div>
                  <h3 className="text-[16px] font-bold text-[#dae2ff]">فیلترهای پیشرفته</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={resetPropertyFilters}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#21293f]/60 hover:bg-[#f1cb83]/20 text-[#d1c5b4] hover:text-[#f1cb83] text-xs border border-[#f1cb83]/20 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                    <span>بازنشانی</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#d1c5b4] cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
              </div>

              {/* 1. Property Type Multi-Select Chips */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#d1c5b4] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[#f1cb83] text-[17px]">apartment</span>
                  <span>نوع کاربری ملک (چندانتخابی)</span>
                </label>
                <div className="grid grid-cols-5 gap-1.5 w-full">
                  {[
                    { label: 'زمین', icon: 'landscape' },
                    { label: 'آپارتمان', icon: 'domain' },
                    { label: 'ویلا', icon: 'villa' },
                    { label: 'تجاری', icon: 'storefront' },
                    { label: 'باغ', icon: 'park' },
                  ].map((t) => {
                    const selected = propertyFilters.propertyTypes.includes(t.label);
                    return (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => togglePropertyTypeInPanel(t.label)}
                        className={`py-1.5 px-0.5 rounded-xl text-[11px] whitespace-nowrap flex items-center justify-center gap-0.5 cursor-pointer transition-all ${
                          selected
                            ? 'bg-[#f1cb83] text-[#261900] font-bold shadow-[0_0_12px_rgba(241,203,131,0.35)]'
                            : 'bg-[#21293f]/40 text-[#d1c5b4] border border-[#f1cb83]/20'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[13px]">{t.icon}</span>
                        <span>{t.label === 'تجاری' ? 'مغازه' : t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. City & File Status (including فروخته‌شده & غیرفعال so archived files are reachable) */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-[#d1c5b4] flex items-center gap-1">
                    <span className="material-symbols-outlined text-[#f1cb83] text-[15px]">location_on</span>
                    <span>شهر / منطقه</span>
                  </label>
                  <select
                    value={propertyFilters.city}
                    onChange={(e) =>
                      setPropertyFilters((prev) => ({ ...prev, city: e.target.value }))
                    }
                    className="w-full rounded-xl bg-[#091224]/80 py-2 px-2.5 text-xs text-[#dae2ff] border border-[#f1cb83]/25 focus:border-[#f1cb83] focus:outline-none"
                  >
                    <option value="همه">همه شهرها</option>
                    <option value="کلارآباد">کلارآباد</option>
                    <option value="متل قو">متل قو (سلمان‌شهر)</option>
                    <option value="چالوس">چالوس و نمک‌آبرود</option>
                    <option value="نوشهر">نوشهر و سیسنگان</option>
                    <option value="عباس‌آباد">عباس‌آباد و کلاردشت</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-[#d1c5b4] flex items-center gap-1">
                    <span className="material-symbols-outlined text-[#f1cb83] text-[15px]">rule</span>
                    <span>وضعیت فایل (شامل بایگانی)</span>
                  </label>
                  <select
                    value={propertyFilters.status}
                    onChange={(e) =>
                      setPropertyFilters((prev) => ({ ...prev, status: e.target.value }))
                    }
                    className="w-full rounded-xl bg-[#091224]/80 py-2 px-2.5 text-xs text-[#dae2ff] border border-[#f1cb83]/25 focus:border-[#f1cb83] focus:outline-none"
                  >
                    <option value="همه وضعیت‌ها">همه وضعیت‌ها</option>
                    <option value="فعال">فعال (آماده فروش)</option>
                    <option value="در مذاکره">در مذاکره</option>
                    <option value="فروخته‌شده">فروخته‌شده (بایگانی)</option>
                    <option value="غیرفعال">غیرفعال (بایگانی)</option>
                  </select>
                </div>
              </div>

              {/* 3. Zoning Status & Deed Type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[#d1c5b4] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[#f1cb83] text-[16px]">texture</span>
                  <span>وضعیت بافت شهرداری و دهیاری</span>
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {['داخل بافت', 'خارج بافت', 'داخل حریم', 'همه'].map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setPropertyFilters((prev) => ({ ...prev, zoning: z }))}
                      className={`py-1.5 px-1 rounded-xl text-xs text-center cursor-pointer transition-all ${
                        propertyFilters.zoning === z
                          ? 'bg-[#f1cb83] text-[#261900] font-bold shadow-[0_0_10px_rgba(241,203,131,0.3)]'
                          : 'bg-[#21293f]/40 text-[#d1c5b4] border border-[#f1cb83]/20'
                      }`}
                    >
                      {z}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[#d1c5b4] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[#f1cb83] text-[16px]">description</span>
                  <span>نوع سند مالکیت</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['تک‌برگ', 'منگوله‌دار', 'قولنامه‌ای معتبر', 'وکالتی'].map((d) => {
                    const active = propertyFilters.deed === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          setPropertyFilters((prev) => ({
                            ...prev,
                            deed: prev.deed === d ? '' : d,
                          }))
                        }
                        className={`px-2.5 py-1 rounded-xl text-xs flex items-center gap-1 cursor-pointer transition-all ${
                          active
                            ? 'bg-[#f1cb83]/20 text-[#f1cb83] border border-[#f1cb83]/50 font-semibold'
                            : 'bg-[#21293f]/40 text-[#d1c5b4] border border-[#f1cb83]/20'
                        }`}
                      >
                        {active && <span className="material-symbols-outlined text-[13px]">check</span>}
                        <span>{d}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Area Range (Min/Max validation) */}
              <div
                className={`flex flex-col gap-2 rounded-2xl bg-white/[0.03] p-3 border ${
                  areaRangeInvalid ? 'border-red-500' : 'border-[#f1cb83]/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#dae2ff] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[#f1cb83] text-[16px]">straighten</span>
                    <span>محدوده متراژ (متر مربع)</span>
                  </span>
                  <span className="text-[10px] text-[#f1cb83]/85 font-medium">
                    {rangeToAreaWords(propertyFilters.minArea, propertyFilters.maxArea) || 'همه متراژها'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 bg-[#091224]/70 rounded-xl px-3 py-2 border border-[#f1cb83]/15">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-[#d1c5b4]/75">از:</span>
                    <input
                      type="text"
                      value={toPersianDigits(propertyFilters.minArea)}
                      onChange={(e) =>
                        setPropertyFilters((prev) => ({ ...prev, minArea: e.target.value }))
                      }
                      placeholder="حداقل"
                      className="w-full bg-transparent text-center font-bold text-[#f1cb83] text-sm focus:outline-none"
                    />
                    <span className="text-[11px] text-[#d1c5b4]/60">متر</span>
                  </div>
                  <div className="w-3 h-[1px] bg-[#f1cb83]/30 shrink-0" />
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-[#d1c5b4]/75">تا:</span>
                    <input
                      type="text"
                      value={toPersianDigits(propertyFilters.maxArea)}
                      onChange={(e) =>
                        setPropertyFilters((prev) => ({ ...prev, maxArea: e.target.value }))
                      }
                      placeholder="حداکثر"
                      className="w-full bg-transparent text-center font-bold text-[#f1cb83] text-sm focus:outline-none"
                    />
                    <span className="text-[11px] text-[#d1c5b4]/60">متر</span>
                  </div>
                </div>
                {areaRangeInvalid && (
                  <p className="text-[11px] text-red-400 font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">error</span>
                    <span>حداقل متراژ نمی‌تواند بیشتر از حداکثر متراژ باشد.</span>
                  </p>
                )}
              </div>

              {/* 5. Total Budget Range Box (with dynamic Persian words that always match the numbers) */}
              <div
                className={`rounded-2xl bg-gradient-to-br from-white/[0.05] via-[#091224]/60 to-black/40 p-3.5 border flex flex-col gap-2.5 ${
                  budgetRangeInvalid ? 'border-red-500' : 'border-[#f1cb83]/25'
                }`}
              >
                <span className="text-xs font-semibold text-[#dae2ff] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[#f1cb83] text-[17px]">payments</span>
                  <span>بودجه کل سرمایه‌گذاری (تومان)</span>
                </span>
                <div className="grid grid-cols-2 gap-2 w-full">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-[#d1c5b4]/80 font-medium">از مبلغ (حداقل):</label>
                    <div className="flex items-center rounded-xl bg-[#0b1426]/80 border border-[#f1cb83]/20 px-2.5 py-2">
                      <input
                        type="text"
                        value={
                          propertyFilters.minBudget
                            ? formatWithSeparator(propertyFilters.minBudget, true)
                            : ''
                        }
                        onChange={(e) =>
                          setPropertyFilters((prev) => ({
                            ...prev,
                            minBudget: String(parseNumericInput(e.target.value) || ''),
                          }))
                        }
                        placeholder="۳٬۰۰۰٬۰۰۰٬۰۰۰"
                        className="w-full bg-transparent font-bold text-[#f1cb83] text-xs focus:outline-none text-center"
                      />
                      <span className="text-[10px] text-[#d1c5b4]/70 mr-1">تومان</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-[#d1c5b4]/80 font-medium">تا مبلغ (حداکثر):</label>
                    <div className="flex items-center rounded-xl bg-[#0b1426]/80 border border-[#f1cb83]/20 px-2.5 py-2">
                      <input
                        type="text"
                        value={
                          propertyFilters.maxBudget
                            ? formatWithSeparator(propertyFilters.maxBudget, true)
                            : ''
                        }
                        onChange={(e) =>
                          setPropertyFilters((prev) => ({
                            ...prev,
                            maxBudget: String(parseNumericInput(e.target.value) || ''),
                          }))
                        }
                        placeholder="۱۵٬۰۰۰٬۰۰۰٬۰۰۰"
                        className="w-full bg-transparent font-bold text-[#f1cb83] text-xs focus:outline-none text-center"
                      />
                      <span className="text-[10px] text-[#d1c5b4]/70 mr-1">تومان</span>
                    </div>
                  </div>
                </div>
                {budgetRangeInvalid && (
                  <p className="text-[11px] text-red-400 font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">error</span>
                    <span>مبلغ «از» نمی‌تواند بیشتر از مبلغ «تا» باشد.</span>
                  </p>
                )}
                {(minBudgetNum > 0 || maxBudgetNum > 0) && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#f1cb83]/10 border border-[#f1cb83]/25">
                    <span className="material-symbols-outlined text-[#f1cb83] text-[15px]">edit_note</span>
                    <p className="text-[11px] text-[#f1cb83] font-medium leading-relaxed">
                      به حروف: {rangeToTomanWords(minBudgetNum, maxBudgetNum)}
                    </p>
                  </div>
                )}
              </div>

              {/* Drawer Action Footer */}
              <div className="flex items-center gap-2 pt-1 border-t border-[#f1cb83]/20">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#261900] text-xs font-bold shadow-[0_0_20px_rgba(241,203,131,0.35)] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">done_all</span>
                  <span>
                    اعمال فیلترها و نمایش نتایج ({toPersianDigits(filteredProperties.length)})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="py-3 px-3 rounded-xl bg-[#21293f]/50 text-[#dae2ff] text-xs font-semibold border border-[#f1cb83]/30 cursor-pointer"
                >
                  بستن پنل
                </button>
              </div>
            </div>
          )}

          {/* In-App Satellite Map Banner (Opens In-App Map Modal with Markers & Missing Coords Alert) */}
          <div
            onClick={() => {
              setSelectedMapProperty(propertiesWithCoords[0] || null);
              setMapModalOpen(true);
            }}
            className="relative rounded-2xl bg-gradient-to-r from-amber-500/15 via-[#0b1428]/90 to-amber-500/15 border border-[#f1cb83]/45 p-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] cursor-pointer hover:border-[#f1cb83] transition-all group"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-[#f1cb83]/30 to-[#f1cb83]/10 border border-[#f1cb83]/50 flex items-center justify-center text-[#f1cb83] shrink-0">
                  <span className="material-symbols-outlined text-[24px] text-amber-300">map</span>
                  <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#070d1a]" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-[14px] font-bold text-[#dae2ff] group-hover:text-[#f1cb83]">
                    نقشه جامع و ماهواره‌ای فایل‌ها
                  </h3>
                  <p className="text-[11px] text-[#d1c5b4]/85 leading-relaxed">
                    مشاهده {toPersianDigits(propertiesWithCoords.length)} فایل دارای موقعیت دقیق GPS روی نقشه
                    {missingCoordsProperties.length > 0
                      ? ` • ${toPersianDigits(missingCoordsProperties.length)} فایل فاقد مختصات`
                      : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#261900] font-bold text-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">explore</span>
                <span className="hidden sm:inline">نمایش نقشه</span>
              </button>
            </div>
          </div>

          {/* Results Bar & 4-Way Sorting Strip */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">apartment</span>
                <h2 className="text-[16px] font-bold text-[#dae2ff]">فایل‌های آماده معامله</h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#f1cb83]/15 text-[#f1cb83] border border-[#f1cb83]/35 font-bold">
                  {toPersianDigits(filteredProperties.length)} فایل
                </span>
              </div>
              {propertyFilters.collaboratorIdFilter && (
                <button
                  type="button"
                  onClick={() =>
                    setPropertyFilters((prev) => ({ ...prev, collaboratorIdFilter: undefined }))
                  }
                  className="text-[11px] text-amber-300 underline cursor-pointer"
                >
                  حذف فیلتر همکار ✕
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {[
                { key: 'cheapest' as const, label: 'ارزان‌ترین', icon: 'trending_down' },
                { key: 'ppm' as const, label: 'قیمت متری', icon: 'price_change' },
                { key: 'area' as const, label: 'متراژ بالا', icon: 'straighten' },
                { key: 'newest' as const, label: 'جدیدترین', icon: 'schedule' },
              ].map((s) => {
                const active = propertyFilters.sortBy === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => handleSortClick(s.key)}
                    className={`py-1.5 px-1 rounded-xl text-[11px] text-center flex items-center justify-center gap-0.5 transition-all cursor-pointer ${
                      active
                        ? 'font-bold bg-[#f1cb83] text-[#261900] shadow-[0_0_10px_rgba(241,203,131,0.35)]'
                        : 'font-medium bg-[#21293f]/40 text-[#d1c5b4] border border-[#f1cb83]/20'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">{s.icon}</span>
                    <span>{s.label}</span>
                    {active && <span className="text-[10px]">{propertyFilters.sortAsc ? '↑' : '↓'}</span>}
                  </button>
                );
              })}
            </div>

            {/* Empty State */}
            {filteredProperties.length === 0 ? (
              <div className="rounded-2xl crystal-glass p-8 text-center space-y-3">
                <KelidLogoIcon className="w-12 h-12 mx-auto" />
                <p className="text-xs font-bold text-[#dae2ff]">
                  فایل ملکی منطبق با فیلترهای انتخابی یافت نشد.
                </p>
                <button
                  type="button"
                  onClick={resetPropertyFilters}
                  className="px-4 py-2 rounded-xl bg-[#f1cb83] text-[#261900] text-xs font-bold cursor-pointer"
                >
                  بازنشانی فیلترها
                </button>
              </div>
            ) : (
              /* Virtualized / Windowed Property Cards List */
              filteredProperties.slice(0, visibleLimit).map((prop, idx) => {
                const topMatch = snapshot?.matchLinks
                  .filter((m) => m.propertyId === prop.id && m.score >= 70)
                  .sort((a, b) => b.score - a.score)[0];
                const matchedApplicant = topMatch
                  ? snapshot?.applicants.find((a) => a.id === topMatch.applicantId)
                  : undefined;

                const statusBadgeStyle =
                  prop.status === 'فعال'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35'
                    : prop.status === 'در مذاکره'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/35'
                    : 'bg-slate-700/40 text-slate-300 border-slate-500/35';

                return (
                  <div
                    key={prop.id}
                    className={`${
                      idx < 8 ? `stagger-item-${idx}` : ''
                    } relative rounded-2xl crystal-glass p-4 border border-[#f1cb83]/35 flex flex-col gap-3 group hover:border-[#f1cb83]/70 transition-all`}
                  >
                    {/* Badge Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-lg bg-[#050d22]/80 text-[#f1cb83] text-xs font-bold border border-[#f1cb83]/30">
                          {prop.code}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1 border ${statusBadgeStyle}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {prop.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#d1c5b4]/80 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">calendar_today</span>
                        {toPersianDigits(prop.registerDate)}
                      </span>
                    </div>

                    {/* Smart Match Highlight Banner (>= 70% from Matching Engine -> Opens Applicant) */}
                    {topMatch && matchedApplicant && (
                      <div
                        onClick={() => navigate(`/applicants/${matchedApplicant.id}/edit`)}
                        className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-[#f1cb83]/20 via-[#f1cb83]/10 to-transparent border border-[#f1cb83]/40 text-[#f1cb83] cursor-pointer hover:brightness-110"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="material-symbols-outlined text-[17px]">lightbulb</span>
                          <span className="text-[11px] font-bold truncate">
                            منطبق {toPersianDigits(topMatch.score)}٪ با خواسته‌ی مشتری{' '}
                            {matchedApplicant.code} ({matchedApplicant.name})
                          </span>
                        </div>
                        <span className="material-symbols-outlined text-[15px] shrink-0">
                          arrow_back
                        </span>
                      </div>
                    )}

                    {/* Property Title & Location */}
                    <div
                      onClick={() => navigate(`/properties/${prop.id}`)}
                      className="flex flex-col gap-0.5 cursor-pointer"
                    >
                      <h3 className="text-[16px] font-bold text-[#dae2ff] group-hover:text-[#f1cb83] transition-colors">
                        {prop.title}
                      </h3>
                      {(prop.city || prop.district || prop.accessPath) && (
                        <p className="text-[11px] text-[#d1c5b4] flex items-center gap-1">
                          <span className="material-symbols-outlined text-[15px] text-[#f1cb83]/80">
                            pin_drop
                          </span>
                          <span>
                            {[prop.city, prop.district, prop.accessPath].filter(Boolean).join(' — ')}
                          </span>
                        </p>
                      )}
                    </div>

                    {/* Metric Specs Box (Full Toman Numbers + Persian Words — NO م.ت) */}
                    <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-[#091224]/75 border border-[#f1cb83]/20 text-center">
                      <div className="flex flex-col justify-center">
                        <span className="text-[10px] text-[#d1c5b4]">متراژ</span>
                        <span className="text-sm font-bold text-[#dae2ff] mt-0.5">
                          {formatWithSeparator(prop.area, true)}{' '}
                          <span className="text-[10px] font-normal text-[#d1c5b4]">متر</span>
                        </span>
                        <span className="text-[10px] text-[#f1cb83]/75 truncate">
                          {areaToPersianWords(prop.area)}
                        </span>
                      </div>
                      <div className="flex flex-col justify-center border-x border-[#f1cb83]/20 px-1">
                        <span className="text-[10px] text-[#d1c5b4]">قیمت هر متر</span>
                        <span className="text-xs font-bold text-[#f1cb83] mt-0.5">
                          {formatWithSeparator(prop.pricePerMeter, true)}
                        </span>
                        <span className="text-[9px] text-[#d1c5b4] truncate">
                          {amountToTomanWords(prop.pricePerMeter)}
                        </span>
                      </div>
                      <div className="flex flex-col justify-center">
                        <span className="text-[10px] text-[#d1c5b4]">قیمت کل</span>
                        <span className="text-xs font-bold text-[#f1cb83] mt-0.5">
                          {formatWithSeparator(prop.totalPrice, true)}
                        </span>
                        <span className="text-[9px] text-[#f1cb83]/85 truncate">
                          {amountToTomanWords(prop.totalPrice)}
                        </span>
                      </div>
                    </div>

                    {/* Registered Feature Pills (Only filled ones) */}
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {prop.deedType && (
                        <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 text-[11px] border border-amber-500/30 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">
                            workspace_premium
                          </span>
                          {prop.deedType}
                        </span>
                      )}
                      {prop.zoningStatus && (
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 text-[11px] border border-emerald-500/30 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">verified</span>
                          {prop.zoningStatus}
                        </span>
                      )}
                      {prop.permitStageType && (
                        <span className="px-2.5 py-1 rounded-lg bg-[#21293f]/60 text-[#d1c5b4] text-[11px] border border-[#f1cb83]/20 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px] text-[#f1cb83]">
                            approval
                          </span>
                          {prop.permitStageType}
                        </span>
                      )}
                    </div>

                    {/* Card Action Buttons */}
                    <div
                      className={`grid ${
                        isViewer ? 'grid-cols-1' : 'grid-cols-2'
                      } gap-2 pt-1 border-t border-[#f1cb83]/15`}
                    >
                      <button
                        type="button"
                        onClick={() => navigate(`/properties/${prop.id}`)}
                        className="py-2 px-3 rounded-xl bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#261900] text-xs font-bold shadow-[0_0_16px_rgba(241,203,131,0.25)] flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                        <span>رویت کامل فایل</span>
                      </button>
                      {!isViewer && (
                        <button
                          type="button"
                          onClick={() => navigate(`/properties/${prop.id}/edit`)}
                          className="py-2 px-3 rounded-xl bg-[#21293f]/50 hover:bg-[#2c344b]/70 text-[#dae2ff] text-xs font-semibold border border-[#f1cb83]/30 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px] text-[#f1cb83]">
                            edit
                          </span>
                          <span>ویرایش مشخصات</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      {/* In-App Satellite Map Modal with Interactive Markers & Missing-Coordinates Link */}
      {mapModalOpen && (
        <div
          className="fixed inset-0 z-[130] bg-black/85 backdrop-blur-xl flex items-center justify-center p-4"
          onClick={() => setMapModalOpen(false)}
        >
          <div
            className="sheet-enter-up w-full max-w-lg rounded-3xl bg-[#0a1328] border border-[#f1cb83]/40 p-4 shadow-2xl space-y-3 text-right"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f1cb83] text-[22px]">map</span>
                <div>
                  <h3 className="text-sm font-bold text-[#dae2ff]">
                    نقشه جامع فایل‌های ملکی ({toPersianDigits(propertiesWithCoords.length)} پین فعال)
                  </h3>
                  <p className="text-[11px] text-[#d1c5b4]">
                    روی هر پین کلیک کنید تا مشخصات و مسیریابی نمایش داده شود
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMapModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[#dae2ff]"
              >
                ✕
              </button>
            </div>

            {/* Interactive Coastal Map Canvas with Property Pins */}
            <div
              className="relative w-full h-64 rounded-2xl overflow-hidden border border-[#f1cb83]/30 bg-cover bg-center"
              style={{ backgroundImage: `url('/images/kelarabad-land.jpg')` }}
            >
              <div className="absolute inset-0 bg-[#050d22]/65 backdrop-blur-[1px]" />
              <div className="absolute inset-0 opacity-30 bg-[radial-gradient(#f1cb83_1px,transparent_1px)] [background-size:20px_20px]" />

              {propertiesWithCoords.map((p, idx) => {
                const topPct = 20 + ((idx * 23) % 55);
                const leftPct = 18 + ((idx * 29) % 64);
                const isSelected = selectedMapProperty?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    style={{ top: `${topPct}%`, left: `${leftPct}%` }}
                    onClick={() => setSelectedMapProperty(p)}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full border text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#f1cb83] text-[#261900] border-white scale-110 z-20 shadow-[0_0_20px_#f1cb83]'
                        : 'bg-[#0a1328]/90 text-[#f1cb83] border-[#f1cb83]/60 hover:scale-105 z-10'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">location_on</span>
                    <span>{p.code}</span>
                  </button>
                );
              })}
            </div>

            {/* Selected Marker Mini Card */}
            {selectedMapProperty && (
              <div className="p-3 rounded-2xl bg-[#050b17]/90 border border-[#f1cb83]/35 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-[#dae2ff]">
                      {selectedMapProperty.title} ({selectedMapProperty.code})
                    </span>
                    <span className="block text-[11px] text-[#f1cb83] mt-0.5">
                      {selectedMapProperty.city} • {toPersianDigits(selectedMapProperty.area)} متر •{' '}
                      {formatToman(selectedMapProperty.totalPrice)}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[#d1c5b4]">
                    {selectedMapProperty.lat?.toFixed(4)}, {selectedMapProperty.lng?.toFixed(4)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMapModalOpen(false);
                      navigate(`/properties/${selectedMapProperty.id}`);
                    }}
                    className="py-2 rounded-xl bg-gradient-to-r from-[#d4b06a] to-[#f1cb83] text-[#261900] text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">visibility</span>
                    <span>رویت کامل فایل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      openMapChooser(
                        selectedMapProperty.lat!,
                        selectedMapProperty.lng!,
                        selectedMapProperty.title
                      )
                    }
                    className="py-2 rounded-xl bg-white/10 border border-[#f1cb83]/30 text-[#f1cb83] text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">directions</span>
                    <span>مسیریابی</span>
                  </button>
                </div>
              </div>
            )}

            {/* Missing Coordinates Notice & Quick Edit Link */}
            {missingCoordsProperties.length > 0 && (
              <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-400/35 flex items-center justify-between text-xs">
                <span className="text-amber-200">
                  {toPersianDigits(missingCoordsProperties.length)} فایل فاقد مختصات GPS هستند
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMapModalOpen(false);
                    navigate(`/properties/${missingCoordsProperties[0].id}/edit`);
                  }}
                  className="text-[#f1cb83] font-bold underline cursor-pointer"
                >
                  تکمیل مختصات ({missingCoordsProperties[0].code})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <BottomNavAndQuickMenu />
    </div>
  );
};
