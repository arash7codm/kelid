import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  deleteMediaBlob,
  getMediaBlobUrl,
  saveMediaBlob,
  saveReminder,
} from '../db/repositories';
import {
  ApplicantRecord,
  CollaboratorRecord,
  PropertyRecord,
  ReminderCategory,
  ReminderRecord,
} from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import {
  aiService,
  EntitiesCatalog,
  getTehranTodayJalali,
  MatchedContactItem,
  MatchedPropertyItem,
  resolvePersianDateTimeDeterministically,
} from '../services/ai';
import {
  CalendarEventMetadata,
  createOrUpdateGoogleCalendarEvent,
  exportReminderAsIcs,
  getGoogleCalendarTemplateUrl,
  scheduleInAppReminderNotification,
} from '../services/calendar';
import { VoiceSessionController } from '../services/voice';
import {
  addDaysToJalali,
  formatJalaliHuman,
  normalizePersianText,
  toPersianDigits,
} from '../utils/persian';
import { JalaliDatePickerModal } from './JalaliDatePickerModal';
import { KelidLogoIcon } from './Layout';

export type SmartVoiceSheetState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'ready'
  | 'saving'
  | 'success'
  | 'error';

interface SmartVoiceReminderSheetProps {
  isOpen: boolean;
  onClose: () => void;
  editingReminder?: ReminderRecord | null;
  preselectedPropertyId?: string;
  preselectedApplicantId?: string;
  preselectedCollaboratorId?: string;
  initialTranscript?: string;
  onSaved?: (saved: ReminderRecord) => void;
}

const CATEGORY_OPTIONS: Array<{
  id: ReminderCategory;
  label: string;
  icon: string;
}> = [
  { id: 'phone', label: 'تماس تلفنی', icon: 'call' },
  { id: 'inquiry', label: 'استعلام سند', icon: 'description' },
  { id: 'visit', label: 'بازدید حضوری', icon: 'location_on' },
  { id: 'finance', label: 'پیگیری مالی', icon: 'payments' },
  { id: 'documents', label: 'ارسال مدارک', icon: 'folder_shared' },
  { id: 'meeting', label: 'جلسه مذاکره', icon: 'groups' },
];

const QUICK_TIME_PRESETS = [
  { time: '09:00', label: '۰۹:۰۰ صبح' },
  { time: '11:00', label: '۱۱:۰۰ قبل‌ازظهر' },
  { time: '13:30', label: '۰۱:۳۰ بعدازظهر' },
  { time: '16:00', label: '۰۴:۰۰ عصر' },
  { time: '18:30', label: '۰۶:۳۰ عصر' },
  { time: '20:30', label: '۰۸:۳۰ شب' },
];

function formatTime24ToPersianDisplay(time24: string): string {
  const parts = time24.split(':');
  const h = parseInt(parts[0] || '11', 10);
  const m = parseInt(parts[1] || '0', 10);
  const period =
    h === 0
      ? 'نیمه‌شب'
      : h < 12
      ? 'قبل‌ازظهر'
      : h === 12
      ? 'ظهر'
      : h < 16
      ? 'بعدازظهر'
      : h < 20
      ? 'عصر'
      : 'شب';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${toPersianDigits(String(h12).padStart(2, '0'))}:${toPersianDigits(
    String(m).padStart(2, '0')
  )} ${period}`;
}

function formatTimerClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${toPersianDigits(String(m).padStart(2, '0'))}:${toPersianDigits(
    String(s).padStart(2, '0')
  )}`;
}

function formatEnglishClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const SmartVoiceReminderSheet: React.FC<SmartVoiceReminderSheetProps> = ({
  isOpen,
  onClose,
  editingReminder,
  preselectedPropertyId,
  preselectedApplicantId,
  preselectedCollaboratorId,
  initialTranscript,
  onSaved,
}) => {
  const navigate = useNavigate();
  const {
    snapshot,
    refreshSnapshot,
    showToast,
    askConfirm,
    askPermission,
    setHighlightedReminderId,
  } = useApp();

  const properties = useMemo(() => snapshot?.properties || [], [snapshot?.properties]);
  const applicants = useMemo(() => snapshot?.applicants || [], [snapshot?.applicants]);
  const collaborators = useMemo(() => snapshot?.collaborators || [], [snapshot?.collaborators]);

  const catalog: EntitiesCatalog = useMemo(
    () => ({ properties, applicants, collaborators }),
    [properties, applicants, collaborators]
  );

  // Sheet State Machine
  const [sheetState, setSheetState] = useState<SmartVoiceSheetState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Recording & Audio State
  const [seconds, setSeconds] = useState(0);
  const [waveformLevels, setWaveformLevels] = useState<number[]>(() => Array(12).fill(14));
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [savedAudioMediaId, setSavedAudioMediaId] = useState<string | undefined>(undefined);
  const [audioPlaybackUrl, setAudioPlaybackUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [playbackCurrentSec, setPlaybackCurrentSec] = useState(0);
  const [playbackDurationSec, setPlaybackDurationSec] = useState(0);

  // Extracted & Editable Form Fields
  const [transcript, setTranscript] = useState('');
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [summaryTitle, setSummaryTitle] = useState('');
  const [linkedPropertyId, setLinkedPropertyId] = useState<string>('');
  const [linkedContactType, setLinkedContactType] = useState<'applicant' | 'collaborator' | ''>('');
  const [linkedContactId, setLinkedContactId] = useState<string>('');
  const [customLinks, setCustomLinks] = useState<string[]>([]);

  // Disambiguation candidates from AI fuzzy matching
  const [propertyCandidates, setPropertyCandidates] = useState<MatchedPropertyItem[]>([]);
  const [contactCandidates, setContactCandidates] = useState<MatchedContactItem[]>([]);

  // Actions, Date/Time & Priority
  const [selectedCategories, setSelectedCategories] = useState<ReminderCategory[]>(['phone']);
  const [jalaliDate, setJalaliDate] = useState<string>(() =>
    addDaysToJalali(getTehranTodayJalali(true), 1, true)
  );
  const [time24, setTime24] = useState<string>('11:00');
  const [priority, setPriority] = useState<'urgent' | 'normal' | 'low'>('normal');
  const [priorityReason, setPriorityReason] = useState<string>('');

  // Flags & Warnings
  const [aiFilledFields, setAiFilledFields] = useState<string[]>([]);
  const [isDefaultDate, setIsDefaultDate] = useState(false);
  const [isDefaultTime, setIsDefaultTime] = useState(false);
  const [dateTimeNeedsConfirm, setDateTimeNeedsConfirm] = useState(false);
  const [isPastWarning, setIsPastWarning] = useState(false);
  const [usedGeminiBadge, setUsedGeminiBadge] = useState(false);

  // Switches
  const [syncWithPhoneCalendar, setSyncWithPhoneCalendar] = useState(true);
  const [smsNotification, setSmsNotification] = useState(true);
  const [registerInCartable, setRegisterInCartable] = useState(true);

  // Sub-modals (Link Picker, Date Picker, Time Picker)
  const [isLinkPickerOpen, setIsLinkPickerOpen] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isTimePickerOpen, setIsTimePickerOpen] = useState(false);

  // Saved Reminder Result (for Reference 2 Success View)
  const [savedReminderRecord, setSavedReminderRecord] = useState<ReminderRecord | null>(null);

  // Swipe-to-dismiss tracking
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const touchStartYRef = useRef<number | null>(null);

  const voiceControllerRef = useRef<VoiceSessionController | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const isDirtyRef = useRef(false);

  // Cleanup audio player & voice session
  const cleanupAllMedia = useCallback(() => {
    if (voiceControllerRef.current) {
      voiceControllerRef.current.cancel();
      voiceControllerRef.current = null;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    setIsPlayingAudio(false);
    setWaveformLevels(Array(12).fill(14));
  }, []);

  // Initialize state when opened or when editingReminder / preselected IDs change
  useEffect(() => {
    if (!isOpen) {
      cleanupAllMedia();
      return;
    }

    const today = getTehranTodayJalali(true);
    const tomorrow = addDaysToJalali(today, 1, true);

    if (editingReminder) {
      setSheetState('ready');
      setErrorMessage(null);
      setTranscript(editingReminder.transcript || editingReminder.title);
      setSummaryTitle(editingReminder.title);
      setSeconds(editingReminder.audioDurationSec || 0);
      setPlaybackDurationSec(editingReminder.audioDurationSec || 0);
      setSavedAudioMediaId(editingReminder.audioMediaId);
      setRecordedBlob(null);
      setLinkedPropertyId(editingReminder.linkedPropertyId || '');
      if (editingReminder.linkedApplicantId) {
        setLinkedContactType('applicant');
        setLinkedContactId(editingReminder.linkedApplicantId);
      } else if (editingReminder.linkedCollaboratorId) {
        setLinkedContactType('collaborator');
        setLinkedContactId(editingReminder.linkedCollaboratorId);
      } else {
        setLinkedContactType('');
        setLinkedContactId('');
      }
      setCustomLinks(editingReminder.customLinks || []);
      setSelectedCategories(
        editingReminder.categories?.length ? editingReminder.categories : ['phone']
      );
      setJalaliDate(editingReminder.jalaliDate || tomorrow);
      setTime24(editingReminder.time || '11:00');
      setPriority(editingReminder.priority || 'normal');
      setPriorityReason(editingReminder.priorityReason || '');
      setSmsNotification(editingReminder.smsNotification ?? true);
      setRegisterInCartable(editingReminder.registerInCartable ?? true);
      setSyncWithPhoneCalendar(editingReminder.syncWithPhoneCalendar ?? true);
      setAiFilledFields(editingReminder.aiFilledFields || []);
      setIsDefaultDate(false);
      setIsDefaultTime(false);
      setDateTimeNeedsConfirm(Boolean(editingReminder.timeNeedsConfirmation));
      setIsPastWarning(false);
      setSavedReminderRecord(null);
      isDirtyRef.current = false;

      if (editingReminder.audioMediaId) {
        getMediaBlobUrl(editingReminder.audioMediaId).then((url) => {
          if (url) setAudioPlaybackUrl(url);
        });
      } else {
        setAudioPlaybackUrl(null);
      }
      return;
    }

    // Fresh new reminder state
    setSheetState('idle');
    setErrorMessage(null);
    setSeconds(0);
    setRecordedBlob(null);
    setSavedAudioMediaId(undefined);
    setAudioPlaybackUrl(null);
    setPlaybackCurrentSec(0);
    setPlaybackDurationSec(0);
    setTranscript(initialTranscript || '');
    setSummaryTitle('');
    setLinkedPropertyId(preselectedPropertyId || '');
    if (preselectedApplicantId) {
      setLinkedContactType('applicant');
      setLinkedContactId(preselectedApplicantId);
    } else if (preselectedCollaboratorId) {
      setLinkedContactType('collaborator');
      setLinkedContactId(preselectedCollaboratorId);
    } else {
      setLinkedContactType('');
      setLinkedContactId('');
    }
    setCustomLinks([]);
    setPropertyCandidates([]);
    setContactCandidates([]);
    setSelectedCategories(['phone']);
    setJalaliDate(tomorrow);
    setTime24('11:00');
    setPriority('normal');
    setPriorityReason('');
    setAiFilledFields([]);
    setIsDefaultDate(false);
    setIsDefaultTime(false);
    setDateTimeNeedsConfirm(false);
    setIsPastWarning(false);
    setSyncWithPhoneCalendar(true);
    setSmsNotification(true);
    setRegisterInCartable(true);
    setSavedReminderRecord(null);
    isDirtyRef.current = false;

    if (initialTranscript && initialTranscript.trim()) {
      void runAiExtractionOnText(initialTranscript.trim(), null);
    }
  }, [
    isOpen,
    editingReminder,
    preselectedPropertyId,
    preselectedApplicantId,
    preselectedCollaboratorId,
    initialTranscript,
    cleanupAllMedia,
  ]);

  // Resolved Linked Entities for Display
  const selectedProperty: PropertyRecord | undefined = useMemo(
    () => properties.find((p) => p.id === linkedPropertyId),
    [properties, linkedPropertyId]
  );

  const selectedApplicant: ApplicantRecord | undefined = useMemo(
    () => (linkedContactType === 'applicant' ? applicants.find((a) => a.id === linkedContactId) : undefined),
    [applicants, linkedContactType, linkedContactId]
  );

  const selectedCollaborator: CollaboratorRecord | undefined = useMemo(
    () =>
      linkedContactType === 'collaborator'
        ? collaborators.find((c) => c.id === linkedContactId)
        : undefined,
    [collaborators, linkedContactType, linkedContactId]
  );

  const dateHumanDisplay = useMemo(() => {
    const today = getTehranTodayJalali(true);
    const tomorrow = addDaysToJalali(today, 1, true);
    const dayAfter = addDaysToJalali(today, 2, true);
    const baseHuman = formatJalaliHuman(jalaliDate, false);
    if (jalaliDate === today) return `امروز - ${baseHuman}`;
    if (jalaliDate === tomorrow) return `فردا - ${baseHuman}`;
    if (jalaliDate === dayAfter) return `پس‌فردا - ${baseHuman}`;
    return formatJalaliHuman(jalaliDate, true);
  }, [jalaliDate]);

  const timePersianDisplay = useMemo(() => formatTime24ToPersianDisplay(time24), [time24]);

  const cartableTargetCode = useMemo(() => {
    if (selectedProperty) return `پرونده ${selectedProperty.code}`;
    if (selectedApplicant) return `متقاضی ${selectedApplicant.code}`;
    if (selectedCollaborator) return `همکار ${selectedCollaborator.code}`;
    if (customLinks.length > 0) return `پرونده ${customLinks[0]}`;
    return 'کارتابل جامع پیگیری‌ها';
  }, [selectedProperty, selectedApplicant, selectedCollaborator, customLinks]);

  // Run AI + Deterministic Extraction
  const runAiExtractionOnText = useCallback(
    async (rawText: string, blobToSend: Blob | null) => {
      if (!rawText.trim() && (!blobToSend || blobToSend.size < 400)) {
        setSheetState('error');
        setErrorMessage('صدایی یا متنی برای تحلیل دریافت نشد. لطفاً دوباره ضبط کنید یا متن را بنویسید.');
        return;
      }

      setSheetState('processing');
      setErrorMessage(null);

      try {
        const result = await aiService.transcribeAndExtractVoiceReminder(
          blobToSend,
          rawText,
          catalog
        );

        if (result.transcript) {
          setTranscript(result.transcript);
        }
        setSummaryTitle(result.title || result.summary);
        setSelectedCategories(result.categories.length ? result.categories : ['phone']);
        setJalaliDate(result.jalaliDate);
        setTime24(result.time);
        setPriority(result.priority);
        setPriorityReason(result.priorityReason);
        setIsDefaultDate(result.isDefaultDate);
        setIsDefaultTime(result.isDefaultTime);
        setDateTimeNeedsConfirm(
          result.dateNeedsConfirmation || result.timeNeedsConfirmation || result.isPastDateTime
        );
        setIsPastWarning(result.isPastDateTime);
        setAiFilledFields(result.aiFilledFields);
        setUsedGeminiBadge(result.usedGemini);

        // Apply matched property if not already locked by preselection
        if (result.matchedProperty) {
          setLinkedPropertyId(result.matchedProperty.id);
        }
        setPropertyCandidates(result.propertyCandidates || []);

        // Apply matched contact if not already locked by preselection
        if (result.matchedContact) {
          setLinkedContactType(result.matchedContact.type);
          setLinkedContactId(result.matchedContact.id);
        }
        setContactCandidates(result.contactCandidates || []);

        // Capture any unmatched explicit codes in customLinks
        const unmatchedCodes = (result.matchedCodes || []).filter(
          (code) =>
            code !== result.matchedProperty?.code && code !== result.matchedContact?.code
        );
        if (unmatchedCodes.length > 0) {
          setCustomLinks(unmatchedCodes);
        }

        isDirtyRef.current = true;
        setSheetState('ready');
      } catch (err: any) {
        setSheetState('ready');
        showToast(err?.message || 'تحلیل با موتور محلی انجام شد.', 'info');
      }
    },
    [catalog, showToast]
  );

  // Start / Stop Recording
  const handleToggleRecording = async () => {
    if (sheetState === 'recording' || sheetState === 'paused') {
      voiceControllerRef.current?.stop();
      return;
    }

    const allowed = await askPermission('microphone');
    if (!allowed) {
      setSheetState('error');
      setErrorMessage('مجوز میکروفون تایید نشد. می‌توانید متن یادآور را به صورت دستی وارد کنید.');
      return;
    }

    setErrorMessage(null);
    setSeconds(0);

    const controller = new VoiceSessionController({
      initialText: transcript.trim(),
      onStatusChange: (st) => {
        if (st === 'listening') setSheetState('recording');
        else if (st === 'paused') setSheetState('paused');
        else if (st === 'processing') setSheetState('processing');
      },
      onDurationTick: (sec) => {
        setSeconds(sec);
      },
      onWaveformLevels: (levels) => {
        setWaveformLevels(levels);
      },
      onLiveTranscript: (liveText) => {
        setTranscript(liveText);
        isDirtyRef.current = true;
        // Real-time live preview extraction while speaking
        const liveDet = resolvePersianDateTimeDeterministically(liveText);
        if (!liveDet.isDefaultDate) setJalaliDate(liveDet.jalaliDate);
        if (!liveDet.isDefaultTime) setTime24(liveDet.time);
      },
      onSilenceTimeout: (msg) => {
        showToast(msg, 'info');
      },
      onRecordingComplete: async (res) => {
        setWaveformLevels(Array(12).fill(14));
        setSeconds(res.durationSec);
        setPlaybackDurationSec(res.durationSec);

        if (res.wasSilent && !res.transcript.trim()) {
          setSheetState('error');
          setErrorMessage(
            'صدایی در میکروفون تشخیص داده نشد (ضبط بی‌صدا یا بسیار کوتاه). لطفاً دوباره تلاش کنید.'
          );
          return;
        }

        if (res.blob && res.blob.size > 200) {
          setRecordedBlob(res.blob);
          const url = URL.createObjectURL(res.blob);
          setAudioPlaybackUrl((prev) => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return url;
          });
        }

        const textToAnalyze = res.transcript.trim() || transcript.trim();
        await runAiExtractionOnText(textToAnalyze, res.blob || null);
      },
      onError: (errMsg) => {
        setWaveformLevels(Array(12).fill(14));
        setSheetState('error');
        setErrorMessage(errMsg);
      },
    });

    voiceControllerRef.current = controller;
    const started = await controller.start();
    if (started) {
      setSheetState('recording');
      isDirtyRef.current = true;
    }
  };

  const handlePauseResumeRecording = () => {
    if (sheetState === 'recording') {
      voiceControllerRef.current?.pause();
      setSheetState('paused');
    } else if (sheetState === 'paused') {
      voiceControllerRef.current?.resume();
      setSheetState('recording');
    } else {
      void handleToggleRecording();
    }
  };

  const handleResetAndClearRecording = async () => {
    cleanupAllMedia();
    if (audioPlaybackUrl && audioPlaybackUrl.startsWith('blob:')) {
      URL.revokeObjectURL(audioPlaybackUrl);
    }
    if (savedAudioMediaId && !editingReminder) {
      await deleteMediaBlob(savedAudioMediaId);
    }
    setRecordedBlob(null);
    setSavedAudioMediaId(undefined);
    setAudioPlaybackUrl(null);
    setSeconds(0);
    setPlaybackCurrentSec(0);
    setPlaybackDurationSec(0);
    setTranscript('');
    setSummaryTitle('');
    setAiFilledFields([]);
    setErrorMessage(null);
    setSheetState('idle');
    isDirtyRef.current = false;
    showToast('ضبط قبلی پاکسازی شد. می‌توانید صوت جدید را ضبط کنید.', 'info');
  };

  const handleToggleCategory = (catId: ReminderCategory) => {
    isDirtyRef.current = true;
    setSelectedCategories((prev) => {
      if (prev.includes(catId)) {
        return prev.length > 1 ? prev.filter((c) => c !== catId) : prev;
      }
      return [...prev, catId];
    });
  };

  // Safe Dismiss with Confirmation if recording or dirty
  const handleSafeDismiss = useCallback(async () => {
    if (sheetState === 'saving') return;
    if (sheetState === 'success') {
      cleanupAllMedia();
      onClose();
      return;
    }

    if (sheetState === 'recording' || sheetState === 'paused' || isDirtyRef.current) {
      const confirmed = await askConfirm({
        title: 'بستن پنل یادآور هوشمند',
        message:
          sheetState === 'recording' || sheetState === 'paused'
            ? 'ضبط صدا در حال انجام است. آیا مایلید ضبط متوقف شود و بدون ذخیره خارج شوید؟'
            : 'تغییرات یادآور صوتی هنوز ذخیره نشده است. آیا از بستن پنل اطمینان دارید؟',
        confirmLabel: 'بله، خارج شو',
        cancelLabel: 'ادامه ویرایش',
        danger: true,
      });
      if (!confirmed) return;
    }

    cleanupAllMedia();
    onClose();
  }, [sheetState, askConfirm, cleanupAllMedia, onClose]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLinkPickerOpen) setIsLinkPickerOpen(false);
        else if (isDatePickerOpen) setIsDatePickerOpen(false);
        else if (isTimePickerOpen) setIsTimePickerOpen(false);
        else void handleSafeDismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isLinkPickerOpen, isDatePickerOpen, isTimePickerOpen, handleSafeDismiss]);

  // Save & Schedule Reminder
  const handleSaveReminder = async () => {
    if (sheetState === 'saving') return;
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) {
      showToast('لطفاً ابتدا پیام صوتی را ضبط کنید یا متن یادآور را وارد نمایید.', 'error');
      return;
    }

    setSheetState('saving');
    try {
      let mediaId = savedAudioMediaId;
      if (recordedBlob && recordedBlob.size > 0) {
        const savedBlobRec = await saveMediaBlob(
          recordedBlob,
          `voice_reminder_${Date.now()}.webm`
        );
        mediaId = savedBlobRec.id;
        setSavedAudioMediaId(mediaId);
      }

      const finalTitle =
        summaryTitle.trim() ||
        (cleanTranscript.length > 52
          ? cleanTranscript.slice(0, 52).trim() + '...'
          : cleanTranscript);

      const saved = await saveReminder({
        id: editingReminder?.id,
        code: editingReminder?.code,
        title: finalTitle,
        transcript: cleanTranscript,
        audioMediaId: mediaId,
        audioDurationSec: seconds > 0 ? seconds : editingReminder?.audioDurationSec,
        jalaliDate,
        time: time24,
        timeDisplay: timePersianDisplay,
        timeNeedsConfirmation: false,
        linkedPropertyId: linkedPropertyId || undefined,
        linkedApplicantId: linkedContactType === 'applicant' ? linkedContactId : undefined,
        linkedCollaboratorId: linkedContactType === 'collaborator' ? linkedContactId : undefined,
        customLinks,
        categories: selectedCategories,
        priority,
        priorityReason,
        smsNotification,
        registerInCartable,
        syncWithPhoneCalendar,
        status: editingReminder?.status || 'pending',
        calendarStatus: editingReminder?.calendarStatus || 'none',
        calendarEventId: editingReminder?.calendarEventId,
        syncStatus: 'local',
        aiFilledFields,
        aiSummary: finalTitle,
      });

      const calMeta: CalendarEventMetadata = {
        propertyLabel: selectedProperty
          ? `${selectedProperty.code} (${selectedProperty.title})`
          : undefined,
        contactLabel: selectedApplicant
          ? `${selectedApplicant.name} (${selectedApplicant.code})`
          : selectedCollaborator
          ? `${selectedCollaborator.name} (${selectedCollaborator.code})`
          : undefined,
        actionLabels: selectedCategories.map(
          (c) => CATEGORY_OPTIONS.find((o) => o.id === c)?.label || c
        ),
      };

      // Schedule browser/PWA notification if enabled
      if (smsNotification) {
        await scheduleInAppReminderNotification(saved, calMeta);
      }

      // Sync with phone calendar (.ics or Google Calendar API) if switch is active
      if (syncWithPhoneCalendar) {
        const calResult = await createOrUpdateGoogleCalendarEvent(saved, calMeta);
        saved.calendarStatus = calResult.status;
        saved.calendarEventId = calResult.eventId;
        await saveReminder(saved);
      }

      await refreshSnapshot();
      setSavedReminderRecord(saved);
      isDirtyRef.current = false;
      setSheetState('success');
      onSaved?.(saved);
      showToast('یادآور هوشمند با موفقیت ذخیره و همگام‌سازی شد.', 'success');
    } catch (err: any) {
      setSheetState('ready');
      showToast(err?.message || 'خطا در ذخیره‌سازی یادآور', 'error');
    }
  };

  // Audio Playback on Success Screen
  const handleTogglePlaySavedAudio = async () => {
    if (isPlayingAudio && audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setIsPlayingAudio(false);
      return;
    }

    let url = audioPlaybackUrl;
    if (!url && savedReminderRecord?.audioMediaId) {
      url = await getMediaBlobUrl(savedReminderRecord.audioMediaId);
      if (url) setAudioPlaybackUrl(url);
    }

    if (!url) {
      showToast('برای این یادآور فایل صوتی ضبط نشده است (ثبت متنی).', 'info');
      return;
    }

    const audio = new Audio(url);
    audioPlayerRef.current = audio;
    audio.ontimeupdate = () => {
      setPlaybackCurrentSec(Math.floor(audio.currentTime));
    };
    audio.onloadedmetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setPlaybackDurationSec(Math.round(audio.duration));
      }
    };
    audio.onended = () => {
      setIsPlayingAudio(false);
      setPlaybackCurrentSec(0);
    };
    audio.onerror = () => {
      setIsPlayingAudio(false);
      showToast('خطا در پخش فایل صوتی آرشیوشده', 'error');
    };

    try {
      await audio.play();
      setIsPlayingAudio(true);
    } catch {
      setIsPlayingAudio(false);
    }
  };

  // Share Reminder Details
  const handleShareReminder = async () => {
    const targetRem = savedReminderRecord;
    const textToShare = [
      `📌 یادآور هوشمند کلید: ${targetRem?.title || summaryTitle || transcript.slice(0, 45)}`,
      `📅 زمان: ${dateHumanDisplay} — ساعت ${timePersianDisplay}`,
      selectedProperty ? `🏠 پرونده ملکی: ${selectedProperty.code} (${selectedProperty.title})` : '',
      selectedApplicant
        ? `👤 متقاضی: ${selectedApplicant.name} (${selectedApplicant.code})`
        : selectedCollaborator
        ? `🤝 همکار: ${selectedCollaborator.name} (${selectedCollaborator.code})`
        : '',
      `📝 متن یادداشت: «${targetRem?.transcript || transcript}»`,
    ]
      .filter(Boolean)
      .join('\n');

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'یادآور هوشمند املاک کلید',
          text: textToShare,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(textToShare);
      showToast('مشخصات یادآور در کلیپ‌بورد کپی شد.', 'success');
    } catch {
      showToast('امکان اشتراک‌گذاری در این مرورگر وجود ندارد.', 'info');
    }
  };

  // Filtered items for the manual "+ افزودن پیوند" searchable modal
  const filteredLinkCatalog = useMemo(() => {
    const q = normalizePersianText(linkSearchQuery);
    const props = properties.filter(
      (p) =>
        !q ||
        normalizePersianText(`${p.code} ${p.title} ${p.city}`).includes(q)
    );
    const apps = applicants.filter(
      (a) =>
        !q ||
        normalizePersianText(`${a.code} ${a.name} ${a.cities.join(' ')}`).includes(q)
    );
    const cols = collaborators.filter(
      (c) =>
        !q ||
        normalizePersianText(`${c.code} ${c.name} ${c.agencyName || ''} ${c.primaryCity}`).includes(
          q
        )
    );
    return { props: props.slice(0, 15), apps: apps.slice(0, 15), cols: cols.slice(0, 15) };
  }, [linkSearchQuery, properties, applicants, collaborators]);

  if (!isOpen) return null;

  const canSubmit =
    transcript.trim().length > 0 &&
    Boolean(jalaliDate) &&
    Boolean(time24) &&
    sheetState !== 'recording' &&
    sheetState !== 'processing' &&
    sheetState !== 'saving';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ثبت هوشمند یادآور صوتی"
      onClick={() => void handleSafeDismiss()}
      className="fixed inset-0 z-[110] bg-[#050a16]/65 backdrop-blur-xl flex flex-col justify-end sm:justify-center items-center overflow-y-auto no-scrollbar transition-all duration-300"
    >
      {/* Top Floating Header Bar (Matching Reference 1 & 2) */}
      <header
        onClick={(e) => e.stopPropagation()}
        className="fixed top-0 inset-x-0 z-[115] pt-safe bg-[#050b17]/55 backdrop-blur-xl border-b border-[#f1cb83]/15 shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
      >
        <div className="h-16 px-5 max-w-md mx-auto flex items-center justify-between">
          <button
            type="button"
            aria-label="بستن و بازگشت"
            onClick={() => void handleSafeDismiss()}
            className="min-w-[42px] min-h-[42px] flex items-center justify-center rounded-full bg-[#0a152d]/70 border border-[#f1cb83]/20 text-[#f1cb83] hover:bg-[#f1cb83]/20 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
          </button>

          <div className="flex items-center gap-2">
            <KelidLogoIcon className="h-10 w-10" />
          </div>

          <div className="flex items-center gap-2">
            {sheetState !== 'success' && (
              <button
                type="button"
                aria-label="اعلانات سیستم"
                onClick={() =>
                  showToast(
                    `در حال حاضر ${toPersianDigits(
                      snapshot?.inboxStats?.totalToday || 0
                    )} یادآور فعال در کارتابل ثبت است.`,
                    'info'
                  )
                }
                className="relative min-w-[42px] min-h-[42px] flex items-center justify-center rounded-full bg-[#0a152d]/70 border border-[#f1cb83]/20 text-[#d1c5b4] hover:text-[#f1cb83] transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">notifications</span>
                {(snapshot?.inboxStats?.totalToday || 0) > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#ffb4ab] text-[#690005] text-[10px] flex items-center justify-center font-extrabold border border-[#050b17] shadow-[0_0_8px_rgba(255,180,171,0.8)]">
                    {toPersianDigits(snapshot?.inboxStats?.totalToday || 0)}
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              aria-label="اشتراک‌گذاری امن"
              onClick={handleShareReminder}
              className="min-w-[42px] min-h-[42px] flex items-center justify-center rounded-full bg-[#0a152d]/70 border border-[#f1cb83]/20 text-[#d1c5b4] hover:text-[#f1cb83] transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">share</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Sheet Container */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined,
        }}
        className="sheet-enter-up w-full max-w-md mx-auto pt-20 pb-safe px-4 max-h-[96vh] overflow-y-auto no-scrollbar relative z-[112]"
      >
        {sheetState === 'success' && savedReminderRecord ? (
          /* ============================================================================
             REFERENCE 2: SUCCESS CONFIRMATION SCREEN (یادداشت_صوتی_با_موفقیت_ثبت_شد.html)
             ============================================================================ */
          <div className="w-full rounded-2xl bg-[#0a152d]/55 backdrop-blur-2xl border border-[#f1cb83]/30 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_24px_rgba(241,203,131,0.12)] p-5 flex flex-col gap-5 relative overflow-hidden mb-6">
            {/* Top Decorative Emerald-Gold Halo Ray */}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-24 bg-[#10b981]/25 rounded-full blur-2xl pointer-events-none" />

            {/* Center Subtle Pill Handle (Swipe-down enabled) */}
            <div
              onTouchStart={(e) => {
                touchStartYRef.current = e.touches[0].clientY;
              }}
              onTouchMove={(e) => {
                if (touchStartYRef.current !== null) {
                  const delta = e.touches[0].clientY - touchStartYRef.current;
                  if (delta > 0) setDragOffsetY(Math.min(180, delta));
                }
              }}
              onTouchEnd={() => {
                if (dragOffsetY > 90) {
                  setDragOffsetY(0);
                  void handleSafeDismiss();
                } else {
                  setDragOffsetY(0);
                }
                touchStartYRef.current = null;
              }}
              className="w-full flex justify-center py-0.5 cursor-grab"
            >
              <div className="w-10 h-1 rounded-full bg-[#f1cb83]/40 shadow-[0_0_8px_rgba(241,203,131,0.3)]" />
            </div>

            {/* Success Header & Celebration Icon */}
            <div className="flex flex-col items-center text-center gap-2 pt-1 pb-1">
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-[#10b981]/25 blur-xl animate-pulse" />
                <div className="relative w-14 h-14 rounded-full bg-gradient-to-tr from-[#065f46] via-[#10b981] to-[#34d399] flex items-center justify-center text-white shadow-[0_0_24px_rgba(16,185,129,0.5),0_0_10px_rgba(241,203,131,0.4)] border border-white/30">
                  <span className="material-symbols-outlined text-3xl font-bold">check_circle</span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1 mt-1">
                <h2 className="text-[16px] font-bold text-[#dae2ff] leading-tight">
                  یادداشت صوتی و وظیفه با موفقیت ثبت شد
                </h2>
                <p className="text-[12px] text-[#f1cb83]/90 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#10b981]">verified</span>
                  <span>
                    {savedReminderRecord.syncWithPhoneCalendar
                      ? 'تحلیل هوش مصنوعی تکمیل و به تقویم افزوده شد'
                      : 'تحلیل هوش مصنوعی تکمیل و در کارتابل ذخیره شد'}
                  </span>
                </p>
              </div>
            </div>

            {/* SECTION 1: Audio Playback & Transcribed Memo Card */}
            <div className="w-full rounded-xl bg-[#0a152d]/55 backdrop-blur-xl border border-[#f1cb83]/25 p-3 flex flex-col gap-2.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]">
              {/* Audio Archive Header & Real Player Bar */}
              <div className="flex items-center justify-between gap-2 bg-[#050b17]/70 p-2 rounded-xl border border-white/5">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    aria-label={isPlayingAudio ? 'توقف صوت' : 'پخش صوت'}
                    onClick={handleTogglePlaySavedAudio}
                    className="w-9 h-9 rounded-full bg-[#f1cb83]/20 border border-[#f1cb83]/40 text-[#f1cb83] flex items-center justify-center hover:bg-[#f1cb83]/30 active:scale-95 transition-all shrink-0 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-xl">
                      {isPlayingAudio ? 'pause' : 'play_arrow'}
                    </span>
                  </button>
                  <div className="flex flex-col">
                    <span className="text-[12px] font-semibold text-[#dae2ff]">
                      {playbackDurationSec > 0
                        ? `${toPersianDigits(playbackDurationSec)} ثانیه صوت آرشیو شده`
                        : 'یادداشت هوشمند آرشیو شده'}
                    </span>
                    <span
                      dir="ltr"
                      className="text-[10px] text-[#d1c5b4] font-mono text-right"
                    >
                      {formatEnglishClock(playbackCurrentSec)} /{' '}
                      {formatEnglishClock(playbackDurationSec)}
                    </span>
                  </div>
                </div>

                {/* Compact Waveform */}
                <div className="flex items-center gap-1 px-2 py-1">
                  {[8, 16, 24, 28, 20, 12, 20, 24, 16, 8].map((h, i) => (
                    <span
                      key={i}
                      style={{
                        height: isPlayingAudio
                          ? `${Math.max(6, ((h + playbackCurrentSec * 7) % 26) + 6)}px`
                          : `${h}px`,
                      }}
                      className={`w-0.5 rounded-full transition-all duration-200 ${
                        i % 3 === 0
                          ? 'bg-[#b8c5f5]'
                          : 'bg-[#f1cb83] shadow-[0_0_6px_#f1cb83]'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Extracted Transcription Badge */}
              <div className="p-2.5 rounded-xl bg-[#050b17]/60 border border-[#f1cb83]/20 text-[#dae2ff] text-[13px] leading-relaxed select-all flex items-start gap-2">
                <span className="material-symbols-outlined text-[#f1cb83] text-base shrink-0 mt-0.5">
                  notes
                </span>
                <span>«{savedReminderRecord.transcript}»</span>
              </div>
            </div>

            {/* SECTION 2: Confirmed Metadata Details Grid */}
            <div className="flex flex-col gap-2 rounded-xl bg-[#0a152d]/45 backdrop-blur-xl border border-white/10 p-3 shadow-sm">
              <span className="text-[11px] text-[#d1c5b4] font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-[#f1cb83]">
                  assignment_turned_in
                </span>
                اطلاعات تایید و ثبت‌شده در پرونده:
              </span>

              <div className="flex flex-col gap-2 pt-1">
                {/* Linked Property */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-[#050b17]/60 border border-white/5">
                  <span className="text-[#d1c5b4] text-[11px]">پرونده ملکی متصل:</span>
                  {selectedProperty ? (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate(`/properties/${selectedProperty.id}`);
                      }}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#f1cb83] hover:underline cursor-pointer"
                    >
                      <span className="truncate max-w-[190px]">
                        {selectedProperty.code} ({selectedProperty.title})
                      </span>
                      <span className="material-symbols-outlined text-sm text-[#10b981]">
                        check_circle
                      </span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-[#d1c5b4]/70">بدون پرونده ملکی (عمومی)</span>
                  )}
                </div>

                {/* Assigned Contact */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-[#050b17]/60 border border-white/5">
                  <span className="text-[#d1c5b4] text-[11px]">مخاطب اختصاص‌یافته:</span>
                  {selectedApplicant || selectedCollaborator ? (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#b8c5f5]">
                      <span className="material-symbols-outlined text-sm">person</span>
                      <span className="truncate max-w-[190px]">
                        {selectedApplicant
                          ? `${selectedApplicant.name} (${selectedApplicant.code})`
                          : `${selectedCollaborator?.name} (${selectedCollaborator?.code})`}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-[#d1c5b4]/70">بدون مخاطب اختصاصی</span>
                  )}
                </div>

                {/* Scheduled Date, Time & Priority */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-[#050b17]/60 border border-white/5 gap-2">
                  <span className="text-[#d1c5b4] text-[11px] shrink-0">موعد و زمان یادآوری:</span>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <span className="text-[11px] font-semibold text-[#dae2ff]">
                      {dateHumanDisplay} - ساعت {toPersianDigits(savedReminderRecord.time)}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${
                        savedReminderRecord.priority === 'urgent'
                          ? 'text-[#ffb4ab] bg-[#ffb4ab]/20 border-[#ffb4ab]/40 shadow-[0_0_8px_rgba(255,180,171,0.2)]'
                          : savedReminderRecord.priority === 'low'
                          ? 'text-[#b8c5f5] bg-[#b8c5f5]/20 border-[#b8c5f5]/40'
                          : 'text-[#f1cb83] bg-[#f1cb83]/20 border-[#f1cb83]/40'
                      }`}
                    >
                      {savedReminderRecord.priority === 'urgent'
                        ? 'فوری و بحرانی'
                        : savedReminderRecord.priority === 'low'
                        ? 'کم‌اهمیت'
                        : 'عادی'}
                    </span>
                  </div>
                </div>

                {/* Push & SMS Notification Status */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-[#050b17]/60 border border-white/5">
                  <span className="text-[#d1c5b4] text-[11px]">ارسال پیامک و نوتیفیکیشن:</span>
                  <span
                    className={`text-[11px] font-bold flex items-center gap-1 ${
                      savedReminderRecord.smsNotification
                        ? 'text-[#10b981]'
                        : 'text-[#d1c5b4]/60'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        savedReminderRecord.smsNotification
                          ? 'bg-[#10b981] shadow-[0_0_8px_#10b981]'
                          : 'bg-slate-500'
                      }`}
                    />
                    {savedReminderRecord.smsNotification ? 'فعال شد' : 'غیرفعال'}
                  </span>
                </div>

                {/* Direct Calendar Export & Google Calendar Link Buttons */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      exportReminderAsIcs(savedReminderRecord, {
                        propertyLabel: selectedProperty
                          ? `${selectedProperty.code} (${selectedProperty.title})`
                          : undefined,
                        contactLabel: selectedApplicant
                          ? `${selectedApplicant.name} (${selectedApplicant.code})`
                          : selectedCollaborator
                          ? `${selectedCollaborator.name} (${selectedCollaborator.code})`
                          : undefined,
                      })
                    }
                    className="py-2 px-2.5 rounded-lg bg-[#050b17]/80 border border-[#f1cb83]/30 hover:border-[#f1cb83]/60 text-[#f1cb83] text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[15px]">download</span>
                    <span>دانلود فایل آلارم (.ics)</span>
                  </button>

                  <a
                    href={getGoogleCalendarTemplateUrl(savedReminderRecord, {
                      propertyLabel: selectedProperty
                        ? `${selectedProperty.code} (${selectedProperty.title})`
                        : undefined,
                      contactLabel: selectedApplicant
                        ? `${selectedApplicant.name} (${selectedApplicant.code})`
                        : selectedCollaborator
                        ? `${selectedCollaborator.name} (${selectedCollaborator.code})`
                        : undefined,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2 px-2.5 rounded-lg bg-[#050b17]/80 border border-[#b8c5f5]/30 hover:border-[#b8c5f5]/60 text-[#b8c5f5] text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[15px]">event</span>
                    <span>افزودن به Google Calendar</span>
                  </a>
                </div>
              </div>
            </div>

            {/* Bottom Action Buttons (Exact match to Reference 2) */}
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const id = savedReminderRecord.id;
                  cleanupAllMedia();
                  onClose();
                  setHighlightedReminderId(id);
                  navigate('/reminders');
                }}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#d4af37] via-[#f1cb83] to-[#ffdea3] hover:brightness-105 text-[#402d00] text-[15px] font-bold flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(241,203,131,0.45)] border border-white/30 active:scale-[0.99] transition-all whitespace-nowrap cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">fact_check</span>
                <span>مشاهده در کارتابل پیگیری‌ها</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSavedReminderRecord(null);
                  setRecordedBlob(null);
                  setSavedAudioMediaId(undefined);
                  setAudioPlaybackUrl(null);
                  setSeconds(0);
                  setTranscript('');
                  setSummaryTitle('');
                  setAiFilledFields([]);
                  setSheetState('idle');
                  isDirtyRef.current = false;
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-[#0a152d]/60 border border-[#f1cb83]/30 text-[#f1cb83] hover:bg-[#f1cb83]/15 text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors backdrop-blur-md cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">mic</span>
                <span>ثبت یک یادداشت صوتی دیگر +</span>
              </button>
            </div>
          </div>
        ) : (
          /* ============================================================================
             REFERENCE 1: RECORDING & AI EXTRACTION SHEET (ثبت_هوشمند_یادآور_صوتی.html)
             ============================================================================ */
          <div className="w-full rounded-2xl bg-[#0a152d]/65 backdrop-blur-2xl border border-[#f1cb83]/30 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_24px_rgba(241,203,131,0.12)] p-4 flex flex-col gap-4 relative overflow-hidden transition-all duration-300 mb-6">
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-24 bg-[#f1cb83]/20 rounded-full blur-2xl pointer-events-none" />

            {/* Center Subtle Pill Handle (Swipe-down enabled) */}
            <div
              onTouchStart={(e) => {
                touchStartYRef.current = e.touches[0].clientY;
              }}
              onTouchMove={(e) => {
                if (touchStartYRef.current !== null) {
                  const delta = e.touches[0].clientY - touchStartYRef.current;
                  if (delta > 0) setDragOffsetY(Math.min(180, delta));
                }
              }}
              onTouchEnd={() => {
                if (dragOffsetY > 90) {
                  setDragOffsetY(0);
                  void handleSafeDismiss();
                } else {
                  setDragOffsetY(0);
                }
                touchStartYRef.current = null;
              }}
              className="w-full flex justify-center py-0.5 cursor-grab"
            >
              <div className="w-10 h-1 rounded-full bg-[#f1cb83]/40 shadow-[0_0_8px_rgba(241,203,131,0.3)]" />
            </div>

            {/* Modal Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/35 flex items-center justify-center shrink-0 shadow-[0_0_14px_rgba(241,203,131,0.25)]">
                  <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">mic</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <h2 className="text-[15px] font-bold text-[#dae2ff] truncate leading-tight">
                    {editingReminder ? 'ویرایش هوشمند یادآور صوتی' : 'ثبت هوشمند یادآور صوتی'}
                  </h2>
                  <p className="text-[11px] text-[#d1c5b4] truncate mt-0.5">
                    تبدیل صوت به متن با هوش مصنوعی و استخراج وظایف
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="بستن"
                onClick={() => void handleSafeDismiss()}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-[#0a152d]/60 border border-white/10 text-[#d1c5b4] hover:text-[#f1cb83] hover:border-[#f1cb83]/40 transition-colors shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* SECTION 1: Voice Recording & Real Web Audio API Visualizer */}
            <div className="w-full rounded-xl bg-[#0a152d]/50 backdrop-blur-xl border border-[#f1cb83]/25 p-3 flex flex-col gap-2.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]">
              {/* Live Recording Status Bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5">
                    {sheetState === 'recording' && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[#ffb4ab] opacity-75 animate-ping" />
                    )}
                    <span
                      className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                        sheetState === 'recording'
                          ? 'bg-[#ffb4ab]'
                          : sheetState === 'paused' || sheetState === 'processing'
                          ? 'bg-amber-400'
                          : sheetState === 'ready'
                          ? 'bg-emerald-400'
                          : sheetState === 'error'
                          ? 'bg-rose-500'
                          : 'bg-slate-400'
                      }`}
                    />
                  </span>
                  <span
                    className={`text-[11px] font-medium ${
                      sheetState === 'recording'
                        ? 'text-[#ffb4ab]'
                        : sheetState === 'paused' || sheetState === 'processing'
                        ? 'text-amber-300'
                        : sheetState === 'ready'
                        ? 'text-emerald-300'
                        : sheetState === 'error'
                        ? 'text-rose-300'
                        : 'text-slate-300'
                    }`}
                  >
                    {sheetState === 'recording'
                      ? 'در حال شنود و ضبط زنده...'
                      : sheetState === 'paused'
                      ? 'ضبط موقتاً متوقف گردید'
                      : sheetState === 'processing'
                      ? 'متوقف شده / پردازش و استخراج هوشمند...'
                      : sheetState === 'ready'
                      ? 'صوت تحلیل و اطلاعات استخراج شد'
                      : sheetState === 'error'
                      ? 'نیاز به بررسی یا تلاش مجدد'
                      : 'آماده برای ضبط پیام صوتی جدید'}
                  </span>
                </div>
                <div
                  dir="ltr"
                  className="font-mono text-[12px] text-[#f1cb83] tracking-widest font-semibold px-2 py-0.5 rounded-lg bg-[#050b17]/80 border border-[#f1cb83]/30 shadow-inner"
                >
                  {formatTimerClock(seconds)}
                </div>
              </div>

              {/* Error Banner with Retry button */}
              {errorMessage && (
                <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-400/40 text-rose-200 text-[11px] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-rose-300">
                      error
                    </span>
                    <span>{errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggleRecording()}
                    className="px-2.5 py-1 rounded-lg bg-rose-500/25 border border-rose-400/50 text-white font-bold shrink-0 cursor-pointer"
                  >
                    تلاش مجدد
                  </button>
                </div>
              )}

              {/* Audio Waveform Visualizer & Big Golden Mic Button */}
              <div className="flex flex-col items-center justify-center py-1 gap-2.5 relative">
                {/* 12-Bar Real AnalyserNode Waveform Display */}
                <div className="w-full h-11 flex items-center justify-center gap-1.5 px-3 bg-[#050b17]/70 border border-[#f1cb83]/15 backdrop-blur-md rounded-xl overflow-hidden">
                  {waveformLevels.map((lvl, idx) => {
                    const heightPx =
                      sheetState === 'recording'
                        ? Math.max(6, Math.round((lvl / 100) * 34))
                        : 6;
                    const isBlueBar = idx === 3 || idx === 5 || idx === 7 || idx === 10;
                    return (
                      <span
                        key={idx}
                        style={{ height: `${heightPx}px` }}
                        className={`w-1 rounded-full transition-all duration-100 ${
                          isBlueBar
                            ? 'bg-[#b8c5f5] shadow-[0_0_8px_#b8c5f5]'
                            : 'bg-[#f1cb83] shadow-[0_0_8px_#f1cb83]'
                        }`}
                      />
                    );
                  })}
                </div>

                {/* Big Golden Microphone Button with Interactive Glow */}
                <div className="relative flex items-center justify-center my-1">
                  <div
                    style={{ opacity: sheetState === 'recording' ? 0.9 : 0.25 }}
                    className="absolute w-16 h-16 rounded-full bg-[#f1cb83]/30 blur-xl pointer-events-none transition-all duration-300"
                  />
                  {sheetState === 'recording' && (
                    <div className="absolute w-20 h-20 rounded-full border border-[#f1cb83]/35 animate-ping pointer-events-none opacity-50" />
                  )}
                  <button
                    type="button"
                    aria-label="کلید ضبط صدا"
                    onClick={() => void handleToggleRecording()}
                    className="relative z-10 w-14 h-14 rounded-full bg-gradient-to-tr from-[#d4af37] via-[#f1cb83] to-[#ffdea3] flex items-center justify-center text-[#402d00] shadow-[0_0_24px_rgba(241,203,131,0.6),0_0_8px_rgba(255,255,255,0.4)] active:scale-90 hover:scale-105 transition-all duration-300 border border-white/40 group cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[28px] font-bold group-hover:scale-110 transition-transform">
                      {sheetState === 'recording' ? 'stop' : 'mic'}
                    </span>
                  </button>
                </div>

                {/* Audio Controls (Start/Pause/Resume & Delete/Reset) */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePauseResumeRecording}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0a152d]/70 border border-white/10 hover:border-[#f1cb83]/40 text-[#dae2ff] hover:text-[#f1cb83] active:scale-95 transition-all text-[11px] font-medium shadow-sm cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[15px] text-[#b8c5f5]">
                      {sheetState === 'recording' ? 'pause' : 'play_arrow'}
                    </span>
                    <span>
                      {sheetState === 'recording'
                        ? 'مکث'
                        : sheetState === 'paused'
                        ? 'ادامه ضبط'
                        : seconds > 0
                        ? 'ضبط مجدد'
                        : 'شروع'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleResetAndClearRecording()}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0a152d]/70 border border-[#ffb4ab]/30 text-[#ffb4ab] hover:bg-[#ffb4ab]/15 active:scale-95 transition-all text-[11px] font-medium shadow-sm hover:shadow-[0_0_10px_rgba(255,180,171,0.25)] cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[15px]">delete</span>
                    <span>حذف و ضبط مجدد</span>
                  </button>
                </div>
              </div>

              {/* AI Real-time Transcription & Editable Box */}
              <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-[#050b17]/70 border border-[#f1cb83]/20 backdrop-blur-xl transition-all">
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-white/5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded-full bg-[#f1cb83]/10 border border-[#f1cb83]/30 flex items-center justify-center shrink-0">
                      <span
                        className={`material-symbols-outlined text-[13px] text-[#f1cb83] ${
                          sheetState === 'processing' ? 'animate-spin' : ''
                        }`}
                      >
                        {sheetState === 'processing' ? 'progress_activity' : 'auto_awesome'}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#d1c5b4] font-medium truncate">
                      رونویسی هوشمند مکالمه
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={sheetState === 'processing' || !transcript.trim()}
                      onClick={() => void runAiExtractionOnText(transcript, recordedBlob)}
                      className="text-[11px] font-medium text-[#f1cb83] bg-[#0a152d]/80 hover:bg-[#f1cb83]/15 disabled:opacity-40 border border-[#f1cb83]/35 hover:border-[#f1cb83]/60 px-2.5 py-1 rounded-full inline-flex items-center gap-1 cursor-pointer backdrop-blur-md transition-all duration-300 active:scale-95 whitespace-nowrap shadow-[0_0_10px_rgba(241,203,131,0.15)] group"
                    >
                      <span className="material-symbols-outlined text-[13px] text-[#f1cb83] group-hover:rotate-180 transition-transform duration-500">
                        sync
                      </span>
                      <span>تحلیل مجدد</span>
                    </button>

                    <div
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold backdrop-blur-md whitespace-nowrap border ${
                        sheetState === 'processing'
                          ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300 animate-pulse'
                          : transcript.trim()
                          ? 'bg-emerald-500/10 border-emerald-400/40 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
                          : 'bg-white/5 border-white/10 text-slate-400'
                      }`}
                    >
                      <span className="relative flex h-1.5 w-1.5">
                        <span
                          className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                            sheetState === 'processing'
                              ? 'bg-cyan-400'
                              : transcript.trim()
                              ? 'bg-emerald-400'
                              : 'bg-slate-400'
                          }`}
                        />
                      </span>
                      <span>
                        {sheetState === 'processing'
                          ? 'پردازش AI...'
                          : transcript.trim()
                          ? usedGeminiBadge
                            ? 'پردازش Gemini ✓'
                            : 'پردازش و استخراج شد ✓'
                          : 'آماده دریافت'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Editable Transcript Area with Guillemets */}
                <div
                  onClick={() => setIsEditingTranscript(true)}
                  className="p-2.5 rounded-lg bg-[#0a152d]/70 border border-[#f1cb83]/15 focus-within:border-[#f1cb83]/50 text-[#dae2ff] text-[13px] leading-relaxed relative shadow-inner transition-colors"
                >
                  {isEditingTranscript || transcript.trim().length > 0 ? (
                    <div className="flex items-start gap-1">
                      <span className="text-[#f1cb83]/80 font-serif text-[15px] font-bold select-none">
                        «
                      </span>
                      <textarea
                        rows={2}
                        value={transcript}
                        onChange={(e) => {
                          setTranscript(e.target.value);
                          isDirtyRef.current = true;
                        }}
                        placeholder="متن فرمان صوتی را اینجا بنویسید یا ویرایش کنید (مثلاً: فردا ساعت ۱۱ صبح با آقای رضوان درباره پرونده F-002 تماس بگیرم، خیلی فوریه)..."
                        className="w-full bg-transparent border-none outline-none focus:ring-0 p-0 text-[13px] text-[#dae2ff] placeholder:text-[#d1c5b4]/50 resize-none leading-relaxed"
                      />
                      <span className="text-[#f1cb83]/80 font-serif text-[15px] font-bold self-end select-none">
                        »
                      </span>
                    </div>
                  ) : (
                    <div className="cursor-text text-[#d1c5b4]/80 text-[12px]">
                      <span className="text-[#f1cb83]/80 font-serif text-[15px] font-bold ml-1">
                        «
                      </span>
                      <span>
                        در انتظار فرمان صوتی... دکمه طلایی میکروفون را لمس کنید یا برای تایپ دستی
                        اینجا بزنید.
                      </span>
                      <span className="text-[#f1cb83]/80 font-serif text-[15px] font-bold mr-1">
                        »
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Loading Skeleton during AI Processing */}
            {sheetState === 'processing' && (
              <div className="p-3 rounded-xl bg-[#0a152d]/50 border border-[#f1cb83]/20 space-y-2 animate-pulse">
                <div className="h-3 w-2/5 bg-[#f1cb83]/20 rounded" />
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-8 bg-white/10 rounded-lg" />
                  <div className="h-8 bg-white/10 rounded-lg" />
                </div>
              </div>
            )}

            {/* SECTION 2: Linked Property & Contact */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#d1c5b4] font-medium">
                  اتصال به پرونده سرمایه‌گذاری و مخاطب:
                </span>
                {(aiFilledFields.includes('linkedProperty') ||
                  aiFilledFields.includes('linkedContact')) && (
                  <span className="text-[11px] text-[#b8c5f5] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#b8c5f5] animate-ping" />
                    تشخیص خودکار
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 items-center">
                {/* Property Chip */}
                {selectedProperty && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0a152d]/80 border border-[#f1cb83]/50 backdrop-blur-md text-[#dae2ff] text-[11px] shadow-[0_0_10px_rgba(241,203,131,0.2)]">
                    <span className="material-symbols-outlined text-[15px] text-[#f1cb83]">
                      check_circle
                    </span>
                    <span className="truncate max-w-[175px]">
                      ملک {selectedProperty.code} ({selectedProperty.title})
                    </span>
                    <button
                      type="button"
                      aria-label="حذف پیوند ملک"
                      onClick={() => {
                        setLinkedPropertyId('');
                        isDirtyRef.current = true;
                      }}
                      className="text-[#d1c5b4] hover:text-rose-300 ml-0.5 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Contact Chip (Applicant or Collaborator) */}
                {(selectedApplicant || selectedCollaborator) && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0a152d]/80 border border-[#b8c5f5]/50 backdrop-blur-md text-[#dae2ff] text-[11px] shadow-[0_0_10px_rgba(184,197,245,0.2)]">
                    <span className="material-symbols-outlined text-[15px] text-[#b8c5f5]">
                      group
                    </span>
                    <span className="truncate max-w-[160px]">
                      {selectedApplicant
                        ? `${selectedApplicant.name} (${selectedApplicant.code})`
                        : `${selectedCollaborator?.name} (${selectedCollaborator?.code})`}
                    </span>
                    <button
                      type="button"
                      aria-label="حذف پیوند مخاطب"
                      onClick={() => {
                        setLinkedContactType('');
                        setLinkedContactId('');
                        isDirtyRef.current = true;
                      }}
                      className="text-[#d1c5b4] hover:text-rose-300 ml-0.5 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Custom Code Links if any */}
                {customLinks.map((code) => (
                  <div
                    key={code}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0a152d]/80 border border-[#f1cb83]/40 text-[#f1cb83] text-[11px]"
                  >
                    <span>پرونده {code}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setCustomLinks((prev) => prev.filter((item) => item !== code))
                      }
                      className="text-[#d1c5b4] hover:text-rose-300 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {/* Add / Change Linkage Button */}
                <button
                  type="button"
                  onClick={() => setIsLinkPickerOpen(!isLinkPickerOpen)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0a152d]/40 border border-[#f1cb83]/25 text-[#f1cb83] hover:bg-[#f1cb83]/15 active:scale-95 transition-all text-[11px] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  <span>افزودن پیوند</span>
                </button>
              </div>

              {/* Disambiguation Strip when multiple candidates matched */}
              {(propertyCandidates.length > 1 || contactCandidates.length > 1) && (
                <div className="p-2 rounded-xl bg-[#050b17]/60 border border-[#b8c5f5]/25 space-y-1.5 mt-1">
                  <span className="block text-[10px] text-[#b8c5f5]">
                    موارد مشابه تشخیص‌داده‌شده در سامانه (برای تغییر ضربه بزنید):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {propertyCandidates.map((cand) => (
                      <button
                        key={cand.id}
                        type="button"
                        onClick={() => setLinkedPropertyId(cand.id)}
                        className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer ${
                          linkedPropertyId === cand.id
                            ? 'bg-[#f1cb83]/25 border-[#f1cb83] text-[#f1cb83] font-bold'
                            : 'bg-white/5 border-white/10 text-slate-300'
                        }`}
                      >
                        {cand.code}: {cand.title}
                      </button>
                    ))}
                    {contactCandidates.map((cand) => (
                      <button
                        key={`${cand.type}_${cand.id}`}
                        type="button"
                        onClick={() => {
                          setLinkedContactType(cand.type);
                          setLinkedContactId(cand.id);
                        }}
                        className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer ${
                          linkedContactId === cand.id
                            ? 'bg-[#b8c5f5]/25 border-[#b8c5f5] text-[#b8c5f5] font-bold'
                            : 'bg-white/5 border-white/10 text-slate-300'
                        }`}
                      >
                        {cand.name} ({cand.code})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Searchable Real Entity Picker Drawer */}
              {isLinkPickerOpen && (
                <div className="mt-1.5 p-3 rounded-xl bg-[#050b17]/90 border border-[#f1cb83]/35 space-y-2.5 shadow-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#f1cb83]">
                      انتخاب پرونده یا مخاطب از بانک اطلاعاتی کلید
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsLinkPickerOpen(false)}
                      className="text-xs text-[#d1c5b4] hover:text-white cursor-pointer"
                    >
                      بستن ✕
                    </button>
                  </div>
                  <input
                    type="text"
                    value={linkSearchQuery}
                    onChange={(e) => setLinkSearchQuery(e.target.value)}
                    placeholder="جستجوی کد پرونده (F-002)، نام مشتری یا همکار..."
                    className="w-full h-8 px-2.5 rounded-lg bg-[#0a152d] border border-[#f1cb83]/25 text-xs text-white outline-none"
                  />
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {filteredLinkCatalog.props.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setLinkedPropertyId(p.id);
                          setIsLinkPickerOpen(false);
                          isDirtyRef.current = true;
                        }}
                        className="w-full p-1.5 rounded-lg bg-white/5 hover:bg-[#f1cb83]/15 flex items-center justify-between text-right text-[11px] cursor-pointer"
                      >
                        <span className="text-[#dae2ff] truncate">
                          <strong className="text-[#f1cb83] ml-1">{p.code}</strong>
                          {p.title}
                        </span>
                        <span className="text-[10px] text-[#d1c5b4] shrink-0">{p.city}</span>
                      </button>
                    ))}
                    {filteredLinkCatalog.apps.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setLinkedContactType('applicant');
                          setLinkedContactId(a.id);
                          setIsLinkPickerOpen(false);
                          isDirtyRef.current = true;
                        }}
                        className="w-full p-1.5 rounded-lg bg-white/5 hover:bg-[#b8c5f5]/15 flex items-center justify-between text-right text-[11px] cursor-pointer"
                      >
                        <span className="text-[#dae2ff] truncate">
                          <strong className="text-sky-300 ml-1">{a.code}</strong>
                          {a.name}
                        </span>
                        <span className="text-[10px] text-sky-300 shrink-0">متقاضی</span>
                      </button>
                    ))}
                    {filteredLinkCatalog.cols.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setLinkedContactType('collaborator');
                          setLinkedContactId(c.id);
                          setIsLinkPickerOpen(false);
                          isDirtyRef.current = true;
                        }}
                        className="w-full p-1.5 rounded-lg bg-white/5 hover:bg-emerald-500/15 flex items-center justify-between text-right text-[11px] cursor-pointer"
                      >
                        <span className="text-[#dae2ff] truncate">
                          <strong className="text-emerald-300 ml-1">{c.code}</strong>
                          {c.name} ({c.agencyName || c.role})
                        </span>
                        <span className="text-[10px] text-emerald-300 shrink-0">همکار</span>
                      </button>
                    ))}
                    {filteredLinkCatalog.props.length === 0 &&
                      filteredLinkCatalog.apps.length === 0 &&
                      filteredLinkCatalog.cols.length === 0 && (
                        <div className="py-2 text-center text-[11px] text-[#d1c5b4]/70">
                          موردی یافت نشد.
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 3: Action Category (Multi-select toggleable grid) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#d1c5b4] font-medium">دسته‌بندی اقدام:</span>
                {aiFilledFields.includes('categories') && (
                  <span className="text-[10px] text-[#f1cb83]/85">انتخاب هوشمند AI</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {CATEGORY_OPTIONS.map((cat) => {
                  const active = selectedCategories.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => handleToggleCategory(cat.id)}
                      className={`flex items-center justify-between p-2 rounded-xl text-[11px] text-right backdrop-blur-md active:scale-95 transition-all cursor-pointer ${
                        active
                          ? 'bg-[#f1cb83]/15 border border-[#f1cb83]/45 text-[#f1cb83] font-semibold shadow-[0_0_12px_rgba(241,203,131,0.2)]'
                          : 'bg-[#0a152d]/40 border border-white/10 hover:border-[#f1cb83]/40 text-[#d1c5b4] hover:text-[#dae2ff]'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className={`material-symbols-outlined text-[16px] shrink-0 ${
                            active ? 'text-[#f1cb83]' : 'text-[#b8c5f5]'
                          }`}
                        >
                          {cat.icon}
                        </span>
                        <span className="truncate">{cat.label}</span>
                      </div>
                      {active && (
                        <span className="material-symbols-outlined text-[16px] text-[#f1cb83]">
                          check
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SECTION 4: Due Date, Time & Priority */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#d1c5b4] font-medium">
                  زمان یادآوری و اولویت اجرایی:
                </span>
                <button
                  type="button"
                  onClick={() => setSyncWithPhoneCalendar(!syncWithPhoneCalendar)}
                  className={`text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 border transition-all cursor-pointer ${
                    syncWithPhoneCalendar
                      ? 'text-amber-300 bg-amber-400/15 border-amber-400/40 shadow-[0_0_8px_rgba(251,191,36,0.2)]'
                      : 'text-slate-400 bg-white/5 border-white/10'
                  }`}
                >
                  <span className="material-symbols-outlined text-[12px]">
                    {syncWithPhoneCalendar ? 'event_available' : 'event_busy'}
                  </span>
                  <span>همگام با تقویم گوشی</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {/* Solar Date Selector */}
                <button
                  type="button"
                  onClick={() => setIsDatePickerOpen(true)}
                  className={`flex items-center gap-2 p-2 rounded-xl bg-[#0a152d]/60 border backdrop-blur-md text-[#dae2ff] hover:border-[#f1cb83]/60 transition-all text-right cursor-pointer ${
                    isPastWarning
                      ? 'border-amber-400/70 shadow-[0_0_10px_rgba(251,191,36,0.2)]'
                      : 'border-[#f1cb83]/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] text-[#f1cb83] shrink-0">
                    calendar_month
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] text-[#d1c5b4] leading-none flex items-center gap-1">
                      <span>تاریخ شمسی</span>
                      {isDefaultDate && (
                        <span className="text-[9px] text-amber-300">(پیش‌فرض)</span>
                      )}
                    </span>
                    <span className="text-[11px] font-semibold truncate mt-1 text-[#f1cb83]">
                      {dateHumanDisplay}
                    </span>
                  </div>
                </button>

                {/* Time Selector */}
                <button
                  type="button"
                  onClick={() => setIsTimePickerOpen(!isTimePickerOpen)}
                  className={`flex items-center gap-2 p-2 rounded-xl bg-[#0a152d]/60 border backdrop-blur-md text-[#dae2ff] hover:border-[#f1cb83]/60 transition-all text-right cursor-pointer ${
                    dateTimeNeedsConfirm
                      ? 'border-amber-400/70 shadow-[0_0_10px_rgba(251,191,36,0.2)]'
                      : 'border-[#f1cb83]/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] text-[#f1cb83] shrink-0">
                    schedule
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] text-[#d1c5b4] leading-none flex items-center gap-1">
                      <span>ساعت اعلان</span>
                      {isDefaultTime && (
                        <span className="text-[9px] text-amber-300">(پیش‌فرض)</span>
                      )}
                    </span>
                    <span className="text-[11px] font-semibold truncate mt-1 text-[#f1cb83]">
                      {timePersianDisplay}
                    </span>
                  </div>
                </button>
              </div>

              {/* Interactive Time Picker Drawer */}
              {isTimePickerOpen && (
                <div className="p-2.5 rounded-xl bg-[#050b17]/90 border border-[#f1cb83]/35 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-[#f1cb83]">
                      انتخاب سریع یا دقیق ساعت یادآور:
                    </span>
                    <input
                      type="time"
                      value={time24}
                      onChange={(e) => {
                        setTime24(e.target.value);
                        setIsDefaultTime(false);
                        setDateTimeNeedsConfirm(false);
                        isDirtyRef.current = true;
                      }}
                      className="h-7 px-2 rounded bg-[#0a152d] border border-[#f1cb83]/40 text-xs text-[#f1cb83] font-bold"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {QUICK_TIME_PRESETS.map((preset) => (
                      <button
                        key={preset.time}
                        type="button"
                        onClick={() => {
                          setTime24(preset.time);
                          setIsDefaultTime(false);
                          setDateTimeNeedsConfirm(false);
                          setIsTimePickerOpen(false);
                          isDirtyRef.current = true;
                        }}
                        className={`py-1 px-1.5 rounded-lg text-[10px] font-semibold border cursor-pointer ${
                          time24 === preset.time
                            ? 'bg-[#f1cb83] text-[#402d00] border-[#f1cb83]'
                            : 'bg-white/5 text-[#dae2ff] border-white/10 hover:border-[#f1cb83]/40'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Ambiguous or Past Date/Time Warning Banner */}
              {(dateTimeNeedsConfirm || isPastWarning) && (
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-400/40 text-amber-200 text-[10px] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-amber-300">
                      warning
                    </span>
                    <span>
                      {isPastWarning
                        ? 'زمان انتخابی مربوط به گذشته است؛ لطفاً ساعت یا تاریخ را بررسی کنید.'
                        : 'ساعت یا تاریخ به صورت پیش‌فرض تنظیم شد؛ در صورت نیاز تغییر دهید.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDateTimeNeedsConfirm(false);
                      setIsPastWarning(false);
                    }}
                    className="px-2 py-0.5 rounded bg-amber-400/25 border border-amber-300/40 text-amber-100 font-bold shrink-0 cursor-pointer"
                  >
                    تأیید زمان
                  </button>
                </div>
              )}

              {/* Priority Chips (3 Levels) */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setPriority('urgent');
                    isDirtyRef.current = true;
                  }}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] whitespace-nowrap active:scale-95 transition-all cursor-pointer ${
                    priority === 'urgent'
                      ? 'bg-[#ffb4ab]/20 border border-[#ffb4ab]/50 text-[#ffb4ab] font-semibold shadow-[0_0_10px_rgba(255,180,171,0.2)]'
                      : 'bg-[#0a152d]/40 border border-white/10 text-[#d1c5b4] hover:text-[#dae2ff]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">bolt</span>
                  <span>فوری و بحرانی</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPriority('normal');
                    isDirtyRef.current = true;
                  }}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] whitespace-nowrap active:scale-95 transition-all cursor-pointer ${
                    priority === 'normal'
                      ? 'bg-[#f1cb83]/20 border border-[#f1cb83]/50 text-[#f1cb83] font-semibold shadow-[0_0_10px_rgba(241,203,131,0.2)]'
                      : 'bg-[#0a152d]/40 border border-white/10 text-[#d1c5b4] hover:text-[#dae2ff]'
                  }`}
                >
                  <span>عادی</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPriority('low');
                    isDirtyRef.current = true;
                  }}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] whitespace-nowrap active:scale-95 transition-all cursor-pointer ${
                    priority === 'low'
                      ? 'bg-[#b8c5f5]/20 border border-[#b8c5f5]/50 text-[#b8c5f5] font-semibold shadow-[0_0_10px_rgba(184,197,245,0.2)]'
                      : 'bg-[#0a152d]/40 border border-white/10 text-[#d1c5b4] hover:text-[#dae2ff]'
                  }`}
                >
                  <span>کم‌اهمیت</span>
                </button>
              </div>
            </div>

            {/* SECTION 5: Notification & Sync Settings */}
            <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-[#0a152d]/50 border border-white/10 backdrop-blur-xl">
              {/* SMS & Push Switch */}
              <div
                onClick={() => setSmsNotification(!smsNotification)}
                className="flex items-center justify-between gap-2 cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-[17px] text-[#f1cb83] shrink-0">
                    notifications_active
                  </span>
                  <span className="text-[11px] text-[#dae2ff] truncate">
                    اعلان پیامکی و پوش نوتیفیکیشن
                  </span>
                </div>
                <div
                  className={`w-9 h-5 rounded-full relative p-0.5 shrink-0 flex items-center transition-all ${
                    smsNotification
                      ? 'bg-[#f1cb83] shadow-[0_0_10px_rgba(241,203,131,0.5)]'
                      : 'bg-white/20'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full shadow-sm transition-transform ${
                      smsNotification ? 'bg-[#402d00] mr-auto' : 'bg-white/60 ml-auto'
                    }`}
                  />
                </div>
              </div>

              {/* Register in Portfolio Cartable Switch */}
              <div
                onClick={() => setRegisterInCartable(!registerInCartable)}
                className="flex items-center justify-between gap-2 cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-[17px] text-[#b8c5f5] shrink-0">
                    inventory_2
                  </span>
                  <span className="text-[11px] text-[#dae2ff] truncate">
                    ثبت مستقیم در کارتابل {cartableTargetCode}
                  </span>
                </div>
                <div
                  className={`w-9 h-5 rounded-full relative p-0.5 shrink-0 flex items-center transition-all ${
                    registerInCartable
                      ? 'bg-[#f1cb83] shadow-[0_0_10px_rgba(241,203,131,0.5)]'
                      : 'bg-white/20'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full shadow-sm transition-transform ${
                      registerInCartable ? 'bg-[#402d00] mr-auto' : 'bg-white/60 ml-auto'
                    }`}
                  />
                </div>
              </div>

              {/* Live Calendar Sync Notice */}
              <div className="pt-1 border-t border-white/5 flex items-center gap-1.5 text-[11px] text-[#f1cb83]/90">
                <span className="material-symbols-outlined text-[14px]">alarm</span>
                <span className="truncate">
                  ثبت خودکار در تقویم و آلارم گوشی: تنظیم شده برای ساعت {timePersianDisplay} (
                  {dateHumanDisplay})
                </span>
              </div>
            </div>

            {/* Modal Bottom Sticky Actions */}
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void handleSaveReminder()}
                className="relative overflow-hidden w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#d4af37] via-[#f1cb83] to-[#ffdea3] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-[#402d00] text-[15px] font-bold flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(241,203,131,0.45)] border border-white/40 active:scale-[0.98] transition-all duration-300 whitespace-nowrap cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">
                  {sheetState === 'saving' ? 'progress_activity' : 'schedule'}
                </span>
                <span>
                  {sheetState === 'saving'
                    ? 'در حال ذخیره‌سازی و ثبت در تقویم...'
                    : 'ذخیره هوشمند و زمان‌بندی یادآور'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void handleSafeDismiss()}
                className="w-full py-2 px-4 rounded-xl bg-[#0a152d]/40 border border-white/10 text-[#d1c5b4] hover:text-[#dae2ff] hover:bg-white/5 text-[11px] flex items-center justify-center transition-colors backdrop-blur-md active:scale-95 cursor-pointer"
              >
                <span>انصراف و بستن</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Jalali Date Picker Sub-Modal */}
      {isDatePickerOpen && (
        <JalaliDatePickerModal
          initialValue={jalaliDate}
          title="انتخاب تاریخ شمسی یادآور"
          onClose={() => setIsDatePickerOpen(false)}
          onSelect={(d) => {
            setJalaliDate(d);
            setIsDefaultDate(false);
            setDateTimeNeedsConfirm(false);
            setIsPastWarning(false);
            setIsDatePickerOpen(false);
            isDirtyRef.current = true;
          }}
        />
      )}
    </div>
  );
};
