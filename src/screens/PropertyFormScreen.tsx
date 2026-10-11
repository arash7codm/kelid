import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { JalaliDatePickerModal } from '../components/JalaliDatePickerModal';
import { AmbientBackground, KelidLogoIcon } from '../components/Layout';
import { PropertyStatus } from '../config';
import {
  generateNextCode,
  getMediaBlobUrl,
  saveMediaBlob,
  saveProperty,
} from '../db/repositories';
import {
  db,
  PropertyDocumentItem,
  PropertyPhotoItem,
  PropertyRecord,
} from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { markReturningToList } from '../motion';
import { aiService, sanitizeAiError } from '../services/ai';
import { triggerPhoneCall } from '../services/maps';
import { VoiceSessionController } from '../services/voice';
import {
  amountToTomanWords,
  areaToPersianWords,
  formatWithSeparator,
  getTodayJalali,
  isJalaliDateOverdue,
  parseCoordinatesFromText,
  parseNumericInput,
  toEnglishDigits,
  toPersianDigits,
  validateIranianMobile,
} from '../utils/persian';

export const PropertyFormScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    snapshot,
    currentUser,
    refreshSnapshot,
    showToast,
    askConfirm,
    askPermission,
    openMapChooser,
  } = useApp();

  const isManager = currentUser.role === 'مدیر';
  const isViewer = currentUser.role === 'بیننده';

  // Auto code & date
  const [code, setCode] = useState('F-001');
  const [registerDate, setRegisterDate] = useState(getTodayJalali(true));

  // Basic Required & Core Fields (New mode starts empty!)
  const [title, setTitle] = useState('');
  const [propertyType, setPropertyType] = useState<'زمین' | 'ویلا' | 'آپارتمان' | 'باغ' | 'تجاری'>('زمین');
  const [status, setStatus] = useState<PropertyStatus>('فعال');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [deedType, setDeedType] = useState('تک‌برگ عرصه و اعیان (شش دانگ)');
  const [deedCustom, setDeedCustom] = useState('');
  const [zoningStatus, setZoningStatus] = useState('');
  const [zoningCustom, setZoningCustom] = useState('');

  // Two-Way Pricing
  const [areaStr, setAreaStr] = useState('');
  const [ppmStr, setPpmStr] = useState('');
  const [totalPriceStr, setTotalPriceStr] = useState('');
  const [negotiable, setNegotiable] = useState(true);

  // Extended Details Accordion (10 sub-sections + type-specific)
  const [extendedOpen, setExtendedOpen] = useState(false);
  const [province, setProvince] = useState('');
  const [accessPath, setAccessPath] = useState('');
  const [lotLabel, setLotLabel] = useState('');
  const [lotShape, setLotShape] = useState('مستطیل');
  const [lengthStr, setLengthStr] = useState('');
  const [widthStr, setWidthStr] = useState('');
  const [frontageCount, setFrontageCount] = useState('');
  const [passageWidthStr, setPassageWidthStr] = useState('');
  const [orientation, setOrientation] = useState('');
  const [landUsage, setLandUsage] = useState('');
  const [structureStatus, setStructureStatus] = useState('');
  const [zoningAuth, setZoningAuth] = useState<string[]>([]);
  const [fencingDesc, setFencingDesc] = useState('');

  // 4 manual fields in Density/Floors/Potential (empty by default, no ماده ۱۰۰ note)
  const [zoningDensity, setZoningDensity] = useState('');
  const [maxLotCoverage, setMaxLotCoverage] = useState('');
  const [densityFloors, setDensityFloors] = useState('');
  const [permitStageType, setPermitStageType] = useState('');

  const [utilLocation, setUtilLocation] = useState('');
  const [utilities, setUtilities] = useState({
    water: false,
    power: false,
    gas: false,
    phone: false,
    fiber: false,
  });
  const [utilDesc, setUtilDesc] = useState('');

  const [inquiryStatus, setInquiryStatus] = useState('');
  const [permitNo, setPermitNo] = useState('');
  const [substructureAreaStr, setSubstructureAreaStr] = useState('');
  const [permitIssueDate, setPermitIssueDate] = useState('');
  const [permitExpiryDate, setPermitExpiryDate] = useState('');
  const [dismissPermitWarning, setDismissPermitWarning] = useState(false);

  const [commissionRate, setCommissionRate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');

  const [referrerCollaboratorId, setReferrerCollaboratorId] = useState('');
  const [contactPartnerName, setContactPartnerName] = useState('');
  const [contactSource, setContactSource] = useState('همکار معتمد');
  const [lastContactDate, setLastContactDate] = useState('');
  const [nextFollowupDate, setNextFollowupDate] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  // Type-specific fields (Villa / Apartment / Commercial)
  const [builtAreaStr, setBuiltAreaStr] = useState('');
  const [roomsCountStr, setRoomsCountStr] = useState('');
  const [buildingAgeStr, setBuildingAgeStr] = useState('');
  const [villaFloors, setVillaFloors] = useState('');
  const [floorNumberStr, setFloorNumberStr] = useState('');
  const [totalFloorsStr, setTotalFloorsStr] = useState('');
  const [hasParking, setHasParking] = useState(true);
  const [hasStorage, setHasStorage] = useState(true);
  const [hasElevator, setHasElevator] = useState(true);
  const [commercialFrontageStr, setCommercialFrontageStr] = useState('');
  const [ceilingHeightStr, setCeilingHeightStr] = useState('');
  const [hasBusinessLicense, setHasBusinessLicense] = useState(false);

  // Location & Voice
  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lng, setLng] = useState<number | undefined>(undefined);
  const [locationSourceUrl, setLocationSourceUrl] = useState<string | undefined>(undefined);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [isGettingGps, setIsGettingGps] = useState(false);
  const [awaitingMapClipboard, setAwaitingMapClipboard] = useState(false);
  const [exactAddress, setExactAddress] = useState('');
  const [voiceNoteMediaId, setVoiceNoteMediaId] = useState<string | undefined>(undefined);
  const [voiceBlobUrl, setVoiceBlobUrl] = useState<string | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [isTranscribingAi, setIsTranscribingAi] = useState(false);

  // Gallery (Photos only) & Documents
  const [photos, setPhotos] = useState<PropertyPhotoItem[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
  const [documents, setDocuments] = useState<PropertyDocumentItem[]>([]);

  // Confidential Owner Info
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');

  // Validation & Unsaved Changes State
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<
    null | 'register' | 'issue' | 'expiry' | 'lastContact' | 'nextFollowup'
  >(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const voiceCtrlRef = useRef<VoiceSessionController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const firstErrorRef = useRef<HTMLDivElement | null>(null);

  // Load Edit Record or Initialize New Code
  useEffect(() => {
    let active = true;
    (async () => {
      if (isEdit && id) {
        const existing = await db.properties.get(id);
        if (existing && active) {
          setCode(existing.code);
          setRegisterDate(existing.registerDate);
          setTitle(existing.title);
          setPropertyType(existing.propertyType);
          setStatus(existing.status);
          setCity(existing.city);
          setDistrict(existing.district);
          setDeedType(existing.deedType);
          setDeedCustom(existing.deedCustom || '');
          setZoningStatus(existing.zoningStatus);
          setZoningCustom(existing.zoningCustom || '');
          setAreaStr(existing.area ? String(existing.area) : '');
          setPpmStr(existing.pricePerMeter ? formatWithSeparator(existing.pricePerMeter, false) : '');
          setTotalPriceStr(existing.totalPrice ? formatWithSeparator(existing.totalPrice, false) : '');
          setNegotiable(existing.negotiable);

          setProvince(existing.province || '');
          setAccessPath(existing.accessPath || '');
          setLotLabel(existing.lotLabel || '');
          setLotShape(existing.lotShape || 'مستطیل');
          setLengthStr(existing.length ? String(existing.length) : '');
          setWidthStr(existing.width ? String(existing.width) : '');
          setFrontageCount(existing.frontageCount || '');
          setPassageWidthStr(existing.passageWidth ? String(existing.passageWidth) : '');
          setOrientation(existing.orientation || '');
          setLandUsage(existing.landUsage || '');
          setStructureStatus(existing.structureStatus || '');
          setZoningAuth(existing.zoningAuth || []);
          setFencingDesc(existing.fencingDesc || '');
          setZoningDensity(existing.zoningDensity || '');
          setMaxLotCoverage(existing.maxLotCoverage || '');
          setDensityFloors(existing.densityFloors || '');
          setPermitStageType(existing.permitStageType || '');
          setUtilLocation(existing.utilLocation || '');
          setUtilities(
            existing.utilities || { water: false, power: false, gas: false, phone: false, fiber: false }
          );
          setUtilDesc(existing.utilDesc || '');
          setInquiryStatus(existing.inquiryStatus || '');
          setPermitNo(existing.permitNo || '');
          setSubstructureAreaStr(existing.substructureArea ? String(existing.substructureArea) : '');
          setPermitIssueDate(existing.permitIssueDate || '');
          setPermitExpiryDate(existing.permitExpiryDate || '');
          setDismissPermitWarning(Boolean(existing.dismissPermitWarning));
          setCommissionRate(existing.commissionRate || '');
          setPaymentMethod(existing.paymentMethod || '');
          setPaymentTerms(existing.paymentTerms || '');
          setReferrerCollaboratorId(existing.referrerCollaboratorId || '');
          setContactPartnerName(existing.contactPartnerName || '');
          setContactSource(existing.contactSource || 'همکار معتمد');
          setLastContactDate(existing.lastContactDate || '');
          setNextFollowupDate(existing.nextFollowupDate || '');
          setInternalNotes(existing.internalNotes || '');

          setBuiltAreaStr(existing.builtArea ? String(existing.builtArea) : '');
          setRoomsCountStr(existing.roomsCount ? String(existing.roomsCount) : '');
          setBuildingAgeStr(existing.buildingAge ? String(existing.buildingAge) : '');
          setVillaFloors(existing.villaFloors || '');
          setFloorNumberStr(existing.floorNumber ? String(existing.floorNumber) : '');
          setTotalFloorsStr(existing.totalFloors ? String(existing.totalFloors) : '');
          setHasParking(existing.hasParking ?? true);
          setHasStorage(existing.hasStorage ?? true);
          setHasElevator(existing.hasElevator ?? true);
          setCommercialFrontageStr(existing.commercialFrontage ? String(existing.commercialFrontage) : '');
          setCeilingHeightStr(existing.ceilingHeight ? String(existing.ceilingHeight) : '');
          setHasBusinessLicense(Boolean(existing.hasBusinessLicense));

          setLat(existing.lat);
          setLng(existing.lng);
          setLocationSourceUrl(existing.locationSourceUrl);
          setExactAddress(existing.exactAddress || existing.voiceTranscript || '');
          setVoiceNoteMediaId(existing.voiceNoteMediaId);
          setPhotos(existing.photos || []);
          setDocuments(existing.documents || []);
          setOwnerName(existing.ownerName || '');
          setOwnerPhone(existing.ownerPhone || '');
        }
      } else {
        const nextCode = await generateNextCode('F');
        if (active) setCode(nextCode);
        // Check draft autosave for new property
        const draftRaw = sessionStorage.getItem('kelid_draft_property_new');
        if (draftRaw && active) {
          try {
            const draft = JSON.parse(draftRaw);
            if (draft.title) setTitle(draft.title);
            if (draft.city) setCity(draft.city);
            if (draft.district) setDistrict(draft.district);
            if (draft.zoningStatus) setZoningStatus(draft.zoningStatus);
            if (draft.areaStr) setAreaStr(draft.areaStr);
            if (draft.ppmStr) setPpmStr(draft.ppmStr);
            if (draft.totalPriceStr) setTotalPriceStr(draft.totalPriceStr);
            if (draft.ownerName) setOwnerName(draft.ownerName);
            if (draft.ownerPhone) setOwnerPhone(draft.ownerPhone);
            if (draft.exactAddress) setExactAddress(draft.exactAddress);
          } catch {
            // ignore
          }
        }
        const params = new URLSearchParams(location.search);
        const collabId = params.get('collaboratorId');
        if (collabId && active) {
          setReferrerCollaboratorId(collabId);
          const col = await db.collaborators.get(collabId);
          if (col && active) {
            setContactPartnerName(col.name);
            setExtendedOpen(true);
          }
        }
      }
    })();
    return () => {
      active = false;
      voiceCtrlRef.current?.cancel();
    };
  }, [id, isEdit, location.search]);

  // Draft Autosave on change for new form
  useEffect(() => {
    if (!isEdit && isDirty) {
      sessionStorage.setItem(
        'kelid_draft_property_new',
        JSON.stringify({
          title,
          city,
          district,
          zoningStatus,
          areaStr,
          ppmStr,
          totalPriceStr,
          ownerName,
          ownerPhone,
        })
      );
    }
  }, [isEdit, isDirty, title, city, district, zoningStatus, areaStr, ppmStr, totalPriceStr, ownerName, ownerPhone]);

  // Resolve Photo & Voice Blob URLs
  useEffect(() => {
    (async () => {
      const map: Record<string, string> = {};
      for (const p of photos) {
        const u = (await getMediaBlobUrl(p.mediaId)) || p.fallbackUrl || '/images/kelarabad-land.jpg';
        map[p.mediaId] = u;
      }
      setPhotoUrls(map);
      if (voiceNoteMediaId) {
        const vu = await getMediaBlobUrl(voiceNoteMediaId);
        setVoiceBlobUrl(vu);
      }
    })();
  }, [photos, voiceNoteMediaId]);

  // Auto-read Clipboard when returning from map app ("روی نقشه")
  useEffect(() => {
    if (!awaitingMapClipboard) return;
    const handleFocus = async () => {
      setAwaitingMapClipboard(false);
      const allowed = await askPermission('clipboard');
      if (!allowed) return;
      try {
        const text = await navigator.clipboard.readText();
        const parsed = parseCoordinatesFromText(text);
        if (parsed) {
          applyNewCoordinates(parsed.lat, parsed.lng, parsed.sourceUrl);
          showToast('مختصات کپی‌شده از نقشه به صورت خودکار دریافت و ثبت شد', 'success');
        } else if (text.includes('goo.gl') || text.includes('maps.app')) {
          showToast('لینک کوتاه قابل رمزگشایی مستقیم نیست؛ لطفاً مختصات عددی را کپی کنید', 'error');
        }
      } catch {
        // user can click چسباندن manually
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [awaitingMapClipboard, askPermission, showToast]);

  // Two-Way Price Calculation Handlers
  const handleAreaChange = (val: string) => {
    setIsDirty(true);
    setAreaStr(val);
    const a = parseNumericInput(val);
    const ppm = parseNumericInput(ppmStr);
    const tot = parseNumericInput(totalPriceStr);
    if (a > 0 && ppm > 0) {
      setTotalPriceStr(formatWithSeparator(a * ppm, false));
    } else if (a > 0 && tot > 0) {
      setPpmStr(formatWithSeparator(Math.round(tot / a), false));
    }
  };

  const handlePpmChange = (val: string) => {
    setIsDirty(true);
    const num = parseNumericInput(val);
    setPpmStr(num ? formatWithSeparator(num, false) : '');
    const a = parseNumericInput(areaStr);
    if (a > 0 && num > 0) {
      setTotalPriceStr(formatWithSeparator(a * num, false));
    }
  };

  const handleTotalChange = (val: string) => {
    setIsDirty(true);
    const tot = parseNumericInput(val);
    setTotalPriceStr(tot ? formatWithSeparator(tot, false) : '');
    const a = parseNumericInput(areaStr);
    if (a > 0 && tot > 0) {
      setPpmStr(formatWithSeparator(Math.round(tot / a), false));
    }
  };

  // Real count of filled fields in Extended Accordion
  const extendedFilledInfo = useMemo(() => {
    const values = [
      province,
      accessPath,
      lotLabel,
      lotShape,
      lotShape === 'مستطیل' ? lengthStr : '',
      lotShape === 'مستطیل' ? widthStr : '',
      frontageCount,
      passageWidthStr,
      orientation,
      landUsage,
      structureStatus,
      zoningAuth.length > 0 ? 'yes' : '',
      fencingDesc,
      zoningDensity,
      maxLotCoverage,
      densityFloors,
      permitStageType,
      utilLocation,
      Object.values(utilities).some(Boolean) ? 'yes' : '',
      utilDesc,
      inquiryStatus,
      permitNo,
      substructureAreaStr,
      permitIssueDate,
      permitExpiryDate,
      commissionRate,
      paymentMethod,
      paymentTerms,
      contactPartnerName || referrerCollaboratorId,
      lastContactDate,
      nextFollowupDate,
      internalNotes,
    ];
    const filled = values.filter((v) => Boolean(v && String(v).trim())).length;
    return { filled, total: values.length, percent: Math.round((filled / values.length) * 100) };
  }, [
    province,
    accessPath,
    lotLabel,
    lotShape,
    lengthStr,
    widthStr,
    frontageCount,
    passageWidthStr,
    orientation,
    landUsage,
    structureStatus,
    zoningAuth,
    fencingDesc,
    zoningDensity,
    maxLotCoverage,
    densityFloors,
    permitStageType,
    utilLocation,
    utilities,
    utilDesc,
    inquiryStatus,
    permitNo,
    substructureAreaStr,
    permitIssueDate,
    permitExpiryDate,
    commissionRate,
    paymentMethod,
    paymentTerms,
    contactPartnerName,
    referrerCollaboratorId,
    lastContactDate,
    nextFollowupDate,
    internalNotes,
  ]);

  // Validation Checks
  const validationErrors = useMemo(() => {
    const basicMissing: Record<string, string> = {};
    const pricingMissing: Record<string, string> = {};
    const ownerMissing: Record<string, string> = {};

    if (!title.trim()) basicMissing.title = 'وارد کردن عنوان آگهی و فایل ملک الزامی است.';
    if (!zoningStatus.trim() && !zoningCustom.trim()) {
      basicMissing.zoningStatus = 'انتخاب یا درج وضعیت بافت شهرداری الزامی است.';
    }

    const areaVal = parseNumericInput(areaStr);
    const ppmVal = parseNumericInput(ppmStr);
    const totVal = parseNumericInput(totalPriceStr);
    if (areaVal <= 0) pricingMissing.area = 'متراژ ملک باید بزرگ‌تر از صفر باشد.';
    if (ppmVal <= 0) pricingMissing.ppm = 'قیمت هر متر مربع الزامی است.';
    if (totVal <= 0) pricingMissing.total = 'قیمت کل ملک الزامی است.';

    if (!ownerName.trim()) ownerMissing.ownerName = 'نام و نام خانوادگی مالک الزامی است.';
    if (ownerPhone.trim() && !validateIranianMobile(ownerPhone)) {
      ownerMissing.ownerPhone = 'شماره تماس مالک باید ۱۱ رقم و با ۰۹ شروع شود.';
    }

    const totalCount =
      Object.keys(basicMissing).length +
      Object.keys(pricingMissing).length +
      Object.keys(ownerMissing).length;

    return {
      basicMissing,
      pricingMissing,
      ownerMissing,
      basicCount: Object.keys(basicMissing).length,
      pricingCount: Object.keys(pricingMissing).length,
      ownerCount: Object.keys(ownerMissing).length,
      totalCount,
    };
  }, [title, zoningStatus, zoningCustom, areaStr, ppmStr, totalPriceStr, ownerName, ownerPhone]);

  // Duplicate Owner Phone Warning
  const duplicateOwnerWarning = useMemo(() => {
    if (!ownerPhone.trim() || !snapshot) return null;
    const clean = toEnglishDigits(ownerPhone).replace(/\D/g, '');
    if (clean.length < 11) return null;
    const match = snapshot.properties.find(
      (p) => p.id !== id && toEnglishDigits(p.ownerPhone).replace(/\D/g, '') === clean
    );
    return match ? `این شماره قبلاً برای مالک پرونده ${match.code} (${match.ownerName}) ثبت شده است.` : null;
  }, [ownerPhone, snapshot, id]);

  // Location Helpers with Undo
  const applyNewCoordinates = (newLat: number, newLng: number, sourceUrl?: string) => {
    const prevLat = lat;
    const prevLng = lng;
    setLat(Number(newLat.toFixed(6)));
    setLng(Number(newLng.toFixed(6)));
    if (sourceUrl) setLocationSourceUrl(sourceUrl);
    setIsDirty(true);

    if (prevLat !== undefined && prevLng !== undefined) {
      showToast('موقعیت جدید جایگزین موقعیت قبلی شد', 'info', () => {
        setLat(prevLat);
        setLng(prevLng);
      });
    }
  };

  const handleGetMyLocation = async () => {
    const allowed = await askPermission('geolocation');
    if (!allowed) return;
    setIsGettingGps(true);
    if (!navigator.geolocation) {
      setIsGettingGps(false);
      showToast('مرورگر شما از مکان‌یاب پشتیبانی نمی‌کند', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsGettingGps(false);
        setGpsAccuracy(Math.round(pos.coords.accuracy));
        applyNewCoordinates(pos.coords.latitude, pos.coords.longitude);
        showToast(
          `موقعیت دقیق GPS با دقت ${toPersianDigits(Math.round(pos.coords.accuracy))} متر ثبت شد`,
          'success'
        );
      },
      () => {
        setIsGettingGps(false);
        showToast('امکان دریافت سیگنال GPS نبود. لطفاً مکان‌یاب گوشی را روشن کرده و دوباره تلاش کنید.', 'error');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handlePasteCoordinates = async () => {
    const allowed = await askPermission('clipboard');
    if (!allowed) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        showToast('حافظه کلیپ‌بورد خالی است', 'error');
        return;
      }
      if (/https?:\/\/(goo\.gl|maps\.app\.goo\.gl)\//i.test(text) && !/(-?\d{2}\.\d+)/.test(text)) {
        showToast('لینک کوتاه گوگل مپ فاقد مختصات عددی است؛ لطفاً لینک کامل یا مختصات را کپی کنید', 'error');
        return;
      }
      const parsed = parseCoordinatesFromText(text);
      if (parsed) {
        applyNewCoordinates(parsed.lat, parsed.lng, parsed.sourceUrl);
        showToast('مختصات از کلیپ‌بورد استخراج و ثبت شد', 'success');
      } else {
        showToast('فرمت مختصات یا لینک نقشه در کلیپ‌بورد شناسایی نشد', 'error');
      }
    } catch {
      showToast('عدم دسترسی به کلیپ‌بورد مرورگر', 'error');
    }
  };

  // Voice Dictation for Address
  const handleToggleVoiceRecord = async () => {
    if (isRecordingVoice) {
      await voiceCtrlRef.current?.stop();
      setIsRecordingVoice(false);
      return;
    }
    if (voiceNoteMediaId) {
      const ok = await askConfirm({
        title: 'ضبط مجدد توضیحات صوتی؟',
        message: 'فایل صوتی قبلی جایگزین خواهد شد. آیا مطمئن هستید؟',
        confirmLabel: 'بله، ضبط مجدد',
      });
      if (!ok) return;
    }
    const allowed = await askPermission('microphone');
    if (!allowed) return;

    const ctrl = new VoiceSessionController({
      onDurationTick: (sec) => setVoiceSeconds(sec),
      onLiveTranscript: (txt) => {
        setExactAddress(txt);
        setIsDirty(true);
      },
      onSilenceTimeout: (msg) => {
        setIsRecordingVoice(false);
        showToast(msg, 'info');
      },
      onRecordingComplete: async ({ blob, transcript }) => {
        setIsRecordingVoice(false);
        if (blob) {
          const saved = await saveMediaBlob(blob, `voice_${code}_${Date.now()}.webm`);
          setVoiceNoteMediaId(saved.id);
        }
        if (transcript) {
          setExactAddress((prev) => (prev ? `${prev} ${transcript}` : transcript));
          setIsDirty(true);
        }
        showToast('ویس توضیحات آدرس ذخیره شد', 'success');
      },
      onError: (err) => {
        setIsRecordingVoice(false);
        showToast(err, 'error');
      },
    });
    voiceCtrlRef.current = ctrl;
    if (await ctrl.start()) {
      setVoiceSeconds(0);
      setIsRecordingVoice(true);
    }
  };

  const handleAiReTranscribe = async () => {
    if (!voiceNoteMediaId) {
      showToast('ابتدا یک یادداشت صوتی ضبط کنید', 'info');
      return;
    }
    const blobRec = await db.mediaBlobs.get(voiceNoteMediaId);
    if (!blobRec?.blob) {
      showToast('فایل صوتی در حافظه یافت نشد', 'error');
      return;
    }
    setIsTranscribingAi(true);
    try {
      const txt = await aiService.transcribeAudio(blobRec.blob);
      if (txt) {
        setExactAddress(txt);
        setIsDirty(true);
        showToast('متن صوتی با هوش مصنوعی رونویسی شد ✨', 'success');
      }
    } catch (e: unknown) {
      showToast(sanitizeAiError(e), 'error');
    } finally {
      setIsTranscribingAi(false);
    }
  };

  // Image Compression & Upload (Photos only, real dimensions & size)
  const handlePhotoFiles = async (files: FileList | null, isCamera: boolean) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        showToast('فقط فایل‌های تصویری (عکس) مجاز هستند؛ ویدیو پشتیبانی نمی‌شود.', 'error');
        continue;
      }
      try {
        const compressed = await compressImageFile(file);
        const savedBlob = await saveMediaBlob(compressed.blob, file.name, {
          width: compressed.width,
          height: compressed.height,
        });
        const newPhoto: PropertyPhotoItem = {
          mediaId: savedBlob.id,
          label: isCamera
            ? `تصویر دوربین محیطی (${file.name})`
            : `تصویر بارگذاری‌شده (${file.name.replace(/\.[^.]+$/, '')})`,
          width: compressed.width,
          height: compressed.height,
          sizeBytes: savedBlob.sizeBytes,
        };
        setPhotos((prev) => {
          const next = [...prev, newPhoto];
          setCurrentSlideIdx(next.length - 1);
          return next;
        });
        setIsDirty(true);
        showToast('تصویر با موفقیت فشرده‌سازی و به گالری ملک اضافه شد', 'success');
      } catch {
        showToast('خطا در پردازش تصویر', 'error');
      }
    }
  };

  const handleDeletePhoto = async (index: number) => {
    const confirmed = await askConfirm({
      title: 'حذف تصویر از گالری؟',
      message: 'آیا از حذف این تصویر از پرونده ملکی اطمینان دارید؟',
      confirmLabel: 'بله، حذف شود',
      danger: true,
    });
    if (!confirmed) return;
    const removed = photos[index];
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setCurrentSlideIdx(0);
    setIsDirty(true);
    showToast('تصویر حذف شد', 'info', () => {
      setPhotos((prev) => [...prev, removed]);
    });
  };

  // Document Upload (JPG, PNG, PDF up to 20MB with real status uploading -> processing -> ready)
  const handleDocumentFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        showToast(`حجم فایل ${file.name} بیش از ۲۰ مگابایت است.`, 'error');
        continue;
      }
      const tempId = `doc_temp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const initialItem: PropertyDocumentItem = {
        mediaId: tempId,
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/pdf',
        status: 'uploading',
        isConfidential: true,
        attachToContract: true,
      };
      setDocuments((prev) => [initialItem, ...prev]);
      setIsDirty(true);

      const savedBlob = await saveMediaBlob(file, file.name);
      setDocuments((prev) =>
        prev.map((d) =>
          d.mediaId === tempId ? { ...d, mediaId: savedBlob.id, status: 'processing' } : d
        )
      );

      const summary = await aiService.extractDocumentSummary(file);
      setDocuments((prev) =>
        prev.map((d) =>
          d.mediaId === savedBlob.id
            ? { ...d, status: 'ready', extractedText: summary }
            : d
        )
      );
    }
  };

  const handleDeleteDocument = async (docItem: PropertyDocumentItem) => {
    const ok = await askConfirm({
      title: 'حذف سند از پرونده؟',
      message: `آیا از حذف سند «${docItem.name}» اطمینان دارید؟`,
      confirmLabel: 'حذف سند',
      danger: true,
    });
    if (!ok) return;
    setDocuments((prev) => prev.filter((d) => d.mediaId !== docItem.mediaId));
    setIsDirty(true);
    showToast('سند از پرونده حذف شد', 'info', () => {
      setDocuments((prev) => [docItem, ...prev]);
    });
  };

  const handleSaveProperty = async () => {
    if (isViewer) return;
    setSubmittedOnce(true);

    if (validationErrors.totalCount > 0) {
      showToast(`${toPersianDigits(validationErrors.totalCount)} مورد ناقص است`, 'error');
      firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const saved = await saveProperty({
      id: isEdit ? id : undefined,
      code,
      title: title.trim(),
      propertyType,
      status,
      registerDate,
      city: city.trim() || 'کلارآباد',
      district: district.trim(),
      deedType,
      deedCustom: deedCustom.trim() || undefined,
      zoningStatus: zoningStatus || zoningCustom,
      zoningCustom: zoningCustom.trim() || undefined,
      area: parseNumericInput(areaStr),
      pricePerMeter: parseNumericInput(ppmStr),
      totalPrice: parseNumericInput(totalPriceStr),
      negotiable,
      province: province.trim() || undefined,
      accessPath: accessPath.trim() || undefined,
      lotLabel: lotLabel.trim() || undefined,
      lotShape,
      length: lotShape === 'مستطیل' ? parseNumericInput(lengthStr) || undefined : undefined,
      width: lotShape === 'مستطیل' ? parseNumericInput(widthStr) || undefined : undefined,
      frontageCount: frontageCount || undefined,
      passageWidth: parseNumericInput(passageWidthStr) || undefined,
      orientation: orientation || undefined,
      landUsage: landUsage || undefined,
      structureStatus: structureStatus || undefined,
      zoningAuth,
      fencingDesc: fencingDesc.trim() || undefined,
      zoningDensity: zoningDensity.trim() || undefined,
      maxLotCoverage: maxLotCoverage.trim() || undefined,
      densityFloors: densityFloors.trim() || undefined,
      permitStageType: permitStageType.trim() || undefined,
      utilLocation: utilLocation || undefined,
      utilities,
      utilDesc: utilDesc.trim() || undefined,
      inquiryStatus: inquiryStatus || undefined,
      permitNo: permitNo.trim() || undefined,
      substructureArea: parseNumericInput(substructureAreaStr) || undefined,
      permitIssueDate: permitIssueDate || undefined,
      permitExpiryDate: permitExpiryDate || undefined,
      dismissPermitWarning,
      commissionRate: commissionRate || undefined,
      paymentMethod: paymentMethod || undefined,
      paymentTerms: paymentTerms.trim() || undefined,
      referrerCollaboratorId: referrerCollaboratorId || undefined,
      contactPartnerName: contactPartnerName.trim() || undefined,
      contactSource,
      lastContactDate: lastContactDate || undefined,
      nextFollowupDate: nextFollowupDate || undefined,
      internalNotes: isManager ? internalNotes.trim() || undefined : undefined,
      builtArea: parseNumericInput(builtAreaStr) || undefined,
      roomsCount: parseNumericInput(roomsCountStr) || undefined,
      buildingAge: parseNumericInput(buildingAgeStr) || undefined,
      villaFloors: villaFloors || undefined,
      floorNumber: parseNumericInput(floorNumberStr) || undefined,
      totalFloors: parseNumericInput(totalFloorsStr) || undefined,
      hasParking,
      hasStorage,
      hasElevator,
      commercialFrontage: parseNumericInput(commercialFrontageStr) || undefined,
      ceilingHeight: parseNumericInput(ceilingHeightStr) || undefined,
      hasBusinessLicense,
      lat,
      lng,
      locationSourceUrl,
      exactAddress: exactAddress.trim() || undefined,
      voiceNoteMediaId,
      voiceTranscript: exactAddress.trim() || undefined,
      photos,
      documents,
      ownerName: ownerName.trim(),
      ownerPhone: ownerPhone.trim(),
    });

    sessionStorage.removeItem('kelid_draft_property_new');
    setIsDirty(false);
    await refreshSnapshot();
    showToast(`پرونده ملکی ${saved.code} با موفقیت ذخیره و تطبیق هوشمند اجرا شد ✓`, 'success');
    navigate(`/properties/${saved.id}`);
  };

  const handleCloseWithGuard = async () => {
    if (isDirty) {
      const discard = await askConfirm({
        title: 'خروج بدون ذخیره تغییرات؟',
        message: 'اطلاعات واردشده در فرم هنوز ذخیره نشده‌اند. آیا از بستن فرم اطمینان دارید؟',
        confirmLabel: 'بله، خروج',
        danger: true,
      });
      if (!discard) return;
    }
    if (isEdit) markReturningToList();
    navigate(-1);
  };

  const permitIsExpired = Boolean(
    permitExpiryDate && !dismissPermitWarning && isJalaliDateOverdue(permitExpiryDate)
  );

  return (
    <div className="min-h-screen bg-[#050b18] text-slate-100 relative overflow-x-hidden pb-36">
      <AmbientBackground />

      <main className="page-enter-forward relative z-10 w-full max-w-md mx-auto px-4 pt-3 space-y-4">
        {/* Top Bar & Brand Header (from Stitch Image 14.html) */}
        <header className="flex items-center justify-between pt-1 pb-2">
          <div className="flex items-center gap-2.5">
            <KelidLogoIcon className="w-11 h-11" />
            <div className="flex flex-col">
              <span className="text-base font-extrabold text-[#d4b06a] tracking-wide leading-tight">
                کــلیــد
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                املاک و سرمایه‌گذاری لوکس
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0a1328]/70 border border-[#d4b06a]/25">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-slate-200">{currentUser.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#d4b06a]/20 text-[#d4b06a] font-bold">
              {currentUser.role}
            </span>
          </div>
        </header>

        {/* Title & File Code Banner */}
        <section className="glass-card p-4 relative overflow-hidden">
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#d4b06a]/15 border border-[#d4b06a]/30 flex items-center justify-center text-[#d4b06a]">
                <span className="material-symbols-outlined text-[20px]">
                  {isEdit ? 'edit_square' : 'add'}
                </span>
              </div>
              <div>
                <h1 className="text-lg font-black text-slate-50 tracking-tight">
                  {isEdit ? `ویرایش پرونده ملکی (${code})` : 'ثبت ملک'}
                </h1>
                <p className="text-[11px] text-slate-400">محاسبات هوشمند مالی و متراژ دقیق</p>
              </div>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-emerald-950/80 border border-amber-400/30 text-emerald-300 font-mono text-xs font-black flex items-center gap-1.5">
              <span>{code}</span>
              <span className="material-symbols-outlined text-[16px] text-emerald-400">
                description
              </span>
            </div>
          </div>
        </section>

        {/* Expired Permit Warning Banner with «دیگر نشان نده» */}
        {permitIsExpired && (
          <div className="p-3.5 rounded-2xl bg-red-950/70 border border-red-400/50 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-red-200">
              <span className="material-symbols-outlined text-red-400 text-[20px]">warning</span>
              <span>
                مهلت اعتبار پروانه ساختمانی ({toPersianDigits(permitExpiryDate)}) منقضی شده است.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setDismissPermitWarning(true);
                setIsDirty(true);
              }}
              className="px-2.5 py-1 rounded-lg bg-white/10 text-amber-300 text-[11px] font-bold shrink-0 cursor-pointer"
            >
              دیگر نشان نده
            </button>
          </div>
        )}

        {/* SECTION 1: مشخصات پایه ملک */}
        <section
          ref={submittedOnce && validationErrors.basicCount > 0 ? firstErrorRef : undefined}
          className={`glass-card p-4 space-y-4 ${
            submittedOnce && validationErrors.basicCount > 0
              ? 'border-2 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]'
              : ''
          }`}
        >
          <div className="flex items-center justify-between pb-2 border-b border-[#d4b06a]/20">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#d4b06a] text-[18px]">domain</span>
              <h2 className="text-xs font-bold text-slate-200">مشخصات پایه ملک</h2>
            </div>
            {submittedOnce && validationErrors.basicCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {toPersianDigits(validationErrors.basicCount)} نقص
              </span>
            )}
          </div>

          {/* Field: Property Title (*) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200">
                عنوان آگهی و فایل ملک <span className="text-amber-400">*</span>
              </label>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#d4b06a]/15 text-[#d4b06a] font-bold border border-[#d4b06a]/25">
                نمایش در صدر پرونده
              </span>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setIsDirty(true);
              }}
              placeholder="مثال: زمین مسکونی ۳۰۰ متری دو بر در خوشامیان"
              className={`glass-field w-full h-12 px-4 rounded-xl text-xs font-bold text-slate-100 placeholder-slate-500 ${
                submittedOnce && validationErrors.basicMissing.title ? 'border-red-500' : ''
              }`}
            />
            {submittedOnce && validationErrors.basicMissing.title && (
              <p className="text-[11px] text-red-400 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">error</span>
                <span>{validationErrors.basicMissing.title}</span>
              </p>
            )}
          </div>

          {/* Field: Property Type */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              نوع ملک <span className="text-amber-400">*</span>
            </label>
            <select
              value={propertyType}
              onChange={(e) => {
                setPropertyType(e.target.value as any);
                setIsDirty(true);
              }}
              className="glass-field w-full h-12 px-4 rounded-xl text-sm font-semibold text-slate-100"
            >
              <option value="زمین" className="bg-[#050b18]">زمین</option>
              <option value="ویلا" className="bg-[#050b18]">ویلا</option>
              <option value="آپارتمان" className="bg-[#050b18]">آپارتمان</option>
              <option value="باغ" className="bg-[#050b18]">باغ</option>
              <option value="تجاری" className="bg-[#050b18]">تجاری</option>
            </select>
          </div>

          {/* Status & Solar Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">وضعیت فایل</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as PropertyStatus);
                  setIsDirty(true);
                }}
                className="glass-field w-full h-12 px-3 rounded-xl text-xs font-semibold text-slate-100"
              >
                <option value="فعال" className="bg-[#050b18]">🟢 فعال</option>
                <option value="در مذاکره" className="bg-[#050b18]">🟡 در مذاکره</option>
                <option value="فروخته‌شده" className="bg-[#050b18]">🔴 فروخته‌شده</option>
                <option value="غیرفعال" className="bg-[#050b18]">⚪ غیرفعال</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                تاریخ ثبت (شمسی)
              </label>
              <button
                type="button"
                onClick={() => setDatePickerTarget('register')}
                className="glass-field w-full h-12 px-3 rounded-xl text-xs font-bold text-slate-100 flex items-center justify-between cursor-pointer"
              >
                <span>{toPersianDigits(registerDate)}</span>
                <span className="material-symbols-outlined text-[#d4b06a] text-[18px]">
                  calendar_today
                </span>
              </button>
            </div>
          </div>

          {/* City & District (Connected to Shared Place Directory) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">شهر</label>
              <input
                type="text"
                list="kelid-cities-datalist"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="مثال: کلارآباد"
                className="glass-field w-full h-12 px-3 rounded-xl text-xs font-semibold text-slate-100"
              />
              <datalist id="kelid-cities-datalist">
                <option value="کلارآباد" />
                <option value="متل قو (سلمان‌شهر)" />
                <option value="چالوس و نمک‌آبرود" />
                <option value="نوشهر و سیسنگان" />
                <option value="عباس‌آباد و کلاردشت" />
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">محله / منطقه</label>
              <input
                type="text"
                value={district}
                onChange={(e) => {
                  setDistrict(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="مثال: خوشامیان"
                className="glass-field w-full h-12 px-3 rounded-xl text-xs font-semibold text-slate-100"
              />
            </div>
          </div>

          {/* Deed Type + Quick Chips + Free Text */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-300">نوع سند مالکیت</label>
              <span className="text-[10px] text-[#d4b06a]">انتخاب سریع یا درج اختصاصی</span>
            </div>
            <select
              value={deedType}
              onChange={(e) => {
                setDeedType(e.target.value);
                setIsDirty(true);
              }}
              className="glass-field w-full h-12 px-3 rounded-xl text-xs font-semibold text-slate-100"
            >
              <option value="تک‌برگ عرصه و اعیان (شش دانگ)">تک‌برگ عرصه و اعیان (شش دانگ)</option>
              <option value="تک‌برگ مشاعی">تک‌برگ مشاعی</option>
              <option value="بنچاق معتبر با استعلام">بنچاق معتبر با استعلام</option>
              <option value="شورایی / قولنامه‌ای با کد رهگیری">شورایی / قولنامه‌ای با کد رهگیری</option>
              <option value="صلح‌نامه / وکالتی">صلح‌نامه / وکالتی</option>
            </select>
            <div className="flex flex-wrap gap-1.5">
              {['شش‌دانگ', 'مشاعی', 'بنچاق', 'شورایی معتبر'].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setDeedCustom(chip);
                    setIsDirty(true);
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all cursor-pointer ${
                    deedCustom === chip
                      ? 'bg-[#d4b06a]/25 border-[#d4b06a] text-[#d4b06a]'
                      : 'bg-[#0a1328]/80 border-slate-700 text-slate-300'
                  }`}
                >
                  {chip}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={deedCustom}
              onChange={(e) => {
                setDeedCustom(e.target.value);
                setIsDirty(true);
              }}
              placeholder="یا تایپ دستی نوع سند و توضیحات ثبتی..."
              className="glass-field w-full h-10 px-3 rounded-xl text-xs text-slate-100 placeholder-slate-500"
            />
          </div>

          {/* Zoning Status (*) + Quick Chips + Free Text */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-300">
                وضعیت بافت شهرداری و دهیاری <span className="text-amber-400">*</span>
              </label>
              <span className="text-[10px] text-emerald-400">طرح هادی / تفصیلی</span>
            </div>
            <select
              value={zoningStatus}
              onChange={(e) => {
                setZoningStatus(e.target.value);
                setIsDirty(true);
              }}
              className={`glass-field w-full h-12 px-3 rounded-xl text-xs font-semibold text-slate-100 ${
                submittedOnce && validationErrors.basicMissing.zoningStatus ? 'border-red-500' : ''
              }`}
            >
              <option value="">انتخاب وضعیت بافت...</option>
              <option value="داخل بافت مسکونی ۱۰۰٪">داخل بافت مسکونی ۱۰۰٪</option>
              <option value="داخل بافت زرد (مسکونی - تجاری)">داخل بافت زرد (مسکونی - تجاری)</option>
              <option value="داخل بافت توریستی / باغی">داخل بافت توریستی / باغی</option>
              <option value="خارج بافت / الحاق به بافت مصوب">خارج بافت / الحاق به بافت مصوب</option>
              <option value="حریم شهر / فاقد کاربری">حریم شهر / فاقد کاربری</option>
            </select>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'مسکونی کامل', val: 'داخل بافت مسکونی ۱۰۰٪' },
                { label: 'بافت زرد', val: 'داخل بافت زرد (مسکونی - تجاری)' },
                { label: 'توریستی', val: 'داخل بافت توریستی / باغی' },
                { label: 'الحاق به بافت', val: 'خارج بافت / الحاق به بافت مصوب' },
              ].map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => {
                    setZoningStatus(c.val);
                    setZoningCustom(c.label);
                    setIsDirty(true);
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all cursor-pointer ${
                    zoningStatus === c.val
                      ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300'
                      : 'bg-[#0a1328]/80 border-slate-700 text-slate-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={zoningCustom}
              onChange={(e) => {
                setZoningCustom(e.target.value);
                setIsDirty(true);
              }}
              placeholder="توضیح یا نوع بافت دستی (تایپی)..."
              className="glass-field w-full h-10 px-3 rounded-xl text-xs text-slate-100 placeholder-slate-500"
            />
            {submittedOnce && validationErrors.basicMissing.zoningStatus && (
              <p className="text-[11px] text-red-400 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">error</span>
                <span>{validationErrors.basicMissing.zoningStatus}</span>
              </p>
            )}
          </div>
        </section>

        {/* SECTION 2: متراژ و قیمت دوطرفه */}
        <section
          className={`glass-card p-4 space-y-4 ${
            submittedOnce && validationErrors.pricingCount > 0
              ? 'border-2 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]'
              : 'border-[#d4b06a]/35'
          }`}
        >
          <div className="flex items-center justify-between pb-2 border-b border-[#d4b06a]/20">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#d4b06a] text-[18px]">calculate</span>
              <h2 className="text-sm font-bold text-slate-200">متراژ و قیمت دوطرفه</h2>
            </div>
            {submittedOnce && validationErrors.pricingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {toPersianDigits(validationErrors.pricingCount)} نقص
              </span>
            )}
          </div>

          {/* Area Field (*) */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-bold text-slate-300">
                متراژ (مترمربع) <span className="text-amber-400">*</span>
              </label>
              <span className="text-[11px] text-[#d4b06a] font-bold">
                {areaToPersianWords(areaStr)}
              </span>
            </div>
            <div className="relative">
              <input
                type="text"
                value={toPersianDigits(areaStr)}
                onChange={(e) => handleAreaChange(e.target.value)}
                placeholder="مثال: ۳۰۰"
                className={`glass-field w-full h-12 pr-4 pl-14 rounded-xl text-base font-extrabold text-slate-100 ${
                  submittedOnce && validationErrors.pricingMissing.area ? 'border-red-500' : ''
                }`}
              />
              <span className="absolute inset-y-0 left-3 flex items-center text-xs text-slate-400">
                متر²
              </span>
            </div>
            {submittedOnce && validationErrors.pricingMissing.area && (
              <p className="text-[11px] text-red-400 font-semibold mt-1">
                {validationErrors.pricingMissing.area}
              </p>
            )}
          </div>

          {/* Price Per Meter Field (*) */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-bold text-slate-300">
                قیمت هر متر (تومان) <span className="text-amber-400">*</span>
              </label>
              <span className="text-[11px] text-[#d4b06a] font-bold">
                {amountToTomanWords(ppmStr)}
              </span>
            </div>
            <div className="relative">
              <input
                type="text"
                value={toPersianDigits(ppmStr)}
                onChange={(e) => handlePpmChange(e.target.value)}
                placeholder="۴۰٬۰۰۰٬۰۰۰"
                className={`glass-field w-full h-12 pr-4 pl-16 rounded-xl text-base font-extrabold text-emerald-400 ${
                  submittedOnce && validationErrors.pricingMissing.ppm ? 'border-red-500' : ''
                }`}
              />
              <span className="absolute inset-y-0 left-3 flex items-center text-xs text-slate-400">
                تومان
              </span>
            </div>
            {submittedOnce && validationErrors.pricingMissing.ppm && (
              <p className="text-[11px] text-red-400 font-semibold mt-1">
                {validationErrors.pricingMissing.ppm}
              </p>
            )}
          </div>

          {/* Total Price Field (*) */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-bold text-slate-300">
                قیمت کل (تومان) <span className="text-amber-400">*</span>
              </label>
              <span className="text-[11px] text-[#d4b06a] font-bold">
                {amountToTomanWords(totalPriceStr)}
              </span>
            </div>
            <div className="relative">
              <input
                type="text"
                value={toPersianDigits(totalPriceStr)}
                onChange={(e) => handleTotalChange(e.target.value)}
                placeholder="۱۲٬۰۰۰٬۰۰۰٬۰۰۰"
                className={`glass-field w-full h-12 pr-4 pl-16 rounded-xl text-base font-black text-[#d4b06a] ${
                  submittedOnce && validationErrors.pricingMissing.total ? 'border-red-500' : ''
                }`}
              />
              <span className="absolute inset-y-0 left-3 flex items-center text-xs text-slate-400">
                تومان
              </span>
            </div>
            {submittedOnce && validationErrors.pricingMissing.total && (
              <p className="text-[11px] text-red-400 font-semibold mt-1">
                {validationErrors.pricingMissing.total}
              </p>
            )}
          </div>

          {/* Negotiable Switch */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-bold text-slate-300">قیمت قابل مذاکره و تخفیف؟</span>
            <button
              type="button"
              onClick={() => {
                setNegotiable(!negotiable);
                setIsDirty(true);
              }}
              className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer flex items-center ${
                negotiable ? 'bg-[#d4b06a]' : 'bg-slate-800 border border-slate-600'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  negotiable ? 'mr-auto' : 'ml-auto'
                }`}
              />
            </button>
          </div>
        </section>

        {/* SECTION 3: جزئیات بیشتر ملک و مشخصات تکمیلی (Expandable Accordion adapting to نوع ملک) */}
        <section className="glass-card p-4 relative overflow-hidden border border-[#d4b06a]/30">
          <button
            type="button"
            onClick={() => setExtendedOpen(!extendedOpen)}
            className="w-full flex flex-col gap-2.5 text-right cursor-pointer select-none"
          >
            <div className="w-full flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#d4b06a]/15 border border-[#d4b06a]/30 flex items-center justify-center text-[#d4b06a]">
                  <span className="material-symbols-outlined text-[18px]">tune</span>
                </div>
                <div>
                  <h2 className="text-xs font-black text-slate-100">
                    جزئیات بیشتر ملک و مشخصات تکمیلی ({propertyType})
                  </h2>
                  <p className="text-[10px] text-slate-400">
                    ابعاد، برها، انشعابات، مجوزها، تسویه و یادداشت مشاور
                  </p>
                </div>
              </div>
              <span
                className={`w-7 h-7 rounded-lg bg-[#0a1328] border border-slate-700 flex items-center justify-center text-[#d4b06a] text-xs transition-transform duration-300 ${
                  extendedOpen ? 'rotate-180' : ''
                }`}
              >
                ▼
              </span>
            </div>

            <div className="w-full flex items-center justify-between pt-1">
              <span className="text-[10px] font-bold text-[#d4b06a] px-2 py-0.5 rounded-full bg-[#d4b06a]/15 border border-[#d4b06a]/25">
                {toPersianDigits(extendedFilledInfo.filled)} از{' '}
                {toPersianDigits(extendedFilledInfo.total)} فیلد تکمیلی پر شده
              </span>
              <span className="text-[10px] text-slate-400">
                {extendedOpen ? 'جهت بستن لمس کنید' : 'لمس جهت مشاهده و ویرایش'}
              </span>
            </div>
            <div className="w-full h-1 bg-[#050b18] rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-[#9b7832] via-[#d4b06a] to-amber-300 rounded-full transition-all duration-300"
                style={{ width: `${extendedFilledInfo.percent}%` }}
              />
            </div>
          </button>

          {extendedOpen && (
            <div className="space-y-4 pt-4 mt-3 border-t border-[#d4b06a]/25">
              {/* Property-Type Specific Sub-Card (Villa / Apartment / Commercial) */}
              {propertyType === 'ویلا' && (
                <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/70 border border-[#d4b06a]/30">
                  <h3 className="text-xs font-bold text-[#d4b06a]">مشخصات اختصاصی ویلا</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-300 mb-1">زیربنا (متر)</label>
                      <input
                        type="text"
                        value={toPersianDigits(builtAreaStr)}
                        onChange={(e) => setBuiltAreaStr(e.target.value)}
                        placeholder="۲۲۰"
                        className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-300 mb-1">تعداد خواب</label>
                      <input
                        type="text"
                        value={toPersianDigits(roomsCountStr)}
                        onChange={(e) => setRoomsCountStr(e.target.value)}
                        placeholder="۳"
                        className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-300 mb-1">سن بنا (سال)</label>
                      <input
                        type="text"
                        value={toPersianDigits(buildingAgeStr)}
                        onChange={(e) => setBuildingAgeStr(e.target.value)}
                        placeholder="نوساز"
                        className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">تیپ طبقات ویلا</label>
                    <input
                      type="text"
                      value={villaFloors}
                      onChange={(e) => setVillaFloors(e.target.value)}
                      placeholder="دوبلکس + روف‌گاردن"
                      className="glass-field w-full h-10 px-3 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}

              {propertyType === 'آپارتمان' && (
                <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/70 border border-[#d4b06a]/30">
                  <h3 className="text-xs font-bold text-[#d4b06a]">مشخصات اختصاصی آپارتمان</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-300 mb-1">طبقه واحد</label>
                      <input
                        type="text"
                        value={toPersianDigits(floorNumberStr)}
                        onChange={(e) => setFloorNumberStr(e.target.value)}
                        placeholder="۴"
                        className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-300 mb-1">کل طبقات ساختمان</label>
                      <input
                        type="text"
                        value={toPersianDigits(totalFloorsStr)}
                        onChange={(e) => setTotalFloorsStr(e.target.value)}
                        placeholder="۶"
                        className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { label: 'پارکینگ', val: hasParking, set: setHasParking },
                      { label: 'انباری', val: hasStorage, set: setHasStorage },
                      { label: 'آسانسور', val: hasElevator, set: setHasElevator },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => item.set(!item.val)}
                        className={`py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                          item.val
                            ? 'bg-[#d4b06a]/20 border-[#d4b06a] text-[#d4b06a]'
                            : 'bg-[#050b18] border-slate-700 text-slate-400'
                        }`}
                      >
                        {item.label} {item.val ? '✓' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {propertyType === 'تجاری' && (
                <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/70 border border-[#d4b06a]/30">
                  <h3 className="text-xs font-bold text-[#d4b06a]">مشخصات اختصاصی تجاری</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-300 mb-1">بر تجاری (متر)</label>
                      <input
                        type="text"
                        value={toPersianDigits(commercialFrontageStr)}
                        onChange={(e) => setCommercialFrontageStr(e.target.value)}
                        placeholder="۶"
                        className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-300 mb-1">ارتفاع سقف (متر)</label>
                      <input
                        type="text"
                        value={toPersianDigits(ceilingHeightStr)}
                        onChange={(e) => setCeilingHeightStr(e.target.value)}
                        placeholder="۴.۵"
                        className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasBusinessLicense}
                      onChange={(e) => setHasBusinessLicense(e.target.checked)}
                    />
                    <span>دارای جواز کسب و سرقفلی فعال</span>
                  </label>
                </div>
              )}

              {/* 1. موقعیت تکمیلی و مکانی */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                <h3 className="text-xs font-bold text-slate-100">۱. موقعیت تکمیلی و مکانی</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">استان</label>
                    <input
                      type="text"
                      value={province}
                      onChange={(e) => setProvince(e.target.value)}
                      placeholder="مازندران"
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">معبر دسترسی</label>
                    <input
                      type="text"
                      value={accessPath}
                      onChange={(e) => setAccessPath(e.target.value)}
                      placeholder="کوچه ۱۰ متری"
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">برچسب قطعه</label>
                    <input
                      type="text"
                      value={lotLabel}
                      onChange={(e) => setLotLabel(e.target.value)}
                      placeholder="قطعه شمالی"
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                    />
                  </div>
                </div>
              </div>

              {/* 2. ابعاد، قواره و هندسه زمین (Length & Width ONLY when shape === مستطیل per spec) */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                <h3 className="text-xs font-bold text-slate-100">۲. ابعاد، قواره و هندسه زمین</h3>
                <div className="grid grid-cols-4 gap-1.5">
                  {['مستطیل', 'مربع', 'ال‌شکل', 'قناسی'].map((sh) => (
                    <button
                      key={sh}
                      type="button"
                      onClick={() => setLotShape(sh)}
                      className={`py-2 rounded-xl text-[10px] font-bold border cursor-pointer ${
                        lotShape === sh
                          ? 'bg-[#d4b06a]/20 border-[#d4b06a] text-[#d4b06a]'
                          : 'bg-[#050b18] border-slate-700 text-slate-300'
                      }`}
                    >
                      {sh}
                    </button>
                  ))}
                </div>
                {lotShape === 'مستطیل' && (
                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="block text-[10px] text-slate-300 mb-1">طول (متر)</label>
                      <input
                        type="text"
                        value={toPersianDigits(lengthStr)}
                        onChange={(e) => setLengthStr(e.target.value)}
                        placeholder="مثال: ۳۰"
                        className="glass-field w-full h-10 px-3 rounded-xl text-xs text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-300 mb-1">عرض (متر)</label>
                      <input
                        type="text"
                        value={toPersianDigits(widthStr)}
                        onChange={(e) => setWidthStr(e.target.value)}
                        placeholder="مثال: ۱۰"
                        className="glass-field w-full h-10 px-3 rounded-xl text-xs text-center"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 3. برها و معبر ملک */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                <h3 className="text-xs font-bold text-slate-100">۳. برها و معبر ملک</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">تعداد بر و جبهه ملک</label>
                    <select
                      value={frontageCount}
                      onChange={(e) => setFrontageCount(e.target.value)}
                      className="glass-field w-full h-10 px-2.5 rounded-xl text-xs"
                    >
                      <option value="">انتخاب...</option>
                      <option value="۱ بر (تک‌گذر)">۱ بر (تک‌گذر)</option>
                      <option value="۲ بر (نبش معبر)">۲ بر (نبش معبر)</option>
                      <option value="۳ بر (سه‌طرف باز)">۳ بر (سه‌طرف باز)</option>
                      <option value="۴ بر (جزیره‌ای)">۴ بر (جزیره‌ای)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">عرض معبر اصلی (متر)</label>
                    <input
                      type="text"
                      value={toPersianDigits(passageWidthStr)}
                      onChange={(e) => setPassageWidthStr(e.target.value)}
                      placeholder="۱۰"
                      className="glass-field w-full h-10 px-3 rounded-xl text-xs text-center"
                    />
                  </div>
                </div>
              </div>

              {/* 4. جهت و برپایی زمین */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                <h3 className="text-xs font-bold text-slate-100">۴. جهت و برپایی زمین</h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    'شمالی - جنوبی',
                    'جنوبی - شمالی',
                    'شرقی - غربی',
                    'غربی - شرقی',
                    'دوکله (شمالی-جنوبی)',
                    'دو نبش (نبش گذر)',
                  ].map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setOrientation(dir)}
                      className={`py-2 px-1 rounded-xl text-[10px] font-bold border cursor-pointer ${
                        orientation === dir
                          ? 'bg-[#d4b06a]/20 border-[#d4b06a] text-[#d4b06a]'
                          : 'bg-[#050b18] border-slate-700 text-slate-300'
                      }`}
                    >
                      {dir}
                    </button>
                  ))}
                </div>
              </div>

              {/* 5. کاربری، سازه و حصارکشی */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                <h3 className="text-xs font-bold text-slate-100">۵. کاربری، سازه و حصارکشی</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">نوع کاربری مصوب</label>
                    <select
                      value={landUsage}
                      onChange={(e) => setLandUsage(e.target.value)}
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs"
                    >
                      <option value="">انتخاب...</option>
                      <option value="مسکونی ویلایی">مسکونی ویلایی</option>
                      <option value="تجاری">تجاری</option>
                      <option value="باغ مسکونی">باغ مسکونی</option>
                      <option value="گردشگری اقامتی">گردشگری اقامتی</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">وضعیت سازه فعلی</label>
                    <select
                      value={structureStatus}
                      onChange={(e) => setStructureStatus(e.target.value)}
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs"
                    >
                      <option value="">انتخاب...</option>
                      <option value="زمین خام">زمین خام (بدون بنا)</option>
                      <option value="نیمه‌کاره">نیمه‌کاره (اسکلت)</option>
                      <option value="ساخته‌شده">ساخته‌شده (کلنگی/ویلا)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-300 mb-1">توضیحات محصوریت و دیوارکشی</label>
                  <input
                    type="text"
                    value={fencingDesc}
                    onChange={(e) => setFencingDesc(e.target.value)}
                    placeholder="مثال: چهار طرف دیوارکشی بلوکی با درب ورودی"
                    className="glass-field w-full h-10 px-3 rounded-xl text-xs"
                  />
                </div>
              </div>

              {/* 6. تراکم، طبقات و پتانسیل ساخت (4 manual fields, empty by default, ماده ۱۰۰ removed per spec) */}
              <div className="space-y-3 p-4 rounded-2xl bg-[#0a1328]/80 border-2 border-[#d4b06a]/45">
                <h3 className="text-xs font-black text-slate-50 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[#d4b06a] text-base">apartment</span>
                  <span>تراکم، طبقات و پتانسیل ساخت</span>
                </h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-200 mb-1">تراکم مجاز ساخت (%)</label>
                    <input
                      type="text"
                      value={zoningDensity}
                      onChange={(e) => setZoningDensity(e.target.value)}
                      placeholder="مثال: ۶۰٪"
                      className="glass-field w-full h-10 px-2.5 rounded-xl text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-200 mb-1">حداکثر سطح اشغال</label>
                    <input
                      type="text"
                      value={maxLotCoverage}
                      onChange={(e) => setMaxLotCoverage(e.target.value)}
                      placeholder="مثال: ۴۰٪"
                      className="glass-field w-full h-10 px-2.5 rounded-xl text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-200 mb-1">تعداد طبقات مجاز</label>
                    <input
                      type="text"
                      value={densityFloors}
                      onChange={(e) => setDensityFloors(e.target.value)}
                      placeholder="مثال: ۲ طبقه روی پیلوت"
                      className="glass-field w-full h-10 px-2.5 rounded-xl text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-200 mb-1">نوع پروانه و استعلام</label>
                    <input
                      type="text"
                      value={permitStageType}
                      onChange={(e) => setPermitStageType(e.target.value)}
                      placeholder="مثال: جواز ساخت فعال"
                      className="glass-field w-full h-10 px-2.5 rounded-xl text-xs text-center"
                    />
                  </div>
                </div>
              </div>

              {/* 7. انشعابات و زیرساخت */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                <h3 className="text-xs font-bold text-slate-100">۶. انشعابات و زیرساخت</h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {['سر ملک', 'داخل زمین', 'پای پروژه'].map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setUtilLocation(loc)}
                      className={`py-1.5 rounded-xl text-[10px] font-bold border cursor-pointer ${
                        utilLocation === loc
                          ? 'bg-[#d4b06a]/20 border-[#d4b06a] text-[#d4b06a]'
                          : 'bg-[#050b18] border-slate-700 text-slate-300'
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { key: 'water' as const, label: 'آب' },
                    { key: 'power' as const, label: 'برق' },
                    { key: 'gas' as const, label: 'گاز' },
                    { key: 'phone' as const, label: 'تلفن' },
                    { key: 'fiber' as const, label: 'فیبر نوری' },
                  ].map((u) => (
                    <label
                      key={u.key}
                      className="p-2 rounded-xl bg-[#050b18] border border-slate-700 flex items-center gap-1.5 text-xs cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={utilities[u.key]}
                        onChange={(e) =>
                          setUtilities((prev) => ({ ...prev, [u.key]: e.target.checked }))
                        }
                      />
                      <span>{u.label}</span>
                    </label>
                  ))}
                </div>
                <input
                  type="text"
                  value={utilDesc}
                  onChange={(e) => setUtilDesc(e.target.value)}
                  placeholder="توضیحات تکمیلی انشعابات..."
                  className="glass-field w-full h-10 px-3 rounded-xl text-xs"
                />
              </div>

              {/* 8. پروانه ساختمانی و استعلامات */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                <h3 className="text-xs font-bold text-slate-100">۷. پروانه ساختمانی و استعلامات</h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {['پاک و بلامانع', 'در حال بررسی', 'نیازمند رفع نقص'].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setInquiryStatus(st)}
                      className={`py-1.5 rounded-xl text-[10px] font-bold border cursor-pointer ${
                        inquiryStatus === st
                          ? 'bg-emerald-950 border-emerald-400 text-emerald-300'
                          : 'bg-[#050b18] border-slate-700 text-slate-300'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">شماره پروانه ساختمانی</label>
                    <input
                      type="text"
                      value={permitNo}
                      onChange={(e) => setPermitNo(e.target.value)}
                      placeholder="P-9821"
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">متراژ کل زیربنا (متر)</label>
                    <input
                      type="text"
                      value={toPersianDigits(substructureAreaStr)}
                      onChange={(e) => setSubstructureAreaStr(e.target.value)}
                      placeholder="۲۸۰"
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">تاریخ صدور</label>
                    <button
                      type="button"
                      onClick={() => setDatePickerTarget('issue')}
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs flex items-center justify-between cursor-pointer"
                    >
                      <span>{permitIssueDate ? toPersianDigits(permitIssueDate) : 'انتخاب...'}</span>
                      <span className="material-symbols-outlined text-[15px] text-[#d4b06a]">event</span>
                    </button>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">پایان اعتبار</label>
                    <button
                      type="button"
                      onClick={() => setDatePickerTarget('expiry')}
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs flex items-center justify-between cursor-pointer"
                    >
                      <span>{permitExpiryDate ? toPersianDigits(permitExpiryDate) : 'انتخاب...'}</span>
                      <span className="material-symbols-outlined text-[15px] text-[#d4b06a]">event</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 9. مالی، تسویه و کمیسیون */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                <h3 className="text-xs font-bold text-slate-100">۸. مالی، تسویه و کمیسیون</h3>
                <div className="grid grid-cols-4 gap-1.5">
                  {['شیرینی ویژه', 'نیم‌درصد', '۱ درصد عرف', 'توافقی'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCommissionRate(c)}
                      className={`py-1.5 rounded-xl text-[10px] font-bold border cursor-pointer ${
                        commissionRate === c
                          ? 'bg-[#d4b06a]/20 border-[#d4b06a] text-[#d4b06a]'
                          : 'bg-[#050b18] border-slate-700 text-slate-300'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {['نقد', 'اقساط', 'تهاتر', 'ترکیبی'].map((pm) => (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => setPaymentMethod(pm)}
                      className={`py-1.5 rounded-xl text-[10px] font-bold border cursor-pointer ${
                        paymentMethod === pm
                          ? 'bg-[#d4b06a]/20 border-[#d4b06a] text-[#d4b06a]'
                          : 'bg-[#050b18] border-slate-700 text-slate-300'
                      }`}
                    >
                      {pm}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="کادر شرایط و زمان‌بندی پرداخت..."
                  className="glass-field w-full h-10 px-3 rounded-xl text-xs"
                />
              </div>

              {/* 10. ارتباط، معرف و پیگیری */}
              <div className="space-y-3 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                <h3 className="text-xs font-bold text-slate-100">۹. ارتباط، معرف و پیگیری</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">همکار یا معرف پرونده</label>
                    <select
                      value={referrerCollaboratorId}
                      onChange={(e) => {
                        const colId = e.target.value;
                        setReferrerCollaboratorId(colId);
                        const found = snapshot?.collaborators.find((c) => c.id === colId);
                        if (found) setContactPartnerName(found.name);
                      }}
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs"
                    >
                      <option value="">انتخاب همکار...</option>
                      {snapshot?.collaborators.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">منبع معرفی</label>
                    <select
                      value={contactSource}
                      onChange={(e) => setContactSource(e.target.value)}
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs"
                    >
                      <option value="همکار معتمد">همکار معتمد</option>
                      <option value="مالک مستقیم">مالک مستقیم</option>
                      <option value="آگهی">آگهی</option>
                      <option value="سامانه">سامانه</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">تاریخ آخرین تماس</label>
                    <button
                      type="button"
                      onClick={() => setDatePickerTarget('lastContact')}
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs flex items-center justify-between cursor-pointer"
                    >
                      <span>{lastContactDate ? toPersianDigits(lastContactDate) : 'انتخاب...'}</span>
                      <span className="material-symbols-outlined text-[15px] text-[#d4b06a]">event</span>
                    </button>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-300 mb-1">موعد پیگیری بعدی</label>
                    <button
                      type="button"
                      onClick={() => setDatePickerTarget('nextFollowup')}
                      className="glass-field w-full h-10 px-2 rounded-xl text-xs flex items-center justify-between cursor-pointer"
                    >
                      <span>{nextFollowupDate ? toPersianDigits(nextFollowupDate) : 'انتخاب...'}</span>
                      <span className="material-symbols-outlined text-[15px] text-[#d4b06a]">event</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 11. یادداشت داخلی پرونده مشاور (Manager Only) */}
              {isManager && (
                <div className="space-y-2 p-3.5 rounded-xl bg-[#0a1328]/60 border border-[#d4b06a]/20">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-100">۱۰. یادداشت داخلی پرونده مشاور</h3>
                    <span className="text-[9px] px-2 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/25 font-bold">
                      محرمانه • فقط مدیر
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    placeholder="یادداشت‌های اختصاصی، محدودیت‌های مالک، توافقات شفاهی..."
                    className="glass-field w-full p-2.5 rounded-xl text-xs leading-relaxed text-slate-100"
                  />
                </div>
              )}
            </div>
          )}
        </section>

        {/* SECTION 4: موقعیت و لوکیشن نقشه + دستیار صوتی */}
        <section className="glass-card p-4 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#d4b06a]/20">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#d4b06a] text-[18px]">location_on</span>
              <h2 className="text-xs font-bold text-slate-300">موقعیت و لوکیشن نقشه</h2>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#d4b06a]/15 text-[#d4b06a] font-bold border border-[#d4b06a]/25">
              سیستم هوشمند GPS و AI
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                setAwaitingMapClipboard(true);
                openMapChooser(lat ?? 36.651042, lng ?? 51.201089, title || 'انتخاب موقعیت ملک');
              }}
              className="h-10 px-2 rounded-xl bg-[#0a1328]/80 hover:bg-[#d4b06a]/20 border border-[#d4b06a]/30 text-[#d4b06a] text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>📍</span>
              <span>روی نقشه</span>
            </button>

            <button
              type="button"
              onClick={handleGetMyLocation}
              disabled={isGettingGps}
              className="h-10 px-2 rounded-xl bg-[#0a1328]/80 hover:bg-[#d4b06a]/20 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>{isGettingGps ? '⏳' : '🎯'}</span>
              <span>{isGettingGps ? 'دریافت...' : 'موقعیت من'}</span>
            </button>

            <button
              type="button"
              onClick={handlePasteCoordinates}
              className="h-10 px-2 rounded-xl bg-[#0a1328]/80 hover:bg-[#d4b06a]/20 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>📋</span>
              <span>چسباندن</span>
            </button>
          </div>

          {/* Coordinates Preview & Mini Map */}
          {lat !== undefined && lng !== undefined ? (
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-[#050b18]/80 border border-emerald-500/30 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-slate-100 font-bold">
                    {lat.toFixed(6)} , {lng.toFixed(6)}
                  </span>
                  {gpsAccuracy !== null && (
                    <span className="text-[10px] font-sans text-emerald-300">
                      (دقت: ±{toPersianDigits(gpsAccuracy)} متر)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openMapChooser(lat, lng, title || 'موقعیت ملک')}
                  className="text-[11px] font-sans text-[#d4b06a] font-bold hover:underline cursor-pointer"
                >
                  نمایش در مپ
                </button>
              </div>
              <div
                onClick={() => openMapChooser(lat, lng, title || 'موقعیت ملک')}
                className="relative w-full h-28 rounded-xl overflow-hidden border border-[#d4b06a]/25 bg-cover bg-center flex items-center justify-center cursor-pointer"
                style={{ backgroundImage: `url('/images/kelarabad-land.jpg')` }}
              >
                <div className="absolute inset-0 bg-[#050b18]/55" />
                <div className="relative z-10 flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-[#d4b06a] text-[#050b18] flex items-center justify-center shadow-lg">
                    <span className="material-symbols-outlined text-[18px]">location_on</span>
                  </div>
                  <span className="text-[10px] font-bold text-white bg-black/70 px-2 py-0.5 rounded mt-1">
                    موقعیت ثبت‌شده ({toPersianDigits(lat.toFixed(4))}, {toPersianDigits(lng.toFixed(4))})
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-[#050b18]/60 border border-slate-800 text-center text-[11px] text-slate-400">
              مختصات جغرافیایی هنوز ثبت نشده است. از دکمه‌های بالا برای ثبت موقعیت دقیق استفاده کنید.
            </div>
          )}

          {/* Address & Voice Dictation */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-300">
                آدرس دقیق و توضیحات دسترسی
              </label>
              <span className="text-[10px] text-slate-400">تایپ دستی یا ضبط ویس AI</span>
            </div>
            <div className="relative">
              <textarea
                rows={3}
                value={exactAddress}
                onChange={(e) => {
                  setExactAddress(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="مثال: کلارآباد، خیابان دریا، لاله ۱، انتهای بن‌بست پلاک ۱۲"
                className="glass-field w-full pr-3 pl-12 py-2.5 rounded-xl text-xs leading-relaxed text-slate-100"
              />
              <button
                type="button"
                onClick={handleToggleVoiceRecord}
                title="ضبط صدا"
                className={`absolute top-2.5 left-2.5 w-8 h-8 rounded-lg flex items-center justify-center border cursor-pointer ${
                  isRecordingVoice
                    ? 'bg-red-500 text-white border-red-400 animate-pulse'
                    : 'bg-[#d4b06a]/15 text-[#d4b06a] border-[#d4b06a]/30'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">mic</span>
              </button>
            </div>

            <div className="mt-2.5 p-3 rounded-xl bg-[#050b18]/80 border border-[#d4b06a]/25 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-200 text-[11px]">
                  🎙️ دستیار صوتی و تبدیل ویس هوشمند (AI)
                </span>
                <span className="font-mono font-bold text-[11px] text-[#d4b06a]">
                  {toPersianDigits(
                    `${String(Math.floor(voiceSeconds / 60)).padStart(2, '0')}:${String(
                      voiceSeconds % 60
                    ).padStart(2, '0')}`
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleToggleVoiceRecord}
                  className={`h-9 px-2.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                    isRecordingVoice
                      ? 'bg-red-500 text-white animate-pulse'
                      : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span>{isRecordingVoice ? 'در حال ضبط...' : 'شروع ضبط ویس'}</span>
                </button>
                <button
                  type="button"
                  disabled={!isRecordingVoice}
                  onClick={() => voiceCtrlRef.current?.stop()}
                  className={`h-9 px-2.5 rounded-lg border border-slate-700 text-[11px] font-bold flex items-center justify-center gap-1.5 ${
                    isRecordingVoice
                      ? 'bg-[#0a1328] text-slate-100 cursor-pointer'
                      : 'opacity-50 cursor-not-allowed text-slate-400'
                  }`}
                >
                  <span>⏹ توقف و ذخیره ویس</span>
                </button>
              </div>

              <button
                type="button"
                disabled={isTranscribingAi}
                onClick={handleAiReTranscribe}
                className="w-full h-9 rounded-lg bg-gradient-to-r from-[#9b7832] via-[#d4b06a] to-amber-300 text-[#050b18] text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>✨</span>
                <span>
                  {isTranscribingAi
                    ? 'در حال رونویسی هوشمند با Gemini...'
                    : 'تبدیل هوشمند به متن (AI)'}
                </span>
              </button>

              {voiceBlobUrl && (
                <div className="p-2 rounded-lg bg-[#d4b06a]/10 border border-[#d4b06a]/30 flex items-center justify-between gap-2">
                  <audio ref={audioRef} src={voiceBlobUrl} controls className="h-8 w-full" />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* SECTION 5: گالری تصاویر (Photos only — Fake 4K/60fps badge removed per spec) */}
        <section className="glass-card p-4 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#d4b06a]/20">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#d4b06a] text-[18px]">photo_library</span>
              <h2 className="text-xs font-extrabold text-slate-100">گالری تصاویر ملک (فقط عکس)</h2>
            </div>
            <span className="text-[10px] text-[#d4b06a] font-bold">
              {toPersianDigits(photos.length)} تصویر ثبت‌شده
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => handlePhotoFiles(e.target.files, true)}
              className="hidden"
            />
            <button
              type="button"
              onClick={async () => {
                if (await askPermission('camera')) cameraInputRef.current?.click();
              }}
              className="h-12 px-3 rounded-xl bg-[#0a1328]/80 hover:border-[#d4b06a]/50 border border-slate-700 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>📸</span>
              <div className="text-right">
                <span className="block text-xs font-bold text-slate-200">ثبت با دوربین</span>
                <span className="block text-[9px] text-slate-400">عکاسی مستقیم محیطی</span>
              </div>
            </button>

            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handlePhotoFiles(e.target.files, false)}
              className="hidden"
            />
            <button
              type="button"
              onClick={async () => {
                if (await askPermission('files')) galleryInputRef.current?.click();
              }}
              className="h-12 px-3 rounded-xl bg-gradient-to-r from-[#d4b06a]/20 to-transparent border border-[#d4b06a]/40 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>🖼️</span>
              <div className="text-right">
                <span className="block text-xs font-bold text-[#d4b06a]">بارگذاری تصاویر</span>
                <span className="block text-[9px] text-slate-400">انتخاب از گالری فایل‌ها</span>
              </div>
            </button>
          </div>

          {photos.length > 0 ? (
            <div className="relative rounded-2xl overflow-hidden border border-[#d4b06a]/35 bg-[#050b18] h-56">
              <img
                src={
                  photoUrls[photos[currentSlideIdx]?.mediaId] ||
                  photos[currentSlideIdx]?.fallbackUrl ||
                  '/images/kelarabad-land.jpg'
                }
                alt={photos[currentSlideIdx]?.label}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between">
                <span className="px-2.5 py-1 rounded-lg bg-[#050b18]/80 border border-white/15 text-[10px] text-slate-200 font-mono">
                  {photos[currentSlideIdx]?.width && photos[currentSlideIdx]?.height
                    ? `${toPersianDigits(photos[currentSlideIdx].width)}×${toPersianDigits(
                        photos[currentSlideIdx].height
                      )} px`
                    : 'تصویر اصلی'}{' '}
                  {photos[currentSlideIdx]?.sizeBytes
                    ? `• ${toPersianDigits(
                        Math.round((photos[currentSlideIdx].sizeBytes || 0) / 1024)
                      )} KB`
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeletePhoto(currentSlideIdx)}
                  className="w-8 h-8 rounded-full bg-red-600/80 text-white flex items-center justify-center cursor-pointer"
                  title="حذف تصویر"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              </div>

              {photos.length > 1 && (
                <div className="absolute inset-y-0 inset-x-2 flex items-center justify-between pointer-events-none">
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentSlideIdx((prev) => (prev - 1 + photos.length) % photos.length)
                    }
                    className="pointer-events-auto w-8 h-8 rounded-full bg-black/70 text-[#d4b06a] flex items-center justify-center cursor-pointer"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentSlideIdx((prev) => (prev + 1) % photos.length)}
                    className="pointer-events-auto w-8 h-8 rounded-full bg-black/70 text-[#d4b06a] flex items-center justify-center cursor-pointer"
                  >
                    ›
                  </button>
                </div>
              )}

              <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-[#050b18] via-[#050b18]/85 to-transparent flex items-center justify-between">
                <span className="text-xs font-bold text-slate-100 truncate">
                  {photos[currentSlideIdx]?.label}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-[#d4b06a]/20 text-[#d4b06a] text-[10px] font-bold">
                  {toPersianDigits(currentSlideIdx + 1)} / {toPersianDigits(photos.length)}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-[#050b18]/60 border border-dashed border-slate-700 text-center text-xs text-slate-400">
              هنوز تصویری برای این پرونده بارگذاری نشده است.
            </div>
          )}
        </section>

        {/* SECTION 6: اسناد، مدارک و تاییدیه‌های ثبتی زمین */}
        <section className="glass-card p-4 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#d4b06a]/20">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#d4b06a] text-[18px]">description</span>
              <h2 className="text-xs font-bold text-slate-300">
                اسناد، مدارک و تاییدیه‌های ثبتی زمین
              </h2>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#d4b06a]/20 text-[#d4b06a] font-bold">
              آرشیو ابری
            </span>
          </div>

          <input
            ref={docInputRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            multiple
            onChange={(e) => handleDocumentFiles(e.target.files)}
            className="hidden"
          />
          <div
            onClick={async () => {
              if (await askPermission('files')) docInputRef.current?.click();
            }}
            className="rounded-xl border border-dashed border-[#d4b06a]/35 bg-[#050b18]/60 p-4 text-center cursor-pointer hover:bg-[#d4b06a]/10 transition-all"
          >
            <p className="text-xs font-bold text-slate-100">
              آپلود تصویر یا PDF سند (تک‌برگ، UTM، جواز)
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              فرمت‌های مجاز: JPG, PNG, PDF (حداکثر ۲۰ مگابایت)
            </p>
            <span className="inline-block mt-2 px-3 py-1 rounded-lg bg-[#d4b06a]/20 text-[#d4b06a] text-[11px] font-bold">
              + افزودن فایل جدید
            </span>
          </div>

          {documents.length > 0 && (
            <div className="space-y-2.5">
              {documents.map((doc) => (
                <div
                  key={doc.mediaId}
                  className="p-3 rounded-xl bg-[#050b18]/75 border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-200 truncate">{doc.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                        <span
                          className={
                            doc.status === 'ready'
                              ? 'text-emerald-400 font-bold'
                              : 'text-amber-400 animate-pulse'
                          }
                        >
                          {doc.status === 'uploading'
                            ? 'در حال بارگذاری...'
                            : doc.status === 'processing'
                            ? 'در حال پردازش...'
                            : doc.extractedText || 'تایید شده ✓'}
                        </span>
                        <span className="text-slate-400 font-mono">
                          {toPersianDigits((doc.sizeBytes / (1024 * 1024)).toFixed(2))} MB
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          const u = await getMediaBlobUrl(doc.mediaId);
                          if (u) {
                            const link = document.createElement('a');
                            link.href = u;
                            link.download = doc.name;
                            link.click();
                            showToast(`دریافت فایل سند «${doc.name}» آغاز شد.`, 'info');
                          } else {
                            showToast(doc.extractedText || doc.name, 'info');
                          }
                        }}
                        className="w-7 h-7 rounded-lg bg-slate-800 text-[#d4b06a] flex items-center justify-center cursor-pointer"
                        title="مشاهده"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDocument(doc)}
                        className="w-7 h-7 rounded-lg bg-slate-800 text-rose-400 flex items-center justify-center cursor-pointer"
                        title="حذف"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 pt-1 border-t border-slate-800/80 text-[10px] text-slate-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={doc.isConfidential}
                        onChange={(e) =>
                          setDocuments((prev) =>
                            prev.map((d) =>
                              d.mediaId === doc.mediaId
                                ? { ...d, isConfidential: e.target.checked }
                                : d
                            )
                          )
                        }
                      />
                      <span>آرشیو محرمانه (ویژه مدیر)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={doc.attachToContract}
                        onChange={(e) =>
                          setDocuments((prev) =>
                            prev.map((d) =>
                              d.mediaId === doc.mediaId
                                ? { ...d, attachToContract: e.target.checked }
                                : d
                            )
                          )
                        }
                      />
                      <span>الصاق به مبایعه‌نامه</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SECTION 7: اطلاعات محرمانه مالک (Required ownerName + Validated ownerPhone + 2 Read-Only Summary Lines) */}
        <section
          className={`glass-card p-4 space-y-4 ${
            submittedOnce && validationErrors.ownerCount > 0
              ? 'border-2 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]'
              : ''
          }`}
        >
          <div className="flex items-center justify-between pb-2 border-b border-[#d4b06a]/20">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400 text-[18px]">lock</span>
              <h2 className="text-xs font-bold text-slate-300">اطلاعات محرمانه مالک</h2>
            </div>
            {submittedOnce && validationErrors.ownerCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {toPersianDigits(validationErrors.ownerCount)} نقص
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                نام و نام خانوادگی <span className="text-amber-400">*</span>
              </label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => {
                  setOwnerName(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="نام مالک"
                className={`glass-field w-full h-12 px-3 rounded-xl text-xs font-semibold text-slate-100 ${
                  submittedOnce && validationErrors.ownerMissing.ownerName ? 'border-red-500' : ''
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                شماره تماس مالک
              </label>
              <div className="relative">
                <input
                  type="tel"
                  dir="ltr"
                  value={toPersianDigits(ownerPhone)}
                  onChange={(e) => {
                    setOwnerPhone(e.target.value);
                    setIsDirty(true);
                  }}
                  placeholder="۰۹۱۲..."
                  className={`glass-field w-full h-12 pr-3 pl-9 rounded-xl text-xs font-bold font-mono text-slate-100 text-left ${
                    submittedOnce && validationErrors.ownerMissing.ownerPhone ? 'border-red-500' : ''
                  }`}
                />
                <button
                  type="button"
                  onClick={() =>
                    triggerPhoneCall(ownerPhone, () =>
                      showToast('ابتدا شماره تماس مالک را وارد کنید', 'error')
                    )
                  }
                  className="absolute inset-y-0 left-2.5 flex items-center text-emerald-400 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">call</span>
                </button>
              </div>
            </div>
          </div>

          {submittedOnce &&
            (validationErrors.ownerMissing.ownerName ||
              validationErrors.ownerMissing.ownerPhone) && (
              <p className="text-[11px] text-red-400 font-semibold">
                {validationErrors.ownerMissing.ownerName ||
                  validationErrors.ownerMissing.ownerPhone}
              </p>
            )}

          {duplicateOwnerWarning && (
            <p className="text-[11px] text-amber-300 bg-amber-500/15 border border-amber-400/30 p-2 rounded-lg">
              ⚠️ {duplicateOwnerWarning}
            </p>
          )}

          {/* Two Read-Only Summary Lines Derived from Deed & Zoning Fields per Spec */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="glass-field h-11 px-3 rounded-xl flex items-center justify-between text-xs text-slate-300">
              <span className="truncate">{deedCustom || deedType || 'نوع سند ثبت نشده'}</span>
              <span className="material-symbols-outlined text-[15px] text-[#d4b06a]">
                verified
              </span>
            </div>
            <div className="glass-field h-11 px-3 rounded-xl flex items-center justify-between text-xs text-slate-300">
              <span className="truncate">{zoningStatus || zoningCustom || 'وضعیت بافت ثبت نشده'}</span>
              <span className="material-symbols-outlined text-[15px] text-emerald-400">
                domain
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* Sticky Luxury Bottom Bar (Separate from panels with ample bottom padding above) */}
      <nav className="fixed bottom-0 inset-x-0 z-50 p-3 bg-[#050b18]/85 backdrop-blur-xl border-t border-[#d4b06a]/30 shadow-[0_-10px_35px_rgba(2,6,18,0.75)]">
        <div className="max-w-md mx-auto flex items-center gap-3">
          {!isViewer && (
            <button
              type="button"
              onClick={handleSaveProperty}
              className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-[#c9a45c] via-[#d4b06a] to-[#f5de9c] text-[#050b18] font-black text-sm flex items-center justify-center gap-2 shadow-[0_4px_22px_rgba(212,176,106,0.38)] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">save</span>
              <span>{isEdit ? 'ذخیره تغییرات پرونده' : 'ذخیره فایل ملکی'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCloseWithGuard}
            className="w-28 h-12 rounded-2xl bg-[#0a1328]/90 border border-slate-700 text-slate-300 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>✕ بستن</span>
          </button>
        </div>
      </nav>

      {/* Jalali Date Picker Modal */}
      {datePickerTarget && (
        <JalaliDatePickerModal
          title="انتخاب تاریخ شمسی"
          initialValue={
            datePickerTarget === 'register'
              ? registerDate
              : datePickerTarget === 'issue'
              ? permitIssueDate
              : datePickerTarget === 'expiry'
              ? permitExpiryDate
              : datePickerTarget === 'lastContact'
              ? lastContactDate
              : nextFollowupDate
          }
          onSelect={(d) => {
            setIsDirty(true);
            if (datePickerTarget === 'register') setRegisterDate(d);
            else if (datePickerTarget === 'issue') setPermitIssueDate(d);
            else if (datePickerTarget === 'expiry') setPermitExpiryDate(d);
            else if (datePickerTarget === 'lastContact') setLastContactDate(d);
            else if (datePickerTarget === 'nextFollowup') setNextFollowupDate(d);
            setDatePickerTarget(null);
          }}
          onClose={() => setDatePickerTarget(null)}
        />
      )}
    </div>
  );
};

async function compressImageFile(
  file: File
): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 1600;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          resolve({ blob: blob || file, width: w, height: h });
        },
        'image/jpeg',
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ blob: file, width: 1280, height: 720 });
    };
    img.src = url;
  });
}
