import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { JalaliDatePickerModal } from '../components/JalaliDatePickerModal';
import { KelidLogoIcon } from '../components/Layout';
import { completeReminderWithResult, saveReminder } from '../db/repositories';
import { db, ReminderCategory, ReminderRecord } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { runWithViewTransition } from '../motion';
import { aiService } from '../services/ai';
import {
  createOrUpdateGoogleCalendarEvent,
  exportReminderAsIcs,
} from '../services/calendar';
import { triggerPhoneCall } from '../services/maps';
import { VoiceSessionController } from '../services/voice';
import {
  addDaysToJalali,
  getTodayJalali,
  isJalaliDateOverdue,
  toPersianDigits,
} from '../utils/persian';

export const RemindersScreen: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    snapshot,
    currentUser,
    inboxInitialTab,
    setInboxInitialTab,
    highlightedReminderId,
    setHighlightedReminderId,
    refreshSnapshot,
    showToast,
    askPermission,
  } = useApp();

  const isViewer = currentUser.role === 'بیننده';
  const reminders = snapshot?.reminders || [];
  const applicants = snapshot?.applicants || [];
  const properties = snapshot?.properties || [];
  const collaborators = snapshot?.collaborators || [];
  const matchLinks = snapshot?.matchLinks || [];

  const [activeTab, setActiveTab] = useState<string>(inboxInitialTab || 'today');
  const [selectedDayOffset, setSelectedDayOffset] = useState<number>(0);
  const [voiceQuickInput, setVoiceQuickInput] = useState('');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);

  const [isFullCalendarOpen, setIsFullCalendarOpen] = useState(false);
  const [rescheduleReminder, setRescheduleReminder] = useState<ReminderRecord | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  // New Reminder Modal State
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDate, setNewDate] = useState(getTodayJalali(true));
  const [newTime, setNewTime] = useState('11:00');
  const [newCategory, setNewCategory] = useState<ReminderCategory>('phone');
  const [newPriority, setNewPriority] = useState<'urgent' | 'normal' | 'low'>('normal');
  const [newLinkedApplicantId, setNewLinkedApplicantId] = useState('');
  const [newLinkedPropertyId, setNewLinkedPropertyId] = useState('');
  const [newLinkedCollaboratorId, setNewLinkedCollaboratorId] = useState('');
  const [isNewDatePickerOpen, setIsNewDatePickerOpen] = useState(false);

  const voiceRef = useRef<VoiceSessionController | null>(null);

  useEffect(() => {
    if (inboxInitialTab) {
      setActiveTab(inboxInitialTab);
    }
  }, [inboxInitialTab]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const appId = params.get('newForApplicant');
    const colId = params.get('newForCollaborator');
    const propId = params.get('newForProperty');

    if (location.pathname === '/reminders/new' || appId || colId || propId) {
      if (appId) {
        const app = applicants.find((a) => a.id === appId);
        if (app) {
          setNewTitle(`تماس و پیگیری متقاضی — ${app.name}`);
          setNewDesc(`معرفی فایل‌های منتخب منطبق با بودجه متقاضی (${app.code})`);
          setNewLinkedApplicantId(app.id);
          setNewCategory('phone');
        }
      } else if (colId) {
        const col = collaborators.find((c) => c.id === colId);
        if (col) {
          setNewTitle(`استعلام فایل جدید — ${col.name}`);
          setNewDesc(`پیگیری فایل‌های مشترک از ${col.agencyName || col.role} (${col.code})`);
          setNewLinkedCollaboratorId(col.id);
          setNewCategory('phone');
        }
      } else if (propId) {
        const prop = properties.find((p) => p.id === propId);
        if (prop) {
          setNewTitle(`هماهنگی بازدید ملک — ${prop.title}`);
          setNewDesc(`پیگیری وضعیت و بازدید ملک کد ${prop.code}`);
          setNewLinkedPropertyId(prop.id);
          setNewCategory('visit');
        }
      }
      setIsNewModalOpen(true);
    }
  }, [location.pathname, location.search, applicants, collaborators, properties]);

  const todayJalali = getTodayJalali(true);

  const weekStrip = useMemo(() => {
    const dayLabels = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
    return [-3, -2, -1, 0, 1, 2, 3].map((offset, idx) => {
      const dateStr = addDaysToJalali(todayJalali, offset, true);
      const dayNumber = dateStr.split('/')[2] || '۲۶';
      const dayReminders = reminders.filter(
        (r) => r.jalaliDate === dateStr && r.status !== 'done'
      );
      const hasOverdue = dayReminders.some((r) => isJalaliDateOverdue(r.jalaliDate));
      return {
        offset,
        label: dayLabels[idx],
        dateStr,
        dayNumber,
        count: dayReminders.length,
        hasOverdue,
      };
    });
  }, [todayJalali, reminders]);

  const overdueReminders = useMemo(
    () =>
      reminders.filter(
        (r) => r.status !== 'done' && isJalaliDateOverdue(r.jalaliDate)
      ),
    [reminders]
  );

  const todayReminders = useMemo(() => {
    const targetDate = addDaysToJalali(todayJalali, selectedDayOffset, true);
    return reminders.filter(
      (r) =>
        r.status !== 'done' &&
        (r.jalaliDate === targetDate ||
          (!isJalaliDateOverdue(r.jalaliDate) && selectedDayOffset === 0))
    );
  }, [reminders, todayJalali, selectedDayOffset]);

  const filteredList = useMemo(() => {
    if (activeTab === 'overdue') {
      return overdueReminders;
    }
    if (activeTab === 'calls') {
      return reminders.filter((r) => r.status !== 'done' && r.categories.includes('phone'));
    }
    if (activeTab === 'visits') {
      return reminders.filter((r) => r.status !== 'done' && r.categories.includes('visit'));
    }
    if (activeTab === 'checks_contracts') {
      return reminders.filter((r) => r.status !== 'done' && r.categories.includes('finance'));
    }
    if (activeTab === 'done') {
      return reminders.filter((r) => r.status === 'done');
    }
    return todayReminders;
  }, [activeTab, overdueReminders, reminders, todayReminders]);

  const getLinkedLabel = (rem: ReminderRecord) => {
    if (rem.linkedApplicantId) {
      const a = applicants.find((x) => x.id === rem.linkedApplicantId);
      if (a) return `متقاضی: ${a.name} (${a.code})`;
    }
    if (rem.linkedPropertyId) {
      const p = properties.find((x) => x.id === rem.linkedPropertyId);
      if (p) return `ملک: ${p.title} (${p.code})`;
    }
    if (rem.linkedCollaboratorId) {
      const c = collaborators.find((x) => x.id === rem.linkedCollaboratorId);
      if (c) return `همکار: ${c.name} (${c.code})`;
    }
    return rem.customLinks[0];
  };

  const handleVoiceReminderExtract = async (inputText?: string) => {
    const textToParse = (inputText ?? voiceQuickInput).trim();
    if (!textToParse) {
      if (isVoiceActive) {
        voiceRef.current?.stop();
        setIsVoiceActive(false);
        return;
      }
      const allowed = await askPermission('microphone');
      if (!allowed) return;
      setIsVoiceActive(true);
      const session = new VoiceSessionController({
        onLiveTranscript: (t) => setVoiceQuickInput(t),
        onSilenceTimeout: (msg) => {
          setIsVoiceActive(false);
          showToast(msg, 'info');
        },
        onRecordingComplete: async (res) => {
          setIsVoiceActive(false);
          if (res.transcript.trim()) {
            await handleVoiceReminderExtract(res.transcript);
          }
        },
        onError: (err) => {
          setIsVoiceActive(false);
          showToast(err, 'error');
        },
      });
      voiceRef.current = session;
      await session.start();
      return;
    }

    setIsProcessingVoice(true);
    try {
      const knownEntities = [
        ...applicants.map((a) => ({ code: a.code, name: a.name })),
        ...properties.map((p) => ({ code: p.code, name: p.title })),
        ...collaborators.map((c) => ({ code: c.code, name: c.name })),
      ];
      const extracted = await aiService.extractReminderFromTranscript(
        textToParse,
        knownEntities
      );

      await saveReminder({
        title: extracted.title,
        transcript: textToParse,
        jalaliDate: extracted.jalaliDate || addDaysToJalali(todayJalali, 1, true),
        time: extracted.time || '11:00',
        timeDisplay: extracted.timeDisplay || '۱۱:۰۰ صبح',
        priority: extracted.priority || 'normal',
        categories: extracted.categories.length ? extracted.categories : ['phone'],
        status: 'pending',
        customLinks: extracted.matchedCodes,
        smsNotification: true,
        registerInCartable: true,
        calendarStatus: 'none',
        syncStatus: 'local',
        aiFilledFields: ['title', 'jalaliDate', 'time'],
        aiSummary: extracted.summary,
      });

      setVoiceQuickInput('');
      await refreshSnapshot();
      showToast(`یادآور هوشمند «${extracted.title}» ثبت شد.`, 'success');
    } finally {
      setIsProcessingVoice(false);
    }
  };

  const handleSaveManualReminder = async () => {
    if (!newTitle.trim()) {
      showToast('لطفاً عنوان یادآور را وارد کنید.', 'error');
      return;
    }

    await saveReminder({
      title: newTitle.trim(),
      transcript: newDesc.trim() || 'ثبت شده در تقویم هوشمند کلید',
      jalaliDate: newDate,
      time: newTime,
      timeDisplay: `${toPersianDigits(newTime)}`,
      priority: newPriority,
      categories: [newCategory],
      status: 'pending',
      linkedApplicantId: newLinkedApplicantId || undefined,
      linkedPropertyId: newLinkedPropertyId || undefined,
      linkedCollaboratorId: newLinkedCollaboratorId || undefined,
      customLinks: [],
      smsNotification: true,
      registerInCartable: true,
      calendarStatus: 'none',
      syncStatus: 'local',
      aiFilledFields: [],
    });

    await refreshSnapshot();
    setIsNewModalOpen(false);
    setNewTitle('');
    setNewDesc('');
    showToast('یادآور جدید با موفقیت در تقویم ثبت شد.', 'success');
    if (location.pathname === '/reminders/new' || location.search) {
      navigate('/reminders', { replace: true });
    }
  };

  const handleMarkDone = async (rem: ReminderRecord) => {
    await completeReminderWithResult(rem.id, 'موفق');
    await refreshSnapshot();
    showToast(`یادآور «${rem.title}» انجام شد.`, 'success');
  };

  const handleSnoozeOneDay = async (rem: ReminderRecord) => {
    const nextDay = addDaysToJalali(getTodayJalali(true), 1, true);
    await saveReminder({
      ...rem,
      jalaliDate: nextDay,
    });
    await refreshSnapshot();
    showToast(`یادآور «${rem.title}» به فردا (${toPersianDigits(nextDay)}) منتقل شد.`, 'info');
  };

  const handleReschedule = async (newDueDate: string) => {
    if (!rescheduleReminder) return;
    await saveReminder({
      ...rescheduleReminder,
      jalaliDate: newDueDate,
      status: 'pending',
    });
    await refreshSnapshot();
    setRescheduleReminder(null);
    showToast(`تاریخ یادآور به ${toPersianDigits(newDueDate)} تغییر یافت.`, 'success');
  };

  const handleSyncToGoogleCalendar = async (rem: ReminderRecord) => {
    const allowed = await askPermission('calendar', {
      title: rem.title,
      dateLabel: toPersianDigits(rem.jalaliDate),
      timeLabel: toPersianDigits(rem.time),
    });
    if (!allowed) return;

    const result = await createOrUpdateGoogleCalendarEvent(rem);
    await saveReminder({
      ...rem,
      calendarStatus: result.status,
      calendarEventId: result.eventId,
    });
    await refreshSnapshot();

    if (result.status === 'ics_exported') {
      showToast('فایل رویداد تقویم (.ics) برای آلارم گوشی دانلود شد.', 'success');
    } else {
      showToast('رویداد با موفقیت در تقویم گوگل (Google Calendar) ثبت شد.', 'success');
    }
  };

  const handleCallLinkedPhone = (rem: ReminderRecord) => {
    if (rem.linkedApplicantId) {
      const app = applicants.find((a) => a.id === rem.linkedApplicantId);
      if (app) {
        triggerPhoneCall(app.phone);
        return;
      }
    }
    if (rem.linkedCollaboratorId) {
      const col = collaborators.find((c) => c.id === rem.linkedCollaboratorId);
      if (col) {
        triggerPhoneCall(col.phone);
        return;
      }
    }
    if (rem.linkedPropertyId) {
      const prop = properties.find((p) => p.id === rem.linkedPropertyId);
      if (prop?.ownerPhone) {
        if (currentUser.role !== 'مدیر') {
          showToast('شماره تماس مالک محرمانه و مختص مدیر ارشد است.', 'error');
          return;
        }
        triggerPhoneCall(prop.ownerPhone);
        return;
      }
    }
    showToast('شماره تماسی برای این یادآور ثبت نشده است.', 'info');
  };

  const handleNavigateLinkedEntity = (rem: ReminderRecord) => {
    runWithViewTransition(() => {
      if (rem.linkedPropertyId) {
        navigate(`/properties/${rem.linkedPropertyId}`);
      } else if (rem.linkedApplicantId) {
        navigate(isViewer ? '/applicants' : `/applicants/${rem.linkedApplicantId}/edit`);
      } else if (rem.linkedCollaboratorId) {
        navigate(isViewer ? '/collaborators' : `/collaborators/${rem.linkedCollaboratorId}/edit`);
      }
    });
  };

  return (
    <div className="relative z-10 max-w-md mx-auto min-h-screen flex flex-col pb-28">
      {/* Header Section (Exact match to Image 18.html) */}
      <header className="pt-5 px-4 pb-3 sticky top-0 z-30 bg-[#050b18]/85 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center">
              <KelidLogoIcon className="w-10 h-10" />
              {overdueReminders.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-rose-500 border-2 border-[#050b18] animate-ping" />
              )}
              {overdueReminders.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-rose-500 border-2 border-[#050b18]" />
              )}
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-white tracking-tight gold-text-glow">
                یادآورها و پیگیری‌های هوشمند
              </h1>
              <p className="text-[11px] text-slate-300 font-medium">
                تقویم، آلارم و صندوق پیام‌های سیستمی
              </p>
            </div>
          </div>

          {!isViewer && (
            <button
              type="button"
              onClick={() => setIsNewModalOpen(true)}
              className="gold-pill-btn px-3.5 py-2 rounded-xl flex items-center gap-1.5 text-xs font-extrabold active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-base font-bold">add_alert</span>
              <span>یادآور جدید</span>
            </button>
          )}
        </div>

        {/* Interactive Jalali Calendar & Alarm Sync Strip */}
        <div className="glass-card rounded-2xl p-3 mb-3 border border-[#f1cb83]/30">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#f1cb83] text-lg">
                calendar_month
              </span>
              <span className="text-xs font-extrabold text-white">
                امروز: {toPersianDigits(todayJalali)}
              </span>
              <button
                type="button"
                onClick={() => setIsFullCalendarOpen(true)}
                className="text-[10px] text-[#f1cb83] bg-[#f1cb83]/15 px-2 py-0.5 rounded-md border border-[#f1cb83]/30 hover:bg-[#f1cb83]/25 transition-colors cursor-pointer"
              >
                تقویم کامل
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">alarm_on</span>
                همگام با آلارم گوشی
              </span>
            </div>
          </div>

          {/* 7-Day Horizontal Strip */}
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {weekStrip.map((day) => {
              const isSelected = selectedDayOffset === day.offset;
              return (
                <button
                  key={day.dateStr}
                  type="button"
                  onClick={() => setSelectedDayOffset(day.offset)}
                  className={`py-1.5 rounded-xl flex flex-col items-center cursor-pointer transition-all ${
                    isSelected
                      ? 'gold-pill-btn shadow-md scale-105'
                      : 'bg-white/5 border border-white/10 text-slate-300 hover:border-[#f1cb83]/40'
                  }`}
                >
                  <span className={`text-[10px] ${isSelected ? 'font-bold text-[#050b18]' : ''}`}>
                    {day.label}
                  </span>
                  <span
                    className={`text-xs mt-0.5 ${
                      isSelected ? 'font-black text-[#050b18]' : 'font-bold text-white'
                    }`}
                  >
                    {toPersianDigits(day.dayNumber)}
                  </span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full mt-1 ${
                      isSelected
                        ? 'bg-[#050b18]'
                        : day.hasOverdue
                        ? 'bg-rose-400'
                        : day.count > 0
                        ? 'bg-[#f1cb83]'
                        : 'bg-transparent'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Voice Reminder Input Bar */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 glass-input rounded-xl px-3 py-2 flex items-center gap-2 border border-white/15 focus-within:border-[#f1cb83]/60">
            <span className="material-symbols-outlined text-[#f1cb83] text-lg">
              record_voice_over
            </span>
            <input
              type="text"
              value={voiceQuickInput}
              onChange={(e) => setVoiceQuickInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleVoiceReminderExtract();
              }}
              placeholder="یادآور صوتی: «فردا ساعت ۱۱ تماس با رضایی برای زمین کلارآباد...»"
              className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
            />
            <button
              type="button"
              disabled={isProcessingVoice}
              onClick={() => handleVoiceReminderExtract()}
              className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer ${
                isVoiceActive
                  ? 'bg-rose-500 text-white border-rose-400 animate-pulse'
                  : 'bg-[#f1cb83]/20 border-[#f1cb83]/40 text-[#f1cb83]'
              }`}
            >
              <span className="material-symbols-outlined text-base">
                {voiceQuickInput.trim() ? 'send' : 'mic'}
              </span>
            </button>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {[
            { id: 'today', label: `امروز (${toPersianDigits(todayReminders.length)})` },
            {
              id: 'overdue',
              label: `معوقه (${toPersianDigits(overdueReminders.length)})`,
              isDanger: true,
            },
            { id: 'calls', label: 'تماس‌ها' },
            { id: 'visits', label: 'بازدید حضوری' },
            { id: 'checks_contracts', label: 'چک و قرارداد' },
            {
              id: 'smart_matches',
              label: `تطبیق‌های هوشمند (${toPersianDigits(matchLinks.length)})`,
            },
            { id: 'done', label: 'انجام‌شده' },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setInboxInitialTab(tab.id);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all cursor-pointer flex items-center gap-1 ${
                  active
                    ? 'gold-pill-btn font-extrabold shadow-sm'
                    : tab.isDanger
                    ? 'glass-card text-rose-300 border border-rose-500/40'
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

      {/* Main Content */}
      <main className="px-4 pt-4 space-y-4 flex-1">
        {/* Section 1: Overdue / Urgent Alerts */}
        {(activeTab === 'today' || activeTab === 'overdue') && overdueReminders.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-rose-400 text-lg">warning</span>
                <h2 className="text-xs font-extrabold text-rose-300">
                  هشدارهای معوقه و فوری (نیاز به اقدام سریع)
                </h2>
              </div>
              <span className="text-[10px] text-rose-300 bg-rose-500/15 px-2 py-0.5 rounded-md border border-rose-400/30 font-bold">
                {toPersianDigits(overdueReminders.length)} مورد عقب‌افتاده
              </span>
            </div>

            {overdueReminders.map((rem) => {
              const isHighlighted = highlightedReminderId === rem.id;
              const linkedLabel = getLinkedLabel(rem);
              return (
                <article
                  key={rem.id}
                  onClick={() => setHighlightedReminderId(null)}
                  className={`glass-card rounded-2xl p-4 relative overflow-hidden border ${
                    isHighlighted
                      ? 'border-[#f1cb83] shadow-[0_0_25px_rgba(241,203,131,0.35)]'
                      : 'border-rose-500/40 shadow-[0_10px_30px_rgba(244,63,94,0.12)]'
                  }`}
                >
                  <div className="absolute top-0 left-0 bg-rose-500/25 border-b border-r border-rose-400/40 px-2.5 py-0.5 rounded-br-xl flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                    <span className="text-[10px] font-bold text-rose-200">
                      معوقه ({toPersianDigits(rem.jalaliDate)} • {toPersianDigits(rem.time)})
                    </span>
                  </div>

                  <div className="flex items-start gap-3 mb-3 pt-2">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-rose-300 text-xl">
                        phone_missed
                      </span>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-extrabold text-white">{rem.title}</h3>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        {rem.transcript}
                      </p>
                    </div>
                  </div>

                  {linkedLabel && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <button
                        type="button"
                        onClick={() => handleNavigateLinkedEntity(rem)}
                        className="px-2.5 py-1 rounded-lg bg-[#080f20]/80 border border-[#f1cb83]/30 text-[11px] text-[#f1cb83] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-xs">link</span>
                        {linkedLabel}
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => handleCallLinkedPhone(rem)}
                      className="py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 flex items-center justify-center gap-1 text-xs font-extrabold active:scale-95 transition-transform cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">call</span>
                      <span>تماس فوری</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSnoozeOneDay(rem)}
                      className="py-2 rounded-xl bg-amber-500/15 border border-amber-400/30 text-amber-300 flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">snooze</span>
                      <span>تعویق (۱+ روز)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMarkDone(rem)}
                      className="py-2 rounded-xl bg-white/10 border border-white/20 text-white flex items-center justify-center gap-1 text-xs font-bold active:scale-95 transition-transform cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm text-emerald-400">
                        check_circle
                      </span>
                      <span>انجام شد</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Section 2: Scheduled Reminders List */}
        {activeTab !== 'smart_matches' && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#f1cb83] text-lg">
                  event_upcoming
                </span>
                <h2 className="text-xs font-extrabold text-white">
                  {activeTab === 'done'
                    ? 'یادآورهای انجام‌شده'
                    : `برنامه پیگیری‌های انتخابی (${toPersianDigits(
                        addDaysToJalali(todayJalali, selectedDayOffset, true)
                      )})`}
                </h2>
              </div>
              <span className="text-[10px] text-[#f1cb83] bg-[#f1cb83]/15 px-2 py-0.5 rounded-md border border-[#f1cb83]/30 font-bold">
                آلارم فعال
              </span>
            </div>

            {filteredList.length === 0 ? (
              <div className="glass-card rounded-2xl p-6 text-center border border-white/10">
                <div className="mb-1 flex justify-center">
                  <KelidLogoIcon className="w-12 h-12" />
                </div>
                <p className="text-xs font-bold text-slate-300">
                  در این بخش یادآور فعالی وجود ندارد.
                </p>
              </div>
            ) : (
              filteredList.map((rem) => {
                const isHighlighted = highlightedReminderId === rem.id;
                const linkedLabel = getLinkedLabel(rem);
                const categoryIcon = rem.categories.includes('visit')
                  ? 'tour'
                  : rem.categories.includes('finance')
                  ? 'payments'
                  : 'phone_callback';

                return (
                  <article
                    key={rem.id}
                    className={`glass-card gold-border-glow rounded-2xl p-4 relative overflow-hidden ${
                      isHighlighted ? 'ring-2 ring-[#f1cb83]' : ''
                    }`}
                  >
                    <div className="absolute top-0 left-0 bg-[#f1cb83]/20 border-b border-r border-[#f1cb83]/40 px-2.5 py-0.5 rounded-br-xl flex items-center gap-1">
                      <span className="material-symbols-outlined text-[#f1cb83] text-xs">
                        alarm
                      </span>
                      <span className="text-[10px] font-bold text-[#f1cb83]">
                        {toPersianDigits(rem.jalaliDate)} • ساعت {toPersianDigits(rem.time)}
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-2 mb-3 pt-2">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/40 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[#f1cb83] text-xl">
                            {categoryIcon}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] font-bold">
                              {rem.priority === 'urgent' ? 'فوری' : 'مهم'}
                            </span>
                            <h3 className="text-sm font-extrabold text-white">{rem.title}</h3>
                          </div>
                          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                            {rem.transcript}
                          </p>
                        </div>
                      </div>
                    </div>

                    {linkedLabel && (
                      <div className="bg-[#080f20]/70 rounded-xl p-2.5 border border-white/10 mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[11px] text-slate-200">
                          <span className="material-symbols-outlined text-sm text-[#f1cb83]">
                            folder_special
                          </span>
                          <span>{linkedLabel}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleNavigateLinkedEntity(rem)}
                          className="text-[10px] text-[#f1cb83] font-bold hover:underline cursor-pointer"
                        >
                          مشاهده پرونده
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2.5 border-t border-white/10 gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSyncToGoogleCalendar(rem)}
                          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
                            rem.calendarStatus === 'added'
                              ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                              : 'bg-[#f1cb83]/15 border border-[#f1cb83]/40 text-[#f1cb83]'
                          }`}
                        >
                          <span className="material-symbols-outlined text-xs">
                            {rem.calendarStatus === 'added'
                              ? 'event_available'
                              : 'calendar_add_on'}
                          </span>
                          <span>
                            {rem.calendarStatus === 'added'
                              ? 'ثبت‌شده در تقویم گوگل'
                              : 'ثبت در تقویم گوگل / آلارم'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => exportReminderAsIcs(rem)}
                          title="دانلود فایل تقویم (.ics)"
                          className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">download</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setRescheduleReminder(rem)}
                          className="px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/15 text-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-xs text-[#f1cb83]">
                            edit_calendar
                          </span>
                          <span>تغییر زمان</span>
                        </button>
                        {rem.status !== 'done' && (
                          <button
                            type="button"
                            onClick={() => handleMarkDone(rem)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-extrabold flex items-center gap-1 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-xs">check</span>
                            <span>انجام شد</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        )}

        {/* Section 3: System Inbox & Smart Match Notifications */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#f1cb83] text-lg">auto_awesome</span>
              <h2 className="text-xs font-extrabold text-white">
                صندوق پیام‌ها و تطبیق‌های هوشمند سیستم
              </h2>
            </div>
          </div>

          {matchLinks
            .filter((m) => !m.dismissed)
            .slice(0, 5)
            .map((m) => {
              const prop = properties.find((p) => p.id === m.propertyId);
              const app = applicants.find((a) => a.id === m.applicantId);
              if (!prop || !app) return null;

              return (
                <article
                  key={m.id}
                  className="glass-card rounded-2xl p-4 relative overflow-hidden border border-[#f1cb83]/45 bg-gradient-to-l from-[#f1cb83]/15 via-[#0c162d]/85 to-[#0c162d]/85"
                >
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl bg-[#f1cb83]/20 border border-[#f1cb83]/50 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[#f1cb83] text-lg">
                          bolt
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-full bg-[#f1cb83] text-[#050b18] text-[9px] font-black">
                            جدید
                          </span>
                          <h3 className="text-xs font-extrabold text-white">
                            تطبیق هوشمند بالای ۷۰٪ کشف شد!
                          </h3>
                        </div>
                        <p className="text-[10px] text-[#f1cb83] font-semibold mt-0.5">
                          امتیاز تطبیق: {toPersianDigits(m.score)}٪ • تطابق منطقه، متراژ و بودجه
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-200 leading-relaxed mb-3 bg-[#080f20]/60 p-2.5 rounded-xl border border-white/10">
                    ملک جدید <span className="text-[#f1cb83] font-bold">«{prop.title}»</span> با
                    درخواست خرید{' '}
                    <span className="text-emerald-300 font-bold">
                      «{app.name} (کد {app.code})»
                    </span>{' '}
                    همخوانی کامل دارد.
                  </p>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        runWithViewTransition(() => navigate(`/properties/${prop.id}`))
                      }
                      className="flex-1 gold-pill-btn py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">send</span>
                      <span>مشاهده و ارسال به مشتری</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await db.matchLinks.update(m.id, { dismissed: true });
                        await refreshSnapshot();
                        showToast('تطبیق رد شد.', 'info');
                      }}
                      className="px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-slate-300 text-xs font-bold cursor-pointer"
                    >
                      رد کردن
                    </button>
                  </div>
                </article>
              );
            })}
        </div>
      </main>

      {/* New Reminder Modal */}
      {isNewModalOpen && (
        <div
          onClick={() => setIsNewModalOpen(false)}
          className="fixed inset-0 z-50 bg-[#050a16]/80 backdrop-blur-xl flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sheet-enter-up w-full max-w-md rounded-3xl p-5 bg-[#0c1326]/95 border border-[#f1cb83]/40 shadow-2xl space-y-3.5"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#f1cb83]">add_alert</span>
                ثبت یادآور و آلارم جدید
              </h3>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1">
                  عنوان یادآور <span className="text-[#f1cb83]">*</span>
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="مثال: تماس با امیرحسین رضایی جهت بازدید زمین کلارآباد"
                  className="w-full glass-input rounded-xl px-3 py-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1">توضیحات</label>
                <textarea
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="جزئیات تماس، مبلغ چک یا آدرس قرار بازدید..."
                  className="w-full glass-input rounded-xl p-2.5 text-xs text-white resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-1">تاریخ شمسی</label>
                  <button
                    type="button"
                    onClick={() => setIsNewDatePickerOpen(true)}
                    className="w-full glass-input rounded-xl px-3 py-2.5 flex items-center justify-between text-xs text-white font-bold cursor-pointer"
                  >
                    <span>{toPersianDigits(newDate)}</span>
                    <span className="material-symbols-outlined text-[#f1cb83] text-base">
                      calendar_month
                    </span>
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-1">ساعت آلارم</label>
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full glass-input rounded-xl px-3 py-2 text-xs text-white font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-1">دسته‌بندی</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as ReminderCategory)}
                    className="w-full glass-input rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="phone" className="bg-[#080f20]">
                      تماس تلفنی
                    </option>
                    <option value="visit" className="bg-[#080f20]">
                      بازدید حضوری
                    </option>
                    <option value="finance" className="bg-[#080f20]">
                      چک و قرارداد
                    </option>
                    <option value="inquiry" className="bg-[#080f20]">
                      استعلام ثبتی
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-1">سطح اولویت</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as typeof newPriority)}
                    className="w-full glass-input rounded-xl px-3 py-2 text-xs text-[#f1cb83] font-bold"
                  >
                    <option value="urgent" className="bg-[#080f20]">
                      فوری
                    </option>
                    <option value="normal" className="bg-[#080f20]">
                      مهم / عادی
                    </option>
                    <option value="low" className="bg-[#080f20]">
                      کم‌اولویت
                    </option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1">
                  اتصال به پرونده متقاضی (اختیاری)
                </label>
                <select
                  value={newLinkedApplicantId}
                  onChange={(e) => setNewLinkedApplicantId(e.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="" className="bg-[#080f20]">
                    بدون اتصال به متقاضی
                  </option>
                  {applicants.map((a) => (
                    <option key={a.id} value={a.id} className="bg-[#080f20]">
                      {a.name} ({a.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleSaveManualReminder}
                className="flex-1 gold-pill-btn py-3 rounded-xl text-xs font-extrabold cursor-pointer"
              >
                ثبت و فعال‌سازی یادآور
              </button>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="px-4 py-3 rounded-xl bg-white/10 text-xs font-bold text-slate-300 cursor-pointer"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {isFullCalendarOpen && (
        <JalaliDatePickerModal
          initialValue={todayJalali}
          title="تقویم جامع شمسی کلید"
          onClose={() => setIsFullCalendarOpen(false)}
          onSelect={(d) => {
            setIsFullCalendarOpen(false);
            setIsNewModalOpen(true);
            setNewDate(d);
          }}
        />
      )}

      {rescheduleReminder && (
        <JalaliDatePickerModal
          initialValue={rescheduleReminder.jalaliDate}
          title="تغییر تاریخ یادآور"
          onClose={() => setRescheduleReminder(null)}
          onSelect={(d) => handleReschedule(d)}
        />
      )}

      {isNewDatePickerOpen && (
        <JalaliDatePickerModal
          initialValue={newDate}
          title="انتخاب تاریخ یادآور جدید"
          onClose={() => setIsNewDatePickerOpen(false)}
          onSelect={(d) => {
            setNewDate(d);
            setIsNewDatePickerOpen(false);
          }}
        />
      )}
    </div>
  );
};
