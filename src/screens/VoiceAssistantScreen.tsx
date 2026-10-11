import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KelidLogoIcon } from '../components/Layout';
import {
  saveApplicant,
  saveCollaborator,
  saveProperty,
  saveReminder,
} from '../db/repositories';
import { useApp } from '../hooks/useAppContext';
import { runWithViewTransition } from '../motion';
import { localParseNaturalSearch } from '../services/ai';
import { VoiceSessionController } from '../services/voice';
import {
  addDaysToJalali,
  amountToTomanWords,
  formatWithSeparator,
  getTodayJalali,
  parseNumericInput,
  toPersianDigits,
} from '../utils/persian';

type TargetEntityType = 'property' | 'applicant' | 'collaborator' | 'reminder';

export const VoiceAssistantScreen: React.FC = () => {
  const navigate = useNavigate();
  const { refreshSnapshot, showToast, askPermission } = useApp();

  const [targetType, setTargetType] = useState<TargetEntityType>('property');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [waveformLevels, setWaveformLevels] = useState<number[]>([
    0.15, 0.2, 0.15, 0.25, 0.2, 0.15, 0.2, 0.15, 0.2, 0.15, 0.2, 0.15, 0.15,
  ]);
  const [statusMessage, setStatusMessage] = useState('آماده دریافت فرمان صوتی یا متن شما');

  const [transcript, setTranscript] = useState('');
  const [editablePriceStr, setEditablePriceStr] = useState('');
  const [editableAreaStr, setEditableAreaStr] = useState('');
  const [editableCity, setEditableCity] = useState('');
  const [editableTitle, setEditableTitle] = useState('');
  const [editableDeed, setEditableDeed] = useState('');
  const [editableCollab, setEditableCollab] = useState('');

  const sessionRef = useRef<VoiceSessionController | null>(null);

  const parseTranscriptIntoFields = (text: string, type: TargetEntityType) => {
    if (!text.trim()) return;
    const parsed = localParseNaturalSearch(text);
    if (type === 'property') {
      if (parsed.maxPrice) setEditablePriceStr(formatWithSeparator(parsed.maxPrice, false));
      if (parsed.minArea) setEditableAreaStr(String(parsed.minArea));
      if (parsed.city) setEditableCity(parsed.city);
      if (parsed.deedType) setEditableDeed(parsed.deedType);
      if (parsed.propertyType || parsed.city || parsed.minArea) {
        setEditableTitle(
          `${parsed.propertyType || 'ملک'} ${
            parsed.minArea ? `${toPersianDigits(parsed.minArea)} متری ` : ''
          }${parsed.city || ''}`.trim()
        );
      }
    } else if (type === 'applicant') {
      if (parsed.city) setEditableCity(parsed.city);
      if (parsed.minArea) setEditableAreaStr(String(parsed.minArea));
      if (parsed.maxPrice) setEditablePriceStr(formatWithSeparator(parsed.maxPrice, false));
    } else if (type === 'collaborator') {
      if (parsed.city) setEditableCity(parsed.city);
    } else {
      setEditableTitle(text.slice(0, 60));
    }
  };

  useEffect(() => {
    if (transcript.trim()) {
      parseTranscriptIntoFields(transcript, targetType);
    }
  }, [targetType]);

  useEffect(() => {
    return () => {
      sessionRef.current?.cancel();
    };
  }, []);

  const handleToggleListening = async () => {
    if (isListening) {
      sessionRef.current?.stop();
      setIsListening(false);
      setIsProcessing(true);
      setStatusMessage('در حال پردازش هوشمند هوش مصنوعی...');
      parseTranscriptIntoFields(transcript, targetType);
      setIsProcessing(false);
      setStatusMessage('فیلدها با موفقیت استخراج شدند');
      return;
    }

    const allowed = await askPermission('microphone');
    if (!allowed) return;

    setDurationSeconds(0);
    setIsListening(true);
    setStatusMessage('در حال گوش دادن و استخراج هوشمند... (توقف خودکار پس از ۴.۵ ثانیه سکوت)');

    const session = new VoiceSessionController({
      onLiveTranscript: (liveText) => {
        setTranscript(liveText);
        parseTranscriptIntoFields(liveText, targetType);
      },
      onWaveformLevels: (levels) => {
        setWaveformLevels(levels);
      },
      onDurationTick: (sec) => {
        setDurationSeconds(sec);
      },
      onSilenceTimeout: (message) => {
        setIsListening(false);
        setStatusMessage(message);
        showToast(message, 'info');
        parseTranscriptIntoFields(transcript, targetType);
      },
      onRecordingComplete: (res) => {
        setIsListening(false);
        if (res.transcript) {
          setTranscript(res.transcript);
          parseTranscriptIntoFields(res.transcript, targetType);
        }
      },
      onError: (err) => {
        setIsListening(false);
        setStatusMessage(err);
        showToast(err, 'error');
      },
    });

    sessionRef.current = session;
    await session.start();
  };

  const handleReprocessText = () => {
    if (!transcript.trim()) return;
    setIsProcessing(true);
    parseTranscriptIntoFields(transcript, targetType);
    setIsProcessing(false);
    setStatusMessage('اطلاعات با دقت بالا به‌روزرسانی شد');
    showToast('فیلدهای هوشمند از روی متن بروزرسانی شدند.', 'success');
  };

  const handleDirectSave = async () => {
    if (!transcript.trim() && !editableTitle.trim()) {
      showToast('لطفاً ابتدا فرمان صوتی را ضبط کنید یا مشخصات را در کادر وارد نمایید.', 'error');
      return;
    }

    const totalPriceNum = parseNumericInput(editablePriceStr) || 0;
    const areaNum = parseNumericInput(editableAreaStr) || 0;

    if (targetType === 'property') {
      const cityParts = editableCity.split('—').map((s) => s.trim());
      const created = await saveProperty({
        title: editableTitle.trim() || transcript.trim().slice(0, 48) || 'ملک ثبت صوتی',
        propertyType: transcript.includes('ویلا')
          ? 'ویلا'
          : transcript.includes('آپارتمان')
          ? 'آپارتمان'
          : transcript.includes('تجاری') || transcript.includes('مغازه')
          ? 'تجاری'
          : transcript.includes('باغ')
          ? 'باغ'
          : 'زمین',
        status: 'فعال',
        registerDate: getTodayJalali(true),
        city: cityParts[0] || '',
        district: cityParts[1] || '',
        deedType: editableDeed.trim() || 'تک‌برگ عرصه و اعیان (شش دانگ)',
        zoningStatus: transcript.includes('خارج بافت') ? 'خارج بافت' : 'داخل بافت',
        area: areaNum,
        pricePerMeter: areaNum > 0 && totalPriceNum > 0 ? Math.round(totalPriceNum / areaNum) : 0,
        totalPrice: totalPriceNum,
        negotiable: true,
        contactPartnerName: editableCollab.trim() || undefined,
        voiceTranscript: transcript.trim() || undefined,
        ownerName: editableCollab.trim() || 'ثبت صوتی',
        ownerPhone: '',
        photos: [],
        documents: [],
      });
      await refreshSnapshot();
      showToast(`ملک «${created.title}» با کد ${created.code} مستقیماً ثبت شد.`, 'success');
      runWithViewTransition(() => navigate(`/properties/${created.id}`));
    } else if (targetType === 'applicant') {
      const phoneMatch = transcript.match(/09\d{9}|۰۹[۰-۹]{9}/);
      const created = await saveApplicant({
        name: editableTitle.trim() || transcript.trim().slice(0, 36) || 'متقاضی ثبت صوتی',
        phone: phoneMatch ? phoneMatch[0] : editableCollab.trim(),
        priority: 'vip',
        gender: 'male',
        creditTier: 'عالی',
        status: 'در حال پیگیری',
        referrerId: 'voice',
        referrerLabel: 'ثبت صوتی هوشمند',
        confidentialNotes: transcript.trim() || undefined,
        dealTypes: ['خرید قطعی'],
        desiredPropertyTypes: ['زمین مسکونی'],
        cities: editableCity.split(/[،,]+/).map((s) => s.trim()).filter(Boolean),
        neighborhoods: [],
        placementTypes: [],
        minArea: areaNum,
        maxArea: areaNum > 0 ? areaNum + 100 : 0,
        minBudget: totalPriceNum > 0 ? Math.round(totalPriceNum * 0.8) : 0,
        maxBudget: totalPriceNum,
        cashPercentage: 100,
        allowBarter: false,
        desiredDeeds: editableDeed.trim() ? [editableDeed.trim()] : ['تک‌برگ'],
        desiredZonings: ['داخل بافت'],
        lastContactDate: getTodayJalali(true),
        nextFollowupDate: addDaysToJalali(getTodayJalali(true), 1, true),
      });
      await refreshSnapshot();
      showToast(`پرونده متقاضی «${created.name}» (${created.code}) ثبت شد.`, 'success');
      runWithViewTransition(() => navigate('/applicants'));
    } else if (targetType === 'collaborator') {
      const phoneMatch = transcript.match(/09\d{9}|۰۹[۰-۹]{9}/);
      const created = await saveCollaborator({
        name: editableTitle.trim() || transcript.trim().slice(0, 36) || 'همکار ثبت صوتی',
        agencyName: editableCollab.trim() || '',
        role: 'مدیر آژانس',
        phone: phoneMatch ? phoneMatch[0] : '',
        gender: 'male',
        performanceTier: 'عالی',
        primaryCity: editableCity.trim() || '',
        neighborhoods: [],
        specializations: ['زمین‌های مسکونی و شهرکی'],
        masteryBadges: [],
        commissionSplit: '50_50',
        cooperationStatus: 'همکاری فعال (VIP)',
        nextFollowupDate: addDaysToJalali(getTodayJalali(true), 3, true),
        lastContactDate: getTodayJalali(true),
        privateNotes: transcript.trim() || undefined,
        successfulDealsCount: 0,
      });
      await refreshSnapshot();
      showToast(`پرونده همکار «${created.name}» (${created.code}) ثبت شد.`, 'success');
      runWithViewTransition(() => navigate('/collaborators'));
    } else {
      await saveReminder({
        title: editableTitle.trim() || transcript.trim().slice(0, 48) || 'یادآور صوتی کلید',
        transcript: transcript.trim(),
        jalaliDate: addDaysToJalali(getTodayJalali(true), 1, true),
        time: '11:00',
        timeDisplay: '۱۱:۰۰ صبح',
        priority: 'urgent',
        categories: ['phone'],
        status: 'pending',
        customLinks: [],
        smsNotification: true,
        registerInCartable: true,
        calendarStatus: 'none',
        syncStatus: 'local',
        aiFilledFields: ['title', 'jalaliDate'],
      });
      await refreshSnapshot();
      showToast('یادآور صوتی با موفقیت در تقویم ثبت شد.', 'success');
      runWithViewTransition(() => navigate('/reminders'));
    }
  };

  const handleTransferToFullForm = () => {
    const areaNum = parseNumericInput(editableAreaStr) || 0;
    const priceNumVal = parseNumericInput(editablePriceStr) || 0;
    const ppmVal = areaNum > 0 && priceNumVal > 0 ? Math.round(priceNumVal / areaNum) : 0;

    if (targetType === 'property') {
      sessionStorage.setItem(
        'kelid_draft_property_new',
        JSON.stringify({
          title: editableTitle.trim(),
          city: editableCity.trim(),
          district: '',
          zoningStatus: 'داخل بافت',
          areaStr: editableAreaStr,
          ppmStr: ppmVal ? formatWithSeparator(ppmVal, false) : '',
          totalPriceStr: editablePriceStr,
          ownerName: '',
          ownerPhone: '',
          exactAddress: transcript.trim(),
        })
      );
    } else if (targetType === 'applicant') {
      sessionStorage.setItem(
        'kelid_draft_applicant_new',
        JSON.stringify({
          fullName: editableTitle.trim(),
          citiesInput: editableCity.trim(),
          minAreaStr: editableAreaStr,
          maxBudgetStr: editablePriceStr,
          notes: transcript.trim(),
        })
      );
    } else if (targetType === 'collaborator') {
      sessionStorage.setItem(
        'kelid_draft_collaborator_new',
        JSON.stringify({
          fullName: editableTitle.trim(),
          coveredCitiesInput: editableCity.trim(),
          agencyName: editableCollab.trim(),
          notes: transcript.trim(),
        })
      );
    } else {
      sessionStorage.setItem(
        'kelid_draft_reminder_new',
        JSON.stringify({
          title: editableTitle.trim() || transcript.trim().slice(0, 48),
          desc: transcript.trim(),
        })
      );
    }

    runWithViewTransition(() => {
      if (targetType === 'property') navigate('/properties/new');
      else if (targetType === 'applicant') navigate('/applicants/new');
      else if (targetType === 'collaborator') navigate('/collaborators/new');
      else navigate('/reminders/new');
    });
  };

  const priceNum = parseNumericInput(editablePriceStr);
  const areaNum = parseNumericInput(editableAreaStr) || 1;
  const ppmNum = Math.round(priceNum / areaNum);

  return (
    <div className="relative z-10 max-w-md mx-auto min-h-screen flex flex-col pb-40">
      {/* Sticky Header (Exact match to Image 20.html) */}
      <header className="sticky top-0 z-30 bg-[#050b18]/85 backdrop-blur-xl border-b border-white/10 px-4 pt-5 pb-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => runWithViewTransition(() => navigate(-1))}
              className="w-10 h-10 rounded-xl glass-card flex items-center justify-center border border-white/15 text-white hover:border-[#f1cb83]/50 active:scale-95 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
            <KelidLogoIcon className="w-10 h-10" />
            <div>
              <h1 className="text-lg font-extrabold text-white gold-text-glow">
                دستیار صوتی ثبت سریع
              </h1>
              <p className="text-[11px] text-slate-300 font-medium">
                تبدیل هوشمند گفتار به پرونده ساختاریافته
              </p>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/40 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[#f1cb83] text-sm">auto_awesome</span>
            <span className="text-[11px] font-extrabold text-[#f1cb83]">هوش مصنوعی فارسی</span>
          </div>
        </div>
      </header>

      <main className="px-4 pt-4 space-y-4 flex-1">
        {/* Step 1: Select Target Record Type */}
        <section className="glass-card rounded-2xl p-3.5 border border-white/15">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#f1cb83] text-base">category</span>
              ۱. نوع پرونده جهت ثبت صوتی را انتخاب کنید:
            </span>
            <span className="text-[10px] text-[#f1cb83] font-bold">تشخیص خودکار فیلدها</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                {
                  id: 'property' as const,
                  title: 'ثبت ملک جدید',
                  sub: 'زمین، ویلا، آپارتمان',
                  icon: 'add_home_work',
                },
                {
                  id: 'applicant' as const,
                  title: 'ثبت متقاضی',
                  sub: 'خریدار و سرمایه‌گذار',
                  icon: 'person_add',
                },
                {
                  id: 'collaborator' as const,
                  title: 'ثبت همکار',
                  sub: 'دفاتر و مشاورین',
                  icon: 'handshake',
                },
                {
                  id: 'reminder' as const,
                  title: 'یادآور سریع',
                  sub: 'تماس، بازدید، چک',
                  icon: 'add_alert',
                },
              ] as const
            ).map((item) => {
              const active = targetType === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTargetType(item.id);
                  }}
                  className={`py-2.5 px-2 rounded-xl flex flex-col items-center gap-1 text-center cursor-pointer transition-all ${
                    active
                      ? 'gold-pill-btn shadow-md'
                      : 'bg-white/5 border border-white/10 text-slate-300 hover:border-[#f1cb83]/40'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-xl ${
                      active ? 'text-[#050b18]' : 'text-[#f1cb83]'
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span
                    className={`text-[11px] leading-tight ${
                      active ? 'font-extrabold text-[#050b18]' : 'font-bold'
                    }`}
                  >
                    {item.title}
                  </span>
                  <span
                    className={`text-[9px] ${
                      active ? 'text-[#050b18]/80 font-bold' : 'text-slate-400'
                    }`}
                  >
                    {item.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Step 2: Interactive Voice Orb & Waveform Visualizer */}
        <section className="glass-card gold-border-glow rounded-3xl p-5 text-center relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full bg-emerald-400 ${
                  isListening ? 'animate-ping' : ''
                }`}
              />
              {statusMessage}
            </span>
            <span className="text-xs font-extrabold text-[#f1cb83] font-mono">
              ۰۰:{toPersianDigits(String(durationSeconds).padStart(2, '0'))}
            </span>
          </div>

          {/* Central Glowing Mic Button */}
          <div className="relative w-28 h-28 mx-auto my-3 flex items-center justify-center">
            {isListening && (
              <>
                <div className="absolute inset-0 rounded-full bg-[#f1cb83]/20 border border-[#f1cb83]/40 mic-ring-pulse" />
                <div
                  className="absolute inset-2 rounded-full bg-[#f1cb83]/25 border border-[#f1cb83]/50 mic-ring-pulse"
                  style={{ animationDelay: '0.6s' }}
                />
              </>
            )}
            <button
              type="button"
              onClick={handleToggleListening}
              className="relative z-10 w-20 h-20 rounded-full gold-pill-btn flex flex-col items-center justify-center shadow-[0_0_35px_rgba(241,203,131,0.6)] active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-4xl font-bold">
                {isListening ? 'graphic_eq' : 'mic'}
              </span>
            </button>
          </div>

          {/* Animated Audio Waveform Bars */}
          <div className="flex items-center justify-center gap-1.5 h-10 my-2">
            {waveformLevels.map((lvl, idx) => (
              <span
                key={idx}
                className={`w-1.5 bg-[#f1cb83] rounded-full transition-all duration-150 ${
                  isListening ? 'voice-bar' : ''
                }`}
                style={{
                  height: `${lvl > 1 ? Math.min(36, lvl) : Math.max(8, Math.round(lvl * 34))}px`,
                }}
              />
            ))}
          </div>

          <p className="text-[11px] text-slate-300 mt-1">
            مشخصات ملک، متراژ، منطقه، نوع سند و قیمت را به صورت طبیعی بیان کنید
          </p>

          <div className="flex items-center justify-center gap-3 mt-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={() => {
                setTranscript('');
                setEditablePriceStr('');
                setEditableAreaStr('');
                setEditableCity('');
                setEditableTitle('');
                setEditableDeed('');
                setEditableCollab('');
              }}
              className="px-3.5 py-1.5 rounded-xl bg-white/5 border border-white/15 text-slate-300 text-[11px] font-bold flex items-center gap-1 hover:border-white/30 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">restart_alt</span>
              <span>پاک کردن فیلدها</span>
            </button>
            <button
              type="button"
              onClick={handleToggleListening}
              className="px-4 py-1.5 rounded-xl bg-rose-500/20 border border-rose-400/40 text-rose-200 text-[11px] font-extrabold flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">
                {isListening ? 'stop_circle' : 'mic'}
              </span>
              <span>{isListening ? 'توقف و پردازش' : 'شروع ضبط صدا'}</span>
            </button>
          </div>
        </section>

        {/* Step 3: Live Speech-to-Text Transcript Box */}
        <section className="glass-card rounded-2xl p-4 border border-white/15 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#f1cb83] text-lg">subtitles</span>
              <h2 className="text-xs font-extrabold text-white">متن تشخیص داده‌شده (زنده)</h2>
            </div>
            <button
              type="button"
              onClick={handleReprocessText}
              disabled={isProcessing}
              className="text-[10px] text-[#f1cb83] flex items-center gap-1 font-bold hover:underline cursor-pointer"
            >
              <span className="material-symbols-outlined text-xs">auto_fix_high</span>
              <span>{isProcessing ? 'در حال استخراج...' : 'پردازش هوشمند متن'}</span>
            </button>
          </div>

          <div className="bg-[#080f20]/80 rounded-xl p-3 border border-[#f1cb83]/30">
            <textarea
              rows={3}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              className="w-full bg-transparent border-none outline-none text-xs text-white leading-relaxed font-medium resize-none"
            />
          </div>
        </section>

        {/* Step 4: AI Auto-Extracted Structured Preview Card */}
        <section className="glass-card gold-border-glow rounded-2xl p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-xl">fact_check</span>
              <div>
                <h2 className="text-sm font-extrabold text-white">
                  پیش‌نمایش فیلدهای استخراج‌شده خودکار
                </h2>
                <p className="text-[10px] text-slate-300">
                  فیلدها به صورت هوشمند در بخش‌های مربوطه جایگذاری شدند
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold">
              {transcript.trim() || editableTitle.trim() ? 'فیلدها استخراج شد' : 'منتظر فرمان صوتی'}
            </span>
          </div>

          {/* Extracted Fields Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-[#080f20]/70 rounded-xl p-2.5 border border-white/10 ai-shimmer-field">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">عنوان / نام پرونده</span>
                <span className="material-symbols-outlined text-emerald-400 text-xs">
                  check_circle
                </span>
              </div>
              <input
                type="text"
                value={editableTitle}
                onChange={(e) => setEditableTitle(e.target.value)}
                className="bg-transparent border-none outline-none text-xs font-extrabold text-white mt-1 w-full"
              />
            </div>

            <div className="bg-[#080f20]/70 rounded-xl p-2.5 border border-white/10 ai-shimmer-field">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">منطقه / شهرک</span>
                <span className="material-symbols-outlined text-emerald-400 text-xs">
                  check_circle
                </span>
              </div>
              <input
                type="text"
                value={editableCity}
                onChange={(e) => setEditableCity(e.target.value)}
                className="bg-transparent border-none outline-none text-xs font-extrabold text-white mt-1 w-full"
              />
            </div>

            <div className="bg-[#080f20]/70 rounded-xl p-2.5 border border-white/10 ai-shimmer-field">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">متراژ زمین (متر مربع)</span>
                <span className="material-symbols-outlined text-emerald-400 text-xs">
                  check_circle
                </span>
              </div>
              <input
                type="text"
                dir="ltr"
                value={toPersianDigits(editableAreaStr)}
                onChange={(e) => setEditableAreaStr(e.target.value)}
                className="bg-transparent border-none outline-none text-xs font-extrabold text-[#f1cb83] mt-1 w-full text-right"
              />
            </div>

            <div className="bg-[#080f20]/70 rounded-xl p-2.5 border border-white/10 ai-shimmer-field">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">وضعیت سند و جواز</span>
                <span className="material-symbols-outlined text-emerald-400 text-xs">
                  check_circle
                </span>
              </div>
              <input
                type="text"
                value={editableDeed}
                onChange={(e) => setEditableDeed(e.target.value)}
                className="bg-transparent border-none outline-none text-xs font-extrabold text-emerald-300 mt-1 w-full"
              />
            </div>

            <div className="bg-[#080f20]/70 rounded-xl p-2.5 border border-white/10 col-span-2 flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
                <span className="material-symbols-outlined text-[#f1cb83] text-lg">handshake</span>
                <div className="flex-1">
                  <span className="text-[10px] text-slate-400 block">
                    معرف / همکار ارسال‌کننده فایل
                  </span>
                  <input
                    type="text"
                    value={editableCollab}
                    onChange={(e) => setEditableCollab(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs font-extrabold text-white mt-0.5 w-full"
                  />
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-[#f1cb83]/15 border border-[#f1cb83]/40 text-[#f1cb83] text-[10px] font-bold">
                همکار متصل شد
              </span>
            </div>
          </div>

          {/* Price & Live Words Box */}
          <div className="rounded-xl bg-[#080f20]/90 border border-[#f1cb83]/45 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm text-[#f1cb83]">payments</span>
                قیمت کل (تومان):
              </span>
              <input
                type="text"
                dir="ltr"
                value={toPersianDigits(editablePriceStr)}
                onChange={(e) => setEditablePriceStr(formatWithSeparator(e.target.value, false))}
                className="bg-transparent border-none outline-none text-sm font-black text-[#f1cb83] tracking-wide text-left w-40"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] border-t border-white/10 pt-1.5">
              <span className="text-slate-400">قیمت هر متر مربع:</span>
              <span className="text-white font-bold">
                {formatWithSeparator(ppmNum, true)} تومان
              </span>
            </div>
            <div className="bg-[#f1cb83]/10 rounded-lg p-2 border border-[#f1cb83]/30 flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-base">
                spellcheck
              </span>
              <p className="text-[11px] font-extrabold text-white">
                معادل حروفی: {amountToTomanWords(priceNum)}
              </p>
            </div>
          </div>

          {/* Missing Fields Hint */}
          <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-300 text-base">info</span>
              <p className="text-[11px] text-amber-200 font-medium">
                موارد تکمیلی پیشنهادی: نام مالک، شماره تماس و لوکیشن نقشه
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleListening}
              className="text-[10px] text-[#f1cb83] font-extrabold underline shrink-0 cursor-pointer"
            >
              + افزودن صوتی
            </button>
          </div>
        </section>
      </main>

      {/* Fixed Bottom Action Bar (Exact match to Image 20.html) */}
      <div className="fixed bottom-16 left-0 right-0 z-40 px-4 pb-3 pt-2 bg-gradient-to-t from-[#050b18] via-[#050b18]/95 to-transparent">
        <div className="max-w-md mx-auto glass-card rounded-2xl p-2.5 border border-[#f1cb83]/40 shadow-2xl space-y-2">
          <button
            type="button"
            onClick={handleDirectSave}
            className="w-full gold-pill-btn py-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 active:scale-98 transition-transform cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">check_circle</span>
            <span>تایید و ذخیره مستقیم پرونده</span>
          </button>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleTransferToFullForm}
              className="col-span-2 py-2.5 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/50 text-[#f1cb83] text-xs font-extrabold flex items-center justify-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">edit_document</span>
              <span>انتقال به فرم کامل (تکمیل جزئیات)</span>
            </button>
            <button
              type="button"
              onClick={handleToggleListening}
              className="col-span-1 py-2.5 rounded-xl bg-white/5 border border-white/15 text-slate-300 text-xs font-bold flex items-center justify-center gap-1 active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
              <span>ضبط مجدد</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
