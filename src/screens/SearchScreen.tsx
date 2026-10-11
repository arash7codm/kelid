import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { KelidLogoIcon } from '../components/Layout';
import { saveReminder } from '../db/repositories';
import { useApp } from '../hooks/useAppContext';
import { runWithViewTransition } from '../motion';
import { aiService, ParsedNaturalSearch } from '../services/ai';
import { triggerPhoneCall } from '../services/maps';
import {
  searchApplicantsSmart,
  searchCollaboratorsSmart,
  searchPropertiesSmart,
  searchRemindersSmart,
} from '../services/search';
import { VoiceSessionController } from '../services/voice';
import {
  addDaysToJalali,
  amountToTomanWords,
  formatToman,
  getTodayJalali,
  toPersianDigits,
} from '../utils/persian';

export const SearchScreen: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    snapshot,
    currentUser,
    setPropertyFilters,
    resetPropertyFilters,
    searchState,
    setSearchState,
    refreshSnapshot,
    showToast,
    askPermission,
  } = useApp();

  const isManager = currentUser.role === 'مدیر';
  const isViewer = currentUser.role === 'بیننده';

  const query = searchState.query;
  const setQuery = (val: string) =>
    setSearchState((prev) => ({ ...prev, query: val }));
  const scope = searchState.scope;
  const setScope = (
    val: 'all' | 'properties' | 'applicants' | 'collaborators' | 'high_match'
  ) => setSearchState((prev) => ({ ...prev, scope: val }));
  const sortByMatch = searchState.sortByMatch;
  const setSortByMatch = (val: boolean | ((prev: boolean) => boolean)) =>
    setSearchState((prev) => ({
      ...prev,
      sortByMatch: typeof val === 'function' ? val(prev.sortByMatch) : val,
    }));
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [aiCriteria, setAiCriteria] = useState<ParsedNaturalSearch | null>(null);
  const voiceRef = useRef<VoiceSessionController | null>(null);

  const properties = snapshot?.properties || [];
  const applicants = snapshot?.applicants || [];
  const collaborators = snapshot?.collaborators || [];
  const reminders = snapshot?.reminders || [];
  const matchLinks = snapshot?.matchLinks || [];

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qParam = params.get('q');
    const applicantId = params.get('applicantId');
    if (qParam) {
      setQuery(qParam);
    } else if (applicantId && applicants.length > 0) {
      const app = applicants.find((a) => a.id === applicantId);
      if (app) {
        setQuery(`${app.cities[0] || ''} تا ${formatToman(app.maxBudget)}`.trim());
      }
    }
  }, [location.search, applicants]);

  useEffect(() => {
    if (!query.trim()) {
      setAiCriteria(null);
      return;
    }
    const timer = setTimeout(() => {
      aiService.parseNaturalSearch(query).then(setAiCriteria);
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const interpretedChips = useMemo(() => {
    if (!aiCriteria) return [];
    const chips: string[] = [];
    if (aiCriteria.city) chips.push(`منطقه: ${aiCriteria.city}`);
    if (aiCriteria.propertyType) chips.push(`نوع: ${aiCriteria.propertyType}`);
    if (aiCriteria.maxPrice) chips.push(`سقف بودجه: ${formatToman(aiCriteria.maxPrice)}`);
    if (aiCriteria.minArea) chips.push(`متراژ: حداقل ${toPersianDigits(aiCriteria.minArea)} متر`);
    if (aiCriteria.deedType) chips.push(`سند: ${aiCriteria.deedType}`);
    return chips;
  }, [aiCriteria]);

  const propertyHits = useMemo(
    () => searchPropertiesSmart(properties, query),
    [properties, query]
  );
  const applicantHits = useMemo(
    () => searchApplicantsSmart(applicants, query),
    [applicants, query]
  );
  const collaboratorHits = useMemo(
    () => searchCollaboratorsSmart(collaborators, properties, query),
    [collaborators, properties, query]
  );
  const reminderHits = useMemo(
    () => searchRemindersSmart(reminders, properties, applicants, collaborators, query),
    [reminders, properties, applicants, collaborators, query]
  );

  const topBidirectionalMatch = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const targetAppId = params.get('applicantId');
    const candidateMatches = (
      targetAppId
        ? matchLinks.filter((m) => m.applicantId === targetAppId && !m.dismissed)
        : matchLinks.filter((m) => !m.dismissed)
    ).sort((a, b) => b.score - a.score);

    const top = candidateMatches[0];
    if (!top) return null;

    const prop = properties.find((p) => p.id === top.propertyId);
    const app = applicants.find((a) => a.id === top.applicantId);
    if (!prop || !app) return null;

    return {
      score: top.score,
      property: prop,
      applicant: app,
      budgetDiff: Math.max(0, app.maxBudget - prop.totalPrice),
    };
  }, [matchLinks, properties, applicants, location.search]);

  const sortedPropertyHits = useMemo(() => {
    const list = propertyHits.map((h) => {
      const bestMatch = matchLinks
        .filter((m) => m.propertyId === h.item.id)
        .sort((a, b) => b.score - a.score)[0];
      const computedScore = bestMatch
        ? bestMatch.score
        : h.matchedFields.length > 0
        ? Math.min(100, 75 + h.matchedFields.length * 8)
        : 100;
      return {
        ...h,
        score: computedScore,
      };
    });
    if (!sortByMatch) {
      list.sort((a, b) => a.item.totalPrice - b.item.totalPrice);
    } else {
      list.sort((a, b) => b.score - a.score);
    }
    return list;
  }, [propertyHits, matchLinks, sortByMatch]);

  const totalResultsCount =
    propertyHits.length +
    applicantHits.length +
    collaboratorHits.length +
    (query.trim() ? reminderHits.length : 0);

  const handleVoiceInput = async () => {
    if (isVoiceListening) {
      voiceRef.current?.stop();
      setIsVoiceListening(false);
      return;
    }
    const allowed = await askPermission('microphone');
    if (!allowed) return;
    setIsVoiceListening(true);
    const session = new VoiceSessionController({
      onLiveTranscript: (t) => setQuery(t),
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

  const handleShareMatchWithCustomer = async () => {
    if (!topBidirectionalMatch) return;
    const { property, applicant, score } = topBidirectionalMatch;
    const shareText = `پیشنهاد ویژه کلید برای جناب/سرکار ${applicant.name}:\nملک: ${
      property.title
    } (کد ${property.code})\nمتراژ: ${toPersianDigits(property.area)} متر • ${
      property.deedType
    }\nقیمت کل: ${amountToTomanWords(property.totalPrice)}\nامتیاز تطبیق هوشمند: ${toPersianDigits(
      score
    )}٪`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `معرفی ملک ${property.title}`,
          text: shareText,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    await navigator.clipboard?.writeText(shareText);
    showToast('مشخصات کامل ملک برای ارسال به متقاضی کپی شد.', 'success');
  };

  const handleScheduleJointVisit = async () => {
    if (!topBidirectionalMatch) return;
    const { property, applicant } = topBidirectionalMatch;
    await saveReminder({
      title: `قرار بازدید مشترک — ${property.title}`,
      transcript: `بازدید حضوری ملک کد ${property.code} به همراه متقاضی ${applicant.name} (${applicant.code})`,
      jalaliDate: addDaysToJalali(getTodayJalali(true), 1, true),
      time: '11:30',
      timeDisplay: '۱۱:۳۰ صبح',
      priority: 'urgent',
      categories: ['visit'],
      status: 'pending',
      linkedPropertyId: property.id,
      linkedApplicantId: applicant.id,
      customLinks: [],
      smsNotification: true,
      registerInCartable: true,
      calendarStatus: 'none',
      syncStatus: 'local',
      aiFilledFields: [],
    });
    await refreshSnapshot();
    showToast('قرار بازدید مشترک برای فردا ساعت ۱۱:۳۰ در تقویم ثبت شد.', 'success');
    runWithViewTransition(() => navigate('/reminders'));
  };

  return (
    <div className="relative z-10 max-w-md mx-auto min-h-screen flex flex-col pb-28">
      {/* Header & Smart Search Bar (Exact match to Image 22.html) */}
      <header className="pt-5 px-4 pb-3 sticky top-0 z-30 bg-[#050b18]/85 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => runWithViewTransition(() => navigate(-1))}
              className="w-10 h-10 rounded-xl glass-card flex items-center justify-center border border-white/15 text-white hover:border-[#f1cb83]/50 active:scale-95 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
            <KelidLogoIcon className="w-10 h-10" />
            <div>
              <h1 className="text-lg font-extrabold text-white tracking-tight gold-text-glow">
                جستجو و تطبیق هوشمند کلید
              </h1>
              <p className="text-[11px] text-slate-300 font-medium">
                کاوش همزمان در املاک، متقاضیان، همکاران و یادآورها
              </p>
            </div>
          </div>

          <div className="px-2.5 py-1.5 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/40 flex items-center gap-1">
            <span className="material-symbols-outlined text-[#f1cb83] text-sm">auto_awesome</span>
            <span className="text-[10px] font-extrabold text-[#f1cb83]">موتور تطبیق فعال</span>
          </div>
        </div>

        {/* Smart Search & Voice Input Box */}
        <div className="glass-input rounded-2xl p-2 flex items-center gap-2 border border-[#f1cb83]/50 shadow-[0_0_20px_rgba(241,203,131,0.15)] mb-2.5">
          <span className="material-symbols-outlined text-[#f1cb83] text-xl mr-1">
            manage_search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو به زبان طبیعی: مثلاً زمین کلارآباد تا ۱۰ میلیارد..."
            className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-bold"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="w-7 h-7 rounded-lg bg-white/10 text-slate-300 flex items-center justify-center hover:text-white shrink-0 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleVoiceInput}
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-md active:scale-95 transition-transform cursor-pointer ${
              isVoiceListening ? 'bg-rose-500 text-white animate-pulse' : 'gold-pill-btn'
            }`}
          >
            <span className="material-symbols-outlined text-lg">mic</span>
          </button>
        </div>

        {/* AI Natural Language Parsed Filter Chips */}
        {interpretedChips.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mb-3 pb-0.5">
            <span className="text-[10px] text-[#f1cb83] font-bold shrink-0 flex items-center gap-0.5 ml-1">
              <span className="material-symbols-outlined text-xs">psychology</span>
              درک هوشمند:
            </span>
            {interpretedChips.map((chip, idx) => (
              <span
                key={idx}
                className="px-2.5 py-1 rounded-lg bg-[#f1cb83]/15 border border-[#f1cb83]/40 text-[#f1cb83] text-[10px] font-bold shrink-0 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-xs">bolt</span>
                {chip}
              </span>
            ))}
            <button
              type="button"
              onClick={() => setQuery('')}
              className="px-2 py-1 rounded-lg bg-white/5 border border-white/15 text-slate-300 text-[10px] shrink-0 hover:text-white cursor-pointer"
            >
              حذف فیلترها
            </button>
          </div>
        )}

        {/* Category Scope Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {[
            { id: 'all', label: `همه نتایج (${toPersianDigits(totalResultsCount)})` },
            {
              id: 'properties',
              label: `املاک منطبق (${toPersianDigits(propertyHits.length)})`,
            },
            {
              id: 'applicants',
              label: `متقاضیان (${toPersianDigits(applicantHits.length)})`,
            },
            {
              id: 'collaborators',
              label: `همکاران (${toPersianDigits(collaboratorHits.length)})`,
            },
            {
              id: 'high_match',
              label: 'تطبیق دوطرفه (۹۰٪+)',
              highlight: true,
            },
          ].map((tab) => {
            const active = scope === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setScope(tab.id as typeof scope)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all cursor-pointer flex items-center gap-1 ${
                  active
                    ? 'gold-pill-btn font-extrabold shadow-sm'
                    : tab.highlight
                    ? 'glass-card text-[#f1cb83] border border-[#f1cb83]/30'
                    : 'glass-card text-slate-200 border border-white/15 hover:border-[#f1cb83]/40'
                }`}
              >
                {tab.highlight && !active && (
                  <span className="material-symbols-outlined text-xs">auto_awesome</span>
                )}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="px-4 pt-4 space-y-4 flex-1">
        {totalResultsCount === 0 && !topBidirectionalMatch && (
          <div className="glass-card rounded-2xl p-8 text-center space-y-3 border border-white/15">
            <div className="flex justify-center">
              <KelidLogoIcon className="w-12 h-12" />
            </div>
            <p className="text-sm font-bold text-white">موردی منطبق با جستجوی شما یافت نشد</p>
            <p className="text-xs text-slate-400">
              عبارت جستجو را تغییر دهید یا ابتدا پرونده‌های ملک، متقاضی و همکار را ثبت نمایید.
            </p>
          </div>
        )}
        {/* Section 1: Cross-Entity Smart Match Card (Property <-> Applicant) */}
        {(scope === 'all' || scope === 'high_match') && topBidirectionalMatch && (
          <section className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#f1cb83] text-lg">hub</span>
                <h2 className="text-xs font-extrabold text-white">
                  بهترین تطبیق دوطرفه (ملک ⇄ متقاضی)
                </h2>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-extrabold">
                امتیاز تطبیق: {toPersianDigits(topBidirectionalMatch.score)}٪
              </span>
            </div>

            <article className="glass-card gold-border-glow rounded-2xl p-3.5 relative overflow-hidden bg-gradient-to-b from-[#f1cb83]/15 to-[#0c162d]/90">
              <div className="grid grid-cols-2 gap-2.5 items-center mb-3">
                {/* Matched Property Side */}
                <div
                  onClick={() =>
                    runWithViewTransition(() =>
                      navigate(`/properties/${topBidirectionalMatch.property.id}`)
                    )
                  }
                  className="bg-[#080f20]/80 rounded-xl p-2.5 border border-[#f1cb83]/30 cursor-pointer hover:border-[#f1cb83]"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-[#f1cb83]/20 text-[#f1cb83] text-[9px] font-bold">
                      ملک کد {topBidirectionalMatch.property.code}
                    </span>
                    <span className="material-symbols-outlined text-[#f1cb83] text-sm">
                      home_work
                    </span>
                  </div>
                  <h3 className="text-xs font-extrabold text-white truncate">
                    {topBidirectionalMatch.property.title}
                  </h3>
                  <p className="text-[11px] text-[#f1cb83] font-bold mt-1">
                    {formatToman(topBidirectionalMatch.property.totalPrice)}
                  </p>
                  <p className="text-[9px] text-slate-300 mt-0.5">
                    {topBidirectionalMatch.property.deedType} •{' '}
                    {topBidirectionalMatch.property.district}
                  </p>
                </div>

                {/* Matched Applicant Side */}
                <div
                  onClick={() =>
                    runWithViewTransition(() =>
                      navigate(
                        isViewer
                          ? '/applicants'
                          : `/applicants/${topBidirectionalMatch.applicant.id}/edit`
                      )
                    )
                  }
                  className="bg-[#080f20]/80 rounded-xl p-2.5 border border-emerald-400/30 cursor-pointer hover:border-emerald-400"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">
                      متقاضی کد {topBidirectionalMatch.applicant.code}
                    </span>
                    <span className="material-symbols-outlined text-emerald-300 text-sm">
                      person_check
                    </span>
                  </div>
                  <h3 className="text-xs font-extrabold text-white truncate">
                    {topBidirectionalMatch.applicant.name}
                  </h3>
                  <p className="text-[11px] text-emerald-300 font-bold mt-1">
                    بودجه: تا {formatToman(topBidirectionalMatch.applicant.maxBudget)}
                  </p>
                  <p className="text-[9px] text-slate-300 mt-0.5">
                    {topBidirectionalMatch.applicant.creditTier} • آماده بازدید
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-300 bg-[#080f20]/60 px-3 py-1.5 rounded-lg border border-white/10 mb-2.5">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs text-emerald-400">
                    verified
                  </span>
                  تطابق کامل منطقه و متراژ •{' '}
                  {topBidirectionalMatch.budgetDiff > 0
                    ? `${formatToman(topBidirectionalMatch.budgetDiff)} زیر سقف بودجه متقاضی`
                    : 'منطبق با بودجه متقاضی'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleShareMatchWithCustomer}
                  className="gold-pill-btn py-2 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-transform cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">send</span>
                  <span>ارسال مشخصات به مشتری</span>
                </button>
                <button
                  type="button"
                  onClick={handleScheduleJointVisit}
                  className="py-2 rounded-xl bg-white/10 border border-white/20 text-white text-[11px] font-bold flex items-center justify-center gap-1 active:scale-95 transition-transform cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm text-[#f1cb83]">
                    calendar_add_on
                  </span>
                  <span>ثبت قرار بازدید مشترک</span>
                </button>
              </div>
            </article>
          </section>
        )}

        {/* Section 2: Matched Properties Results */}
        {(scope === 'all' || scope === 'properties' || scope === 'high_match') && (
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#f1cb83] text-lg">apartment</span>
                <h2 className="text-xs font-extrabold text-white">
                  املاک یافت‌شده ({toPersianDigits(sortedPropertyHits.length)} مورد)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSortByMatch((prev) => !prev)}
                className="text-[10px] text-[#f1cb83] flex items-center gap-0.5 font-bold cursor-pointer"
              >
                <span className="material-symbols-outlined text-xs">sort</span>
                <span>
                  {sortByMatch ? 'مرتب‌سازی: بیشترین تطبیق' : 'مرتب‌سازی: ارزان‌ترین قیمت'}
                </span>
              </button>
            </div>

            {sortedPropertyHits.length === 0 && (
              <div className="glass-card rounded-2xl p-6 text-center border border-white/15 space-y-2">
                <div className="flex justify-center">
                  <KelidLogoIcon className="w-12 h-12" />
                </div>
                <p className="text-xs font-bold text-slate-300">
                  ملکی با این عبارت در بایگانی یافت نشد.
                </p>
              </div>
            )}

            {sortedPropertyHits.map(({ item: prop, score }) => (
              <article
                key={prop.id}
                className="glass-card rounded-2xl p-3.5 border border-white/15 hover:border-[#f1cb83]/50 transition-all"
              >
                <div className="flex gap-3">
                  <div
                    onClick={() => runWithViewTransition(() => navigate(`/properties/${prop.id}`))}
                    className="w-24 h-24 rounded-xl overflow-hidden relative shrink-0 border border-white/15 cursor-pointer"
                  >
                    <img
                      src={prop.photos[0]?.fallbackUrl || '/images/kelarabad-land.jpg'}
                      alt={prop.title}
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-[#050b18]/85 border border-[#f1cb83]/50 text-[#f1cb83] text-[9px] font-extrabold">
                      {toPersianDigits(score)}٪ تطبیق
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="px-2 py-0.5 rounded bg-[#f1cb83]/15 border border-[#f1cb83]/40 text-[#f1cb83] text-[10px] font-bold">
                        {prop.code}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold">
                        {prop.status}
                      </span>
                    </div>
                    <h3
                      onClick={() => runWithViewTransition(() => navigate(`/properties/${prop.id}`))}
                      className="text-sm font-extrabold text-white mt-1 truncate cursor-pointer hover:text-[#f1cb83]"
                    >
                      {prop.title}
                    </h3>
                    <p className="text-[11px] text-slate-300 mt-0.5 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                        location_on
                      </span>
                      {prop.city}، {prop.district} • {prop.contactPartnerName || 'فایل مستقیم'}
                    </p>
                    <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-black text-[#f1cb83]">
                          {formatToman(prop.totalPrice)}
                        </p>
                        <p className="text-[9px] text-slate-300">
                          {amountToTomanWords(prop.totalPrice)}
                        </p>
                      </div>
                      <span className="text-[10px] text-white bg-white/10 px-2 py-1 rounded-lg font-bold">
                        متری {formatToman(prop.pricePerMeter)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/10 gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] text-slate-200 border border-white/10">
                      {prop.deedType}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] text-slate-200 border border-white/10">
                      {toPersianDigits(prop.area)} متر
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isManager && prop.ownerPhone && (
                      <button
                        type="button"
                        onClick={() => triggerPhoneCall(prop.ownerPhone)}
                        className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 flex items-center justify-center cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">call</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => runWithViewTransition(() => navigate(`/properties/${prop.id}`))}
                      className="px-2.5 py-1 rounded-lg bg-[#f1cb83] text-[#050b18] text-[10px] font-extrabold cursor-pointer"
                    >
                      جزئیات
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}

        {/* Section 3: Matched Applicants & Collaborators */}
        {(scope === 'all' || scope === 'applicants' || scope === 'collaborators') && (
          <section className="space-y-3 pt-1">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#f1cb83] text-lg">groups</span>
                <h2 className="text-xs font-extrabold text-white">متقاضیان و همکاران مرتبط</h2>
              </div>
            </div>

            {/* Applicant Result Card */}
            {(scope === 'all' || scope === 'applicants') &&
              applicantHits.map(({ item: app }) => (
                <article
                  key={app.id}
                  className="glass-card rounded-2xl p-3.5 border border-white/15 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-emerald-300 text-xl">
                        person_search
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">
                          متقاضی {app.code}
                        </span>
                        <h3 className="text-xs font-extrabold text-white">{app.name}</h3>
                      </div>
                      <p className="text-[11px] text-[#f1cb83] font-bold mt-0.5">
                        بودجه: تا {formatToman(app.maxBudget)} • متقاضی {app.cities.join(' و ')}
                      </p>
                      <p className="text-[10px] text-slate-300">
                        {app.desiredPropertyTypes.join(' / ')} حداقل {toPersianDigits(app.minArea)}{' '}
                        متر • {app.creditTier}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        runWithViewTransition(() =>
                          navigate(isViewer ? '/applicants' : `/applicants/${app.id}/edit`)
                        )
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-[#f1cb83]/20 border border-[#f1cb83]/40 text-[#f1cb83] text-[10px] font-extrabold cursor-pointer"
                    >
                      مشاهده پرونده
                    </button>
                  </div>
                </article>
              ))}

            {/* Collaborator Result Card */}
            {(scope === 'all' || scope === 'collaborators') &&
              collaboratorHits.map(({ item: col }) => (
                <article
                  key={col.id}
                  className="glass-card rounded-2xl p-3.5 border border-white/15 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/40 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[#f1cb83] text-xl">
                        handshake
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-[#f1cb83]/20 text-[#f1cb83] text-[9px] font-bold">
                          همکار {col.code}
                        </span>
                        <h3 className="text-xs font-extrabold text-white">
                          {col.name} ({col.agencyName || col.role})
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-200 font-semibold mt-0.5">
                        دارای فایل شهرکی فعال در {col.primaryCity}
                      </p>
                      <p className="text-[10px] text-emerald-300">
                        {col.cooperationStatus} • کمیسیون{' '}
                        {col.commissionSplit === '50_50' ? '۵۰/۵۰' : 'ویژه'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      resetPropertyFilters();
                      setPropertyFilters((prev) => ({
                        ...prev,
                        collaboratorIdFilter: col.id,
                        searchQuery: col.name,
                      }));
                      runWithViewTransition(() => navigate('/properties'));
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-[10px] font-bold shrink-0 cursor-pointer"
                  >
                    فایل‌های همکار
                  </button>
                </article>
              ))}
          </section>
        )}
      </main>
    </div>
  );
};
