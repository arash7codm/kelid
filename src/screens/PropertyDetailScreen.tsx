import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AmbientBackground, KelidLogoIcon } from '../components/Layout';
import { getMediaBlobUrl, softDeleteEntity } from '../db/repositories';
import { db, PropertyRecord } from '../db/schema';
import { useApp } from '../hooks/useAppContext';
import { markReturningToList } from '../motion';
import { triggerPhoneCall, triggerSms } from '../services/maps';
import {
  amountToTomanWords,
  formatWithSeparator,
  isJalaliDateOverdue,
  toPersianDigits,
} from '../utils/persian';

export const PropertyDetailScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    snapshot,
    currentUser,
    refreshSnapshot,
    showToast,
    askConfirm,
    openMapChooser,
  } = useApp();

  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isManager = currentUser.role === 'مدیر';
  const isViewer = currentUser.role === 'بیننده';

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!id) return;
      const rec = await db.properties.get(id);
      if (rec && mounted) {
        setProperty(rec);
        const urls: Record<string, string> = {};
        for (const p of rec.photos || []) {
          const u = (await getMediaBlobUrl(p.mediaId)) || p.fallbackUrl || '/images/kelarabad-land.jpg';
          urls[p.mediaId] = u;
        }
        if (mounted) setPhotoUrls(urls);
        if (rec.voiceNoteMediaId) {
          const vu = await getMediaBlobUrl(rec.voiceNoteMediaId);
          if (mounted) setVoiceUrl(vu);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id, snapshot]);

  // Dynamic Technical Profile Cards (Shows ONLY filled fields, including type-specific fields)
  const technicalSpecs = useMemo(() => {
    if (!property) return [];
    const cards: Array<{ label: string; value: string; sub?: string; icon: string }> = [];

    if (property.frontageCount) {
      cards.push({
        label: 'تعداد بر و معبر',
        value: property.frontageCount,
        sub: property.passageWidth ? `عرض معبر اصلی ${toPersianDigits(property.passageWidth)} متر` : undefined,
        icon: 'straighten',
      });
    }
    if (property.lotShape) {
      const dimText =
        property.lotShape === 'مستطیل' && property.length && property.width
          ? `${toPersianDigits(property.width)} × ${toPersianDigits(property.length)} متر`
          : property.lotShape;
      cards.push({
        label: 'ابعاد و قواره',
        value: dimText,
        sub: `قواره ${property.lotShape}`,
        icon: 'aspect_ratio',
      });
    }
    if (property.orientation) {
      cards.push({
        label: 'جهت ملک',
        value: property.orientation,
        icon: 'explore',
      });
    }
    if (property.landUsage) {
      cards.push({
        label: 'نوع کاربری',
        value: property.landUsage,
        sub: property.zoningAuth?.length ? `تاییدیه ${property.zoningAuth.join(' / ')}` : undefined,
        icon: 'holiday_village',
      });
    }
    if (property.utilLocation || property.utilDesc) {
      cards.push({
        label: 'وضعیت انشعابات',
        value: property.utilLocation || 'نصب‌شده',
        sub: property.utilDesc,
        icon: 'power',
      });
    }
    if (property.structureStatus || property.fencingDesc) {
      cards.push({
        label: 'وضعیت سازه',
        value: property.structureStatus || 'مشخص‌شده',
        sub: property.fencingDesc,
        icon: 'foundation',
      });
    }
    if (property.zoningDensity || property.densityFloors) {
      cards.push({
        label: 'تراکم و طبقات مجاز',
        value: property.densityFloors || property.zoningDensity || '',
        sub: property.maxLotCoverage ? `سطح اشغال: ${property.maxLotCoverage}` : undefined,
        icon: 'layers',
      });
    }
    if (property.builtArea) {
      cards.push({
        label: 'متراژ بنا',
        value: `${toPersianDigits(property.builtArea)} متر مربع`,
        sub: property.roomsCount ? `${toPersianDigits(property.roomsCount)} خواب` : property.villaFloors,
        icon: 'villa',
      });
    }
    if (property.floorNumber) {
      cards.push({
        label: 'طبقه واحد',
        value: `طبقه ${toPersianDigits(property.floorNumber)}`,
        sub: property.totalFloors ? `از ${toPersianDigits(property.totalFloors)} طبقه` : undefined,
        icon: 'apartment',
      });
    }
    if (property.commercialFrontage) {
      cards.push({
        label: 'بر تجاری',
        value: `${toPersianDigits(property.commercialFrontage)} متر`,
        sub: property.ceilingHeight ? `ارتفاع سقف ${toPersianDigits(property.ceilingHeight)} متر` : undefined,
        icon: 'storefront',
      });
    }

    return cards;
  }, [property]);

  const visibleDocuments = useMemo(() => {
    if (!property?.documents) return [];
    return property.documents.filter((d) => isManager || !d.isConfidential);
  }, [property, isManager]);

  const dismissPermitExpiry = async () => {
    if (!property) return;
    await db.properties.update(property.id, { dismissPermitWarning: true });
    await refreshSnapshot();
    showToast('هشدار انقضای جواز بسته شد', 'info');
  };

  const handleSharePropertyPublic = async () => {
    if (!property) return;
    const publicSummary = [
      `مشخصات ملک کلید (${property.code}):`,
      `عنوان: ${property.title}`,
      `نوع کاربری: ${property.propertyType} • وضعیت: ${property.status}`,
      `منطقه: ${[property.city, property.district].filter(Boolean).join('، ')}`,
      `متراژ: ${formatWithSeparator(property.area, true)} متر مربع`,
      `قیمت هر متر: ${formatWithSeparator(property.pricePerMeter, true)} تومان`,
      `قیمت کل: ${formatWithSeparator(property.totalPrice, true)} تومان (${amountToTomanWords(property.totalPrice)})`,
      property.deedType ? `نوع سند: ${property.deedCustom || property.deedType}` : '',
      property.zoningStatus ? `وضعیت بافت: ${property.zoningStatus}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (navigator.share) {
      try {
        await navigator.share({
          title: `معرفی ملک ${property.code} — ${property.title}`,
          text: publicSummary,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    await navigator.clipboard?.writeText(publicSummary);
    showToast('مشخصات عمومی ملک (بدون اطلاعات محرمانه مالک) کپی شد.', 'success');
  };

  const handleDeleteProperty = async () => {
    if (!property || isViewer) return;
    const confirmed = await askConfirm({
      title: 'حذف پرونده ملکی',
      message: `آیا از حذف پرونده ملکی «${property.title}» (${property.code}) اطمینان دارید؟`,
      confirmLabel: 'بله، حذف شود',
      danger: true,
    });
    if (!confirmed) return;

    const undo = await softDeleteEntity('properties', property.id);
    await refreshSnapshot();
    showToast(`پرونده ملکی ${property.code} حذف شد.`, 'info', async () => {
      await undo();
      await refreshSnapshot();
      showToast(`پرونده ملکی ${property.code} بازیابی شد.`, 'success');
    });
    navigate('/properties');
  };

  if (!property) {
    return (
      <div className="min-h-screen bg-[#0a1328] text-[#dae2ff] flex flex-col items-center justify-center p-6 text-center gap-3">
        <KelidLogoIcon className="w-12 h-12" />
        <p className="text-sm font-bold">پرونده ملکی مورد نظر یافت نشد.</p>
        <button
          type="button"
          onClick={() => navigate('/properties')}
          className="px-4 py-2 rounded-xl bg-[#f1cb83] text-[#261900] text-xs font-bold cursor-pointer"
        >
          بازگشت به فهرست املاک
        </button>
      </div>
    );
  }

  const permitExpired = Boolean(
    property.permitExpiryDate &&
      !property.dismissPermitWarning &&
      isJalaliDateOverdue(property.permitExpiryDate)
  );

  return (
    <div className="min-h-screen bg-[#0a1328] text-[#dae2ff] flex flex-col relative overflow-x-hidden pb-28">
      <AmbientBackground />

      {/* Header with Brand Golden Logo & Status Badge (from Stitch Image 12.html) */}
      <header className="fixed top-0 inset-x-0 z-40 bg-[#050d22]/80 backdrop-blur-xl pt-safe shadow-[0_4px_30px_rgba(0,0,0,0.5)] border-b border-[#f1cb83]/15">
        <div className="h-16 px-5 flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <KelidLogoIcon className="h-10 w-10" />
            <span className="text-base font-extrabold text-[#f1cb83]">کلید</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f1cb83]/10 border border-[#f1cb83]/30">
              <span className="w-2 h-2 rounded-full bg-[#f1cb83] live-dot-pulse" />
              <span className="text-[11px] text-[#f1cb83] font-semibold">
                {property.code} • {property.status}
              </span>
            </div>
            <button
              type="button"
              aria-label="بازگشت"
              onClick={() => {
                markReturningToList();
                navigate(-1);
              }}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#121b30]/70 border border-white/10 text-[#d1c5b4] hover:text-white cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </div>
        </div>
      </header>

      <main className="page-enter-forward flex flex-col relative z-10 w-full pt-20 pb-8 max-w-lg mx-auto px-5 space-y-5 text-right">
        {/* Permit Expiry Warning Banner */}
        {permitExpired && (
          <div className="p-3.5 rounded-2xl bg-red-950/80 border border-red-400/50 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-red-200">
              <span className="material-symbols-outlined text-red-400 text-[20px]">warning</span>
              <span>
                مهلت اعتبار پروانه ساختمانی ({toPersianDigits(property.permitExpiryDate)}) سپری شده است.
              </span>
            </div>
            <button
              type="button"
              onClick={dismissPermitExpiry}
              className="px-2.5 py-1 rounded-lg bg-white/10 text-amber-300 text-[11px] font-bold shrink-0 cursor-pointer"
            >
              دیگر نشان نده
            </button>
          </div>
        )}

        {/* Top Hero Header & Verification Badges (Only existing ones) */}
        <div className="flex flex-col space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-[#d4b06a]/20 border border-[#f1cb83]/30 text-[#f1cb83] text-xs font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">verified</span>
                کد پرونده: {property.code}
              </span>
              {property.registerDate && (
                <span className="px-2.5 py-0.5 rounded-full crystal-sub-glass text-[#d1c5b4] text-[11px]">
                  ثبت: {toPersianDigits(property.registerDate)}
                </span>
              )}
            </div>
          </div>

          <div>
            <h2 className="text-[22px] text-[#dae2ff] font-bold tracking-tight">
              {property.title}
            </h2>
            {(property.province || property.city || property.district || property.accessPath) && (
              <p className="text-sm text-[#d1c5b4] mt-0.5 flex items-center gap-1">
                <span className="material-symbols-outlined text-[18px] text-[#f1cb83]">pin_drop</span>
                <span>
                  {[property.province, property.city, property.district, property.accessPath]
                    .filter(Boolean)
                    .join('، ')}
                </span>
              </p>
            )}
          </div>

          {/* Horizontally Scrollable Chips (showing only existing ones) */}
          <div className="flex items-center gap-2 overflow-x-auto py-1">
            {property.deedType && (
              <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl crystal-sub-glass border border-[#f1cb83]/25">
                <span className="material-symbols-outlined text-[16px] text-[#f1cb83]">
                  workspace_premium
                </span>
                <span className="text-[11px] text-[#f1cb83] font-semibold">
                  {property.deedCustom || property.deedType}
                </span>
              </div>
            )}
            {property.zoningStatus && (
              <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl crystal-sub-glass border border-[#38bdf8]/25">
                <span className="material-symbols-outlined text-[16px] text-[#38bdf8]">domain</span>
                <span className="text-[11px] text-[#38bdf8] font-semibold">
                  {property.zoningStatus}
                </span>
              </div>
            )}
            {property.permitStageType && (
              <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl crystal-sub-glass border border-[#f4cb7f]/25">
                <span className="material-symbols-outlined text-[16px] text-[#f4cb7f]">
                  assignment_turned_in
                </span>
                <span className="text-[11px] text-[#f4cb7f] font-semibold">
                  {property.permitStageType}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Primary Valuation Vault Card */}
        <div className="relative overflow-hidden rounded-2xl crystal-glass p-5 border border-[#f1cb83]/25">
          <div className="relative flex flex-col space-y-3">
            <div className="flex justify-between items-start gap-2">
              <div>
                <span className="text-[11px] text-[#d1c5b4]">ارزش‌گذاری کل کارشناسی</span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-2xl font-black text-[#f1cb83]">
                    {formatWithSeparator(property.totalPrice, true)}
                  </span>
                  <span className="text-xs text-[#e7c17a]">تومان</span>
                </div>
                <p className="text-[11px] text-[#f1cb83]/85 font-medium mt-0.5">
                  {amountToTomanWords(property.totalPrice)} تمام
                </p>
              </div>
              <div className="px-3 py-2 rounded-xl crystal-sub-glass text-center border border-[#f1cb83]/20 shrink-0">
                <span className="block text-[11px] text-[#d1c5b4]">مساحت عرصه</span>
                <span className="text-lg font-semibold text-[#dae2ff]">
                  {formatWithSeparator(property.area, true)}{' '}
                  <span className="text-xs text-[#d1c5b4] font-normal">متر مربع</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="p-2.5 rounded-lg crystal-sub-glass">
                <span className="text-[11px] text-[#d1c5b4] block">بهای هر متر مربع</span>
                <span className="text-base font-semibold text-[#dae2ff]">
                  {formatWithSeparator(property.pricePerMeter, true)}{' '}
                  <span className="text-xs text-[#d1c5b4] font-normal">تومان</span>
                </span>
                <span className="block text-[10px] text-[#d1c5b4] mt-0.5">
                  {amountToTomanWords(property.pricePerMeter)}
                </span>
              </div>
              {property.commissionRate && (
                <div className="p-2.5 rounded-lg crystal-sub-glass">
                  <span className="text-[11px] text-[#d1c5b4] block">حق کمیسیون / شیرینی</span>
                  <span className="text-base font-semibold text-[#b8c5f5]">
                    {property.commissionRate}
                  </span>
                  <span className="block text-[10px] text-[#b8c5f5]/80 mt-0.5">توافق با همکار</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-1 text-[11px] text-[#d1c5b4]">
              {property.paymentMethod && (
                <span className="flex items-center gap-1.5 text-[#dae2ff]">
                  <span className="w-2 h-2 rounded-full bg-[#f1cb83]" />
                  نحوه تسویه: {property.paymentMethod}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-[#dae2ff]">
                <span className="w-2 h-2 rounded-full bg-[#b8c5f5]" />
                مذاکره و تخفیف: {property.negotiable ? 'امکان‌پذیر' : 'مقطوع'}
              </span>
            </div>
          </div>
        </div>

        {/* Photos Section (Photos ONLY — No drone video card, no play button, no 4K badge per spec) */}
        {property.photos && property.photos.length > 0 && (
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">
                  photo_camera
                </span>
                <h3 className="text-base text-[#dae2ff] font-semibold">تصاویر ثبت‌شده ملک</h3>
              </div>
              <span className="text-[11px] text-[#d1c5b4]">
                {toPersianDigits(property.photos.length)} تصویر
              </span>
            </div>

            <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
              {property.photos.map((photo, idx) => {
                const url =
                  photoUrls[photo.mediaId] || photo.fallbackUrl || '/images/kelarabad-land.jpg';
                return (
                  <div
                    key={photo.mediaId + idx}
                    onClick={() => {
                      setZoomScale(1);
                      setLightboxIdx(idx);
                    }}
                    className="relative w-64 h-40 shrink-0 rounded-xl overflow-hidden crystal-glass cursor-pointer group border border-[#f1cb83]/30"
                  >
                    <img
                      src={url}
                      alt={photo.label}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#050d22]/85 via-transparent to-transparent" />
                    <div className="absolute bottom-2 inset-x-2.5 flex items-center justify-between text-xs">
                      <span className="text-[11px] font-semibold text-[#dae2ff] truncate">
                        {photo.label}
                      </span>
                      <span className="material-symbols-outlined text-[#f1cb83] text-[16px]">
                        zoom_in
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Dynamic Technical Specs Bento Matrix (Only filled fields rendered) */}
        {technicalSpecs.length > 0 && (
          <div className="flex flex-col space-y-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">
                architecture
              </span>
              <h3 className="text-base text-[#dae2ff] font-semibold">شناسنامه فنی و کاربری</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {technicalSpecs.map((spec, i) => (
                <div
                  key={i}
                  className="p-3 rounded-xl crystal-glass flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between text-[#d1c5b4] mb-1">
                    <span className="text-[11px]">{spec.label}</span>
                    <span className="material-symbols-outlined text-[18px] text-[#f1cb83]">
                      {spec.icon}
                    </span>
                  </div>
                  <span className="text-base font-semibold text-[#dae2ff]">{spec.value}</span>
                  {spec.sub && <span className="text-[11px] text-[#d1c5b4] mt-0.5">{spec.sub}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Legal & Permitting Section (Only if filled) */}
        {(property.deedType || property.permitNo || property.inquiryStatus) && (
          <div className="rounded-xl crystal-glass p-4 flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">gavel</span>
                <h3 className="text-base text-[#dae2ff] font-semibold">استعلامات حقوقی و پروانه</h3>
              </div>
              {property.inquiryStatus && (
                <span className="px-2.5 py-0.5 rounded-full bg-[#38456e]/40 text-[#b8c5f5] text-[11px] border border-[#b8c5f5]/30">
                  {property.inquiryStatus}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {property.deedType && (
                <div className="flex items-center justify-between p-2.5 rounded-lg crystal-sub-glass">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#f1cb83] text-[18px]">
                      description
                    </span>
                    <div>
                      <span className="text-xs text-[#dae2ff] block font-medium">نوع سند مالکیت</span>
                      <span className="text-[11px] text-[#d1c5b4]">{property.deedType}</span>
                    </div>
                  </div>
                  {property.deedCustom && (
                    <span className="text-xs text-[#f1cb83] font-semibold">
                      {property.deedCustom}
                    </span>
                  )}
                </div>
              )}
              {property.permitNo && (
                <div className="flex items-center justify-between p-2.5 rounded-lg crystal-sub-glass">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#f4cb7f] text-[18px]">
                      receipt_long
                    </span>
                    <div>
                      <span className="text-xs text-[#dae2ff] block font-medium">
                        شماره پروانه ساختمانی
                      </span>
                      {property.substructureArea && (
                        <span className="text-[11px] text-[#d1c5b4]">
                          زیربنا: {toPersianDigits(property.substructureArea)} متر مربع{' '}
                          {property.densityFloors || ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-left">
                    <span className="text-xs text-[#dae2ff] block font-semibold">
                      {property.permitNo}
                    </span>
                    {property.permitExpiryDate && (
                      <span className="text-[11px] text-[#d1c5b4]">
                        تا {toPersianDigits(property.permitExpiryDate)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Uploaded Documents Section («اسناد و مدارک» per spec) */}
        {visibleDocuments.length > 0 && (
          <div className="rounded-xl crystal-glass p-4 flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">
                  folder_Special
                </span>
                <h3 className="text-base text-[#dae2ff] font-semibold">اسناد و مدارک ضمیمه</h3>
              </div>
              <span className="text-[11px] text-[#f1cb83]">
                {toPersianDigits(visibleDocuments.length)} سند
              </span>
            </div>
            <div className="space-y-2">
              {visibleDocuments.map((doc) => (
                <div
                  key={doc.mediaId}
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
                  className="p-2.5 rounded-lg crystal-sub-glass flex items-center justify-between gap-2 cursor-pointer hover:border-[#f1cb83]/40"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-[#f1cb83] text-[18px]">
                      picture_as_pdf
                    </span>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-[#dae2ff] block truncate">
                        {doc.name}
                      </span>
                      {doc.extractedText && (
                        <span className="text-[10px] text-emerald-300 block truncate">
                          {doc.extractedText}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-[#f1cb83] text-[18px]">
                    open_in_new
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Location, Map & Voice Memo (Only if coordinates or address/voice exist) */}
        {(property.lat !== undefined || property.exactAddress || property.voiceTranscript) && (
          <div className="rounded-xl crystal-glass p-4 flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">map</span>
                <h3 className="text-base text-[#dae2ff] font-semibold">موقعیت مکانی</h3>
              </div>
              {property.lat !== undefined && property.lng !== undefined && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(`${property.lat}, ${property.lng}`);
                    showToast('مختصات جغرافیایی کپی شد!', 'success');
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md crystal-sub-glass border border-[#f1cb83]/20 text-[#d1c5b4] hover:text-[#f1cb83] text-xs font-mono cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[13px]">content_copy</span>
                  <span>
                    {property.lat.toFixed(4)}, {property.lng.toFixed(4)}
                  </span>
                </button>
              )}
            </div>

            {property.lat !== undefined && property.lng !== undefined && (
              <>
                <div
                  onClick={() => openMapChooser(property.lat!, property.lng!, property.title)}
                  className="relative w-full h-44 rounded-xl overflow-hidden bg-cover bg-center border border-white/10 group cursor-pointer"
                  style={{ backgroundImage: `url('/images/kelarabad-land.jpg')` }}
                >
                  <div className="absolute inset-0 bg-[#050d22]/45 group-hover:bg-[#050d22]/25 transition-colors" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#d4b06a] to-[#f1cb83] text-[#261900] flex items-center justify-center shadow-[0_0_20px_rgba(212,176,106,0.85)]">
                      <span className="material-symbols-outlined text-[22px]">location_on</span>
                    </div>
                  </div>
                  <div className="absolute bottom-2 inset-x-2 flex justify-between items-center bg-[#050d22]/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-[#f1cb83]/20">
                    <span className="text-[11px] text-[#dae2ff] truncate">
                      {property.exactAddress || `${property.city}، ${property.district}`}
                    </span>
                    {property.lotLabel && (
                      <span className="text-[11px] text-[#f1cb83] shrink-0 font-semibold">
                        {property.lotLabel}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openMapChooser(property.lat!, property.lng!, property.title)}
                  className="w-full h-11 flex items-center justify-center gap-2 rounded-xl crystal-sub-glass text-[#dae2ff] hover:text-[#f1cb83] hover:border-[#f1cb83]/50 text-xs font-semibold cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px] text-[#f1cb83]">
                    directions
                  </span>
                  <span>مسیریابی (انتخاب برنامه نقشه)</span>
                </button>
              </>
            )}

            {/* Saved Voice Note & Transcript */}
            {(property.voiceTranscript || voiceUrl) && (
              <div className="p-3 rounded-xl crystal-sub-glass border border-[#f1cb83]/20 flex flex-col space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#d1c5b4] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-[#f1cb83]">mic</span>
                    توضیح صوتی مشاور درباره مسیر
                  </span>
                </div>
                {voiceUrl && (
                  <audio
                    ref={audioRef}
                    src={voiceUrl}
                    controls
                    onPlay={() => setIsPlayingVoice(true)}
                    onPause={() => setIsPlayingVoice(false)}
                    className="w-full h-9"
                  />
                )}
                {property.voiceTranscript && (
                  <p className="text-[11px] text-[#d1c5b4] bg-[#050d22]/60 border border-white/5 p-2.5 rounded-lg leading-relaxed">
                    <span className="text-[#f1cb83] font-semibold">متن پیاده‌شده: </span>«
                    {property.voiceTranscript}»
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Confidential Owner & Broker Vault (Manager ONLY — completely hidden for others per spec) */}
        {isManager && (
          <div className="rounded-xl crystal-glass p-4 flex flex-col space-y-3 border border-[#f1cb83]/25">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#f1cb83]/20 border border-[#f1cb83]/40 flex items-center justify-center text-[#f1cb83]">
                  <span className="material-symbols-outlined text-[19px]">verified_user</span>
                </div>
                <div>
                  <h3 className="text-base text-[#f1cb83] font-semibold">اطلاعات مالک</h3>
                  <span className="text-[11px] text-[#d1c5b4]">دسترسی انحصاری مدیر ارشد</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f1cb83]/15 border border-[#f1cb83]/40 text-[#f1cb83] text-[11px] font-bold">
                <span className="w-2 h-2 rounded-full bg-[#f1cb83] live-dot-pulse" />
                <span>محرمانه</span>
              </div>
            </div>

            <div className="p-3 rounded-xl crystal-sub-glass flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-[#d1c5b4] shrink-0">
                  <span className="material-symbols-outlined text-[22px]">person</span>
                </div>
                <div className="min-w-0">
                  <span className="text-sm text-[#dae2ff] font-bold block truncate">
                    {property.ownerName} (مالک)
                  </span>
                  <span className="text-[11px] text-[#d1c5b4] font-mono">
                    {toPersianDigits(property.ownerPhone || 'شماره ثبت نشده')}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    triggerSms(
                      property.ownerPhone,
                      `با سلام، در خصوص فایل ملکی ${property.title} (کد ${property.code}) از دفتر املاک کلید پیام می‌دهم.`,
                      () => showToast('شماره تماس مالک ثبت نشده است', 'error')
                    )
                  }
                  className="h-10 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-[#f1cb83] border border-[#f1cb83]/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[17px]">chat</span>
                  <span>پیامک</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerPhoneCall(property.ownerPhone, () =>
                      showToast('شماره تماس مالک ثبت نشده است', 'error')
                    )
                  }
                  className="h-10 px-3.5 rounded-xl bg-gradient-to-r from-[#f1cb83] to-[#d4b06a] text-[#261900] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[17px]">call</span>
                  <span>تماس مستقیم</span>
                </button>
              </div>
            </div>

            {(property.contactPartnerName || property.lastContactDate || property.nextFollowupDate) && (
              <div className="grid grid-cols-2 gap-2">
                {property.contactPartnerName && (
                  <div
                    onClick={() => {
                      if (property.referrerCollaboratorId) {
                        navigate(`/collaborators/${property.referrerCollaboratorId}/edit`);
                      }
                    }}
                    className="p-2.5 rounded-lg crystal-sub-glass cursor-pointer hover:border-[#f1cb83]/40"
                  >
                    <span className="text-[11px] text-[#d1c5b4] block">معرف / همکار</span>
                    <span className="text-xs text-[#dae2ff] font-semibold">
                      {property.contactPartnerName}
                    </span>
                    <span className="text-[10px] text-[#f1cb83] block mt-0.5">
                      منبع: {property.contactSource || 'همکار معتمد'}
                    </span>
                  </div>
                )}
                {(property.lastContactDate || property.nextFollowupDate) && (
                  <div className="p-2.5 rounded-lg crystal-sub-glass">
                    <span className="text-[11px] text-[#d1c5b4] block">تاریخچه تماس</span>
                    {property.lastContactDate && (
                      <span className="text-xs text-[#dae2ff] font-semibold block">
                        آخرین: {toPersianDigits(property.lastContactDate)}
                      </span>
                    )}
                    {property.nextFollowupDate && (
                      <span className="text-[10px] text-[#b8c5f5] block mt-0.5">
                        پیگیری بعدی: {toPersianDigits(property.nextFollowupDate)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {property.internalNotes && (
              <div className="p-2.5 rounded-lg crystal-sub-glass text-[#d1c5b4] text-[11px] leading-relaxed">
                <span className="text-[#f1cb83] font-semibold block mb-0.5">
                  یادداشت داخلی پرونده:
                </span>
                {property.internalNotes}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Fixed Bottom Sticky Bar */}
      <aside className="fixed bottom-0 inset-x-0 z-50 pb-safe bg-[#050d22]/85 backdrop-blur-xl border-t border-[#f1cb83]/20 shadow-[0_-12px_45px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-2.5 h-20 px-5 max-w-lg mx-auto">
          {!isViewer && (
            <button
              type="button"
              onClick={() => navigate(`/properties/${property.id}/edit`)}
              className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#d4b06a] via-[#f1cb83] to-[#d4b06a] text-[#261900] text-sm font-bold shadow-[0_0_25px_rgba(212,176,106,0.45)] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">edit_square</span>
              <span>ویرایش فایل</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleSharePropertyPublic}
            title="اشتراک‌گذاری مشخصات عمومی"
            className="h-12 px-3.5 flex items-center justify-center gap-1 rounded-xl bg-[#f1cb83]/15 hover:bg-[#f1cb83]/25 text-[#f1cb83] text-xs font-bold border border-[#f1cb83]/35 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">share</span>
            <span>ارسال</span>
          </button>
          {!isViewer && (
            <button
              type="button"
              onClick={handleDeleteProperty}
              title="حذف پرونده ملکی"
              className="h-12 px-3 flex items-center justify-center rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="h-12 px-4 flex items-center justify-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-[#dae2ff] text-sm font-medium border border-white/10 cursor-pointer"
          >
            <span>✕ بستن</span>
          </button>
        </div>
      </aside>

      {/* Fullscreen Photo Lightbox with Swipe & Pinch/Button Zoom */}
      {lightboxIdx !== null && property.photos[lightboxIdx] && (
        <div
          className="fixed inset-0 z-[140] bg-black/95 backdrop-blur-xl flex flex-col justify-between p-4"
          onClick={() => setLightboxIdx(null)}
        >
          <div
            className="flex items-center justify-between text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-xs font-bold text-[#f1cb83]">
              {property.photos[lightboxIdx].label} ({toPersianDigits(lightboxIdx + 1)} از{' '}
              {toPersianDigits(property.photos.length)})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoomScale((s) => (s >= 2 ? 1 : s + 0.5))}
                className="px-2.5 py-1 rounded-lg bg-white/10 text-xs font-bold cursor-pointer"
              >
                بزرگ‌نمایی {toPersianDigits(zoomScale)}x
              </button>
              <button
                type="button"
                onClick={() => setLightboxIdx(null)}
                className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>

          <div
            className="flex-1 flex items-center justify-center overflow-hidden my-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={
                photoUrls[property.photos[lightboxIdx].mediaId] ||
                property.photos[lightboxIdx].fallbackUrl ||
                '/images/kelarabad-land.jpg'
              }
              alt={property.photos[lightboxIdx].label}
              referrerPolicy="no-referrer"
              style={{ transform: `scale(${zoomScale})` }}
              className="max-h-[75vh] max-w-full object-contain transition-transform duration-200 rounded-xl"
            />
          </div>

          {property.photos.length > 1 && (
            <div
              className="flex items-center justify-center gap-4 pb-2"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setZoomScale(1);
                  setLightboxIdx(
                    (lightboxIdx - 1 + property.photos.length) % property.photos.length
                  );
                }}
                className="px-4 py-2 rounded-xl bg-white/10 text-[#f1cb83] text-xs font-bold cursor-pointer"
              >
                تصویر قبلی
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoomScale(1);
                  setLightboxIdx((lightboxIdx + 1) % property.photos.length);
                }}
                className="px-4 py-2 rounded-xl bg-white/10 text-[#f1cb83] text-xs font-bold cursor-pointer"
              >
                تصویر بعدی
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
