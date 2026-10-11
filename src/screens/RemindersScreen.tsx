import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { JalaliDatePickerModal } from '../components/JalaliDatePickerModal';
import { KelidLogoIcon } from '../components/Layout';
import { SmartVoiceReminderSheet } from '../components/SmartVoiceReminderSheet';
import {
  completeReminderWithResult,
  deleteReminder,
  getMediaBlobUrl,
  saveReminder,
} from '../db/repositories';
import { db, ReminderRecord } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { runWithViewTransition } from '../motion';
import {
  createOrUpdateGoogleCalendarEvent,
  exportReminderAsIcs,
} from '../services/calendar';
import { triggerPhoneCall } from '../services/maps';
import {
  addDaysToJalali,
  compareJalaliDates,
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
    askConfirm,
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

  const [isFullCalendarOpen, setIsFullCalendarOpen] = useState(false);
  const [rescheduleReminder, setRescheduleReminder] = useState<ReminderRecord | null>(null);

  // Smart Voice Reminder Bottom Sheet State
  const [isVoiceSheetOpen, setIsVoiceSheetOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<ReminderRecord | null>(null);
  const [preselectedPropertyId, setPreselectedPropertyId] = useState<string | undefined>(undefined);
  const [preselectedApplicantId, setPreselectedApplicantId] = useState<string | undefined>(
    undefined
  );
  const [preselectedCollaboratorId, setPreselectedCollaboratorId] = useState<string | undefined>(
    undefined
  );
  const [sheetInitialTranscript, setSheetInitialTranscript] = useState<string | undefined>(
    undefined
  );

  // Card Audio Player State
  const [playingReminderId, setPlayingReminderId] = useState<string | null>(null);
  const cardAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (inboxInitialTab) {
      setActiveTab(inboxInitialTab);
    }
  }, [inboxInitialTab]);

  useEffect(() => {
    return () => {
      if (cardAudioRef.current) {
        cardAudioRef.current.pause();
        cardAudioRef.current = null;
      }
    };
  }, []);

  // Open sheet automatically when routed to /reminders/new or with query params
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const appId = params.get('newForApplicant') || undefined;
    const colId = params.get('newForCollaborator') || undefined;
    const propId = params.get('newForProperty') || undefined;

    if (location.pathname === '/reminders/new' || appId || colId || propId) {
      setEditingReminder(null);
      setPreselectedApplicantId(appId);
      setPreselectedCollaboratorId(colId);
      setPreselectedPropertyId(propId);
      setSheetInitialTranscript(undefined);
      setIsVoiceSheetOpen(true);
    }
  }, [location.pathname, location.search]);

  // Smooth scroll to highlighted reminder when redirected from Success View
  useEffect(() => {
    if (!highlightedReminderId) return;
    const el = document.getElementById(`reminder-card-${highlightedReminderId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedReminderId, reminders]);

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

  const sortRemindersByPriorityAndTime = (list: ReminderRecord[]) => {
    const prioWeight: Record<string, number> = { urgent: 0, normal: 1, low: 2 };
    return [...list].sort((a, b) => {
      const dateCmp = compareJalaliDates(a.jalaliDate, b.jalaliDate);
      if (dateCmp !== 0) return dateCmp;
      const pwA = prioWeight[a.priority] ?? 1;
      const pwB = prioWeight[b.priority] ?? 1;
      if (pwA !== pwB) return pwA - pwB;
      return (a.time || '').localeCompare(b.time || '');
    });
  };

  const overdueReminders = useMemo(
    () =>
      sortRemindersByPriorityAndTime(
        reminders.filter(
          (r) => r.status !== 'done' && isJalaliDateOverdue(r.jalaliDate)
        )
      ),
    [reminders]
  );

  const todayReminders = useMemo(() => {
    const targetDate = addDaysToJalali(todayJalali, selectedDayOffset, true);
    return sortRemindersByPriorityAndTime(
      reminders.filter(
        (r) =>
          r.status !== 'done' &&
          (r.jalaliDate === targetDate ||
            (!isJalaliDateOverdue(r.jalaliDate) && selectedDayOffset === 0))
      )
    );
  }, [reminders, todayJalali, selectedDayOffset]);

  const filteredList = useMemo(() => {
    if (activeTab === 'overdue') {
      return overdueReminders;
    }
    if (activeTab === 'calls') {
      return sortRemindersByPriorityAndTime(
        reminders.filter((r) => r.status !== 'done' && r.categories.includes('phone'))
      );
    }
    if (activeTab === 'visits') {
      return sortRemindersByPriorityAndTime(
        reminders.filter((r) => r.status !== 'done' && r.categories.includes('visit'))
      );
    }
    if (activeTab === 'checks_contracts') {
      return sortRemindersByPriorityAndTime(
        reminders.filter(
          (r) =>
            r.status !== 'done' &&
            (r.categories.includes('finance') ||
              r.categories.includes('inquiry') ||
              r.categories.includes('documents') ||
              r.categories.includes('meeting'))
        )
      );
    }
    if (activeTab === 'done') {
      return sortRemindersByPriorityAndTime(reminders.filter((r) => r.status === 'done'));
    }
    return todayReminders;
  }, [activeTab, overdueReminders, reminders, todayReminders]);

  const getLinkedLabel = (rem: ReminderRecord) => {
    const parts: string[] = [];
    if (rem.linkedPropertyId) {
      const p = properties.find((x) => x.id === rem.linkedPropertyId);
      if (p) parts.push(`ملک: ${p.title} (${p.code})`);
    }
    if (rem.linkedApplicantId) {
      const a = applicants.find((x) => x.id === rem.linkedApplicantId);
      if (a) parts.push(`متقاضی: ${a.name} (${a.code})`);
    }
    if (rem.linkedCollaboratorId) {
      const c = collaborators.find((x) => x.id === rem.linkedCollaboratorId);
      if (c) parts.push(`همکار: ${c.name} (${c.code})`);
    }
    if (parts.length > 0) return parts.join(' • ');
    return rem.customLinks?.[0];
  };

  const openNewSmartVoiceSheet = (initialText?: string) => {
    setEditingReminder(null);
    setPreselectedPropertyId(undefined);
    setPreselectedApplicantId(undefined);
    setPreselectedCollaboratorId(undefined);
    setSheetInitialTranscript(initialText);
    setIsVoiceSheetOpen(true);
  };

  const handleOpenEditReminder = (rem: ReminderRecord) => {
    setEditingReminder(rem);
    setPreselectedPropertyId(undefined);
    setPreselectedApplicantId(undefined);
    setPreselectedCollaboratorId(undefined);
    setSheetInitialTranscript(undefined);
    setIsVoiceSheetOpen(true);
  };

  const handleDeleteReminderCard = async (rem: ReminderRecord) => {
    const confirmed = await askConfirm({
      title: 'حذف یادآور و فایل صوتی',
      message: `آیا از حذف یادآور «${rem.title}» اطمینان دارید؟ فایل صوتی آرشیوشده نیز از حافظه پاک خواهد شد.`,
      confirmLabel: 'حذف یادآور',
      cancelLabel: 'انصراف',
      danger: true,
    });
    if (!confirmed) return;

    if (playingReminderId === rem.id && cardAudioRef.current) {
      cardAudioRef.current.pause();
      setPlayingReminderId(null);
    }

    await deleteReminder(rem.id);
    await refreshSnapshot();
    showToast('یادآور و فایل صوتی مرتبط با موفقیت حذف شد.', 'info');
  };

  const handleTogglePlayCardAudio = async (rem: ReminderRecord) => {
    if (playingReminderId === rem.id && cardAudioRef.current) {
      cardAudioRef.current.pause();
      setPlayingReminderId(null);
      return;
    }

    if (cardAudioRef.current) {
      cardAudioRef.current.pause();
      cardAudioRef.current = null;
    }

    if (!rem.audioMediaId) return;
    const url = await getMediaBlobUrl(rem.audioMediaId);
    if (!url) {
      showToast('فایل صوتی این یادآور در حافظه یافت نشد.', 'error');
      return;
    }

    const audio = new Audio(url);
    cardAudioRef.current = audio;
    audio.onended = () => setPlayingReminderId(null);
    audio.onerror = () => {
      setPlayingReminderId(null);
      showToast('خطا در پخش فایل صوتی', 'error');
    };
    try {
      await audio.play();
      setPlayingReminderId(rem.id);
    } catch {
      setPlayingReminderId(null);
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
    <div className="relative z-10 max-w-md mx-auto min-h-screen flex flex-col pb-28 bg-transparent">
      {/* Header Section */}
      <header className="pt-5 px-4 pb-3 sticky top-0 z-30 bg-[#050b18]/65 backdrop-blur-2xl border-b border-white/10">
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
                تقویم، آلارم و دستیار صوتی هوش مصنوعی
              </p>
            </div>
          </div>

          {!isViewer && (
            <button
              type="button"
              onClick={() => openNewSmartVoiceSheet()}
              className="gold-pill-btn px-3.5 py-2 rounded-xl flex items-center gap-1.5 text-xs font-extrabold active:scale-95 transition-transform cursor-pointer shadow-[0_0_20px_rgba(241,203,131,0.35)]"
            >
              <span className="material-symbols-outlined text-base font-bold">mic</span>
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

        {/* Quick Voice Reminder Input Bar -> Opens Smart Voice Reminder Sheet */}
        {!isViewer && (
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
                  if (e.key === 'Enter') {
                    const txt = voiceQuickInput.trim();
                    setVoiceQuickInput('');
                    openNewSmartVoiceSheet(txt || undefined);
                  }
                }}
                placeholder="یادآور صوتی هوشمند: «فردا ساعت ۱۱ تماس با رضوان برای پرونده F-002...»"
                className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-400 w-full font-medium"
              />
              <button
                type="button"
                onClick={() => {
                  const txt = voiceQuickInput.trim();
                  setVoiceQuickInput('');
                  openNewSmartVoiceSheet(txt || undefined);
                }}
                className="w-7 h-7 rounded-lg border bg-[#f1cb83]/20 border-[#f1cb83]/40 text-[#f1cb83] hover:bg-[#f1cb83]/30 flex items-center justify-center shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">
                  {voiceQuickInput.trim() ? 'auto_awesome' : 'mic'}
                </span>
              </button>
            </div>
          </div>
        )}

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
            { id: 'checks_contracts', label: 'چک، سند و قرارداد' },
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
              const isPlaying = playingReminderId === rem.id;
              return (
                <article
                  id={`reminder-card-${rem.id}`}
                  key={rem.id}
                  onClick={() => setHighlightedReminderId(null)}
                  className={`glass-card rounded-2xl p-4 relative overflow-hidden border transition-all ${
                    isHighlighted
                      ? 'border-[#f1cb83] shadow-[0_0_25px_rgba(241,203,131,0.45)] ring-2 ring-[#f1cb83]'
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-extrabold text-white truncate">{rem.title}</h3>
                        {!isViewer && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              title="ویرایش یادآور"
                              onClick={() => handleOpenEditReminder(rem)}
                              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#f1cb83]/20 text-slate-300 hover:text-[#f1cb83] flex items-center justify-center cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-sm">edit</span>
                            </button>
                            <button
                              type="button"
                              title="حذف یادآور"
                              onClick={() => void handleDeleteReminderCard(rem)}
                              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 flex items-center justify-center cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        {rem.transcript}
                      </p>
                    </div>
                  </div>

                  {rem.audioMediaId && (
                    <div className="mb-3 p-2 rounded-xl bg-[#050b17]/70 border border-[#f1cb83]/25 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => void handleTogglePlayCardAudio(rem)}
                        className="flex items-center gap-2 text-xs font-bold text-[#f1cb83] cursor-pointer"
                      >
                        <span className="w-7 h-7 rounded-full bg-[#f1cb83]/20 border border-[#f1cb83]/40 flex items-center justify-center">
                          <span className="material-symbols-outlined text-base">
                            {isPlaying ? 'pause' : 'play_arrow'}
                          </span>
                        </span>
                        <span>
                          {isPlaying
                            ? 'در حال پخش یادداشت صوتی...'
                            : `پخش یادداشت صوتی (${toPersianDigits(rem.audioDurationSec || 10)} ثانیه)`}
                        </span>
                      </button>
                    </div>
                  )}

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
                const isPlaying = playingReminderId === rem.id;
                const categoryIcon = rem.categories.includes('visit')
                  ? 'tour'
                  : rem.categories.includes('finance')
                  ? 'payments'
                  : rem.categories.includes('inquiry')
                  ? 'description'
                  : rem.categories.includes('documents')
                  ? 'folder_shared'
                  : rem.categories.includes('meeting')
                  ? 'groups'
                  : 'phone_callback';

                return (
                  <article
                    id={`reminder-card-${rem.id}`}
                    key={rem.id}
                    onClick={() => setHighlightedReminderId(null)}
                    className={`glass-card gold-border-glow rounded-2xl p-4 relative overflow-hidden transition-all ${
                      isHighlighted
                        ? 'ring-2 ring-[#f1cb83] shadow-[0_0_28px_rgba(241,203,131,0.4)]'
                        : ''
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
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/40 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[#f1cb83] text-xl">
                            {categoryIcon}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                  rem.priority === 'urgent'
                                    ? 'bg-rose-500/20 border-rose-400/40 text-rose-300'
                                    : rem.priority === 'low'
                                    ? 'bg-sky-500/20 border-sky-400/40 text-sky-300'
                                    : 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                                }`}
                              >
                                {rem.priority === 'urgent'
                                  ? 'فوری و بحرانی'
                                  : rem.priority === 'low'
                                  ? 'کم‌اهمیت'
                                  : 'عادی'}
                              </span>
                              <h3 className="text-sm font-extrabold text-white truncate">
                                {rem.title}
                              </h3>
                            </div>

                            {!isViewer && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  title="ویرایش یادآور"
                                  onClick={() => handleOpenEditReminder(rem)}
                                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-[#f1cb83]/20 text-slate-300 hover:text-[#f1cb83] flex items-center justify-center cursor-pointer"
                                >
                                  <span className="material-symbols-outlined text-sm">edit</span>
                                </button>
                                <button
                                  type="button"
                                  title="حذف یادآور"
                                  onClick={() => void handleDeleteReminderCard(rem)}
                                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 flex items-center justify-center cursor-pointer"
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                            {rem.transcript}
                          </p>
                        </div>
                      </div>
                    </div>

                    {rem.audioMediaId && (
                      <div className="mb-3 p-2 rounded-xl bg-[#050b17]/70 border border-[#f1cb83]/25 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => void handleTogglePlayCardAudio(rem)}
                          className="flex items-center gap-2 text-xs font-bold text-[#f1cb83] cursor-pointer"
                        >
                          <span className="w-7 h-7 rounded-full bg-[#f1cb83]/20 border border-[#f1cb83]/40 flex items-center justify-center">
                            <span className="material-symbols-outlined text-base">
                              {isPlaying ? 'pause' : 'play_arrow'}
                            </span>
                          </span>
                          <span>
                            {isPlaying
                              ? 'در حال پخش یادداشت صوتی...'
                              : `پخش یادداشت صوتی (${toPersianDigits(
                                  rem.audioDurationSec || 10
                                )} ثانیه)`}
                          </span>
                        </button>
                      </div>
                    )}

                    {linkedLabel && (
                      <div className="bg-[#080f20]/70 rounded-xl p-2.5 border border-white/10 mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[11px] text-slate-200 truncate">
                          <span className="material-symbols-outlined text-sm text-[#f1cb83]">
                            folder_special
                          </span>
                          <span className="truncate">{linkedLabel}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleNavigateLinkedEntity(rem)}
                          className="text-[10px] text-[#f1cb83] font-bold hover:underline shrink-0 cursor-pointer"
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
                          className="w-[80.4375px] px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/15 text-slate-200 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
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
                            className="w-[80.0938px] px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-extrabold flex items-center justify-center gap-1 cursor-pointer"
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

      {/* Smart Voice Reminder Bottom Sheet (Reference 1 & Reference 2) */}
      <SmartVoiceReminderSheet
        isOpen={isVoiceSheetOpen}
        editingReminder={editingReminder}
        preselectedPropertyId={preselectedPropertyId}
        preselectedApplicantId={preselectedApplicantId}
        preselectedCollaboratorId={preselectedCollaboratorId}
        initialTranscript={sheetInitialTranscript}
        onClose={() => {
          setIsVoiceSheetOpen(false);
          setEditingReminder(null);
          if (location.pathname === '/reminders/new' || location.search) {
            navigate('/reminders', { replace: true });
          }
        }}
      />

      {isFullCalendarOpen && (
        <JalaliDatePickerModal
          initialValue={todayJalali}
          title="تقویم جامع شمسی کلید"
          onClose={() => setIsFullCalendarOpen(false)}
          onSelect={(d) => {
            setIsFullCalendarOpen(false);
            openNewSmartVoiceSheet(`یادآور برای تاریخ ${d}`);
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
    </div>
  );
};
