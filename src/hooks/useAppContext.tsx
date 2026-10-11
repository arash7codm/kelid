import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import logoPng1x from '../assets/kelid-logo-1x.png';
import logoWebp1x from '../assets/kelid-logo-1x.webp';
import logoPng2x from '../assets/kelid-logo-2x.png';
import logoWebp2x from '../assets/kelid-logo-2x.webp';
import { UserRole } from '../config';
import {
  ensureSeedData,
  getGlobalAppSnapshot,
  GlobalAppSnapshot,
} from '../db/repositories';
import { livingGlassScheduler } from '../motion';
import {
  AuthUserProfile,
  getCurrentUserRole,
  initAuth,
  setCurrentUserRole,
} from '../services/auth';

export type PermissionKey =
  | 'microphone'
  | 'camera'
  | 'geolocation'
  | 'clipboard'
  | 'calendar'
  | 'notifications'
  | 'files';

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  undoAction?: () => Promise<void> | void;
}

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (confirmed: boolean) => void;
}

export interface PermissionDialogState {
  permission: PermissionKey;
  title: string;
  description: string;
  eventPreview?: {
    title: string;
    dateLabel: string;
    timeLabel: string;
  };
  resolve: (allowed: boolean) => void;
}

export interface MapChooserState {
  lat: number;
  lng: number;
  label: string;
}

export interface PropertyFilterState {
  searchQuery: string;
  quickChip: string;
  propertyTypes: string[];
  city: string;
  status: string;
  zoning: string;
  deed: string;
  minArea: string;
  maxArea: string;
  minBudget: string;
  maxBudget: string;
  sortBy: 'cheapest' | 'ppm' | 'area' | 'newest';
  sortAsc: boolean;
  collaboratorIdFilter?: string;
}

export interface ApplicantFilterState {
  searchQuery: string;
  tab: 'all' | 'following' | 'new' | 'visit' | 'done' | 'overdue';
  dealType: string;
  city: string;
  priority: string;
  creditTier: string;
  minBudget: string;
  maxBudget: string;
}

export interface CollaboratorFilterState {
  searchQuery: string;
  cityChip: string;
  tierFilter: string;
  statusFilter: string;
  commissionFilter: string;
  minCreditScore: number;
}

export interface SearchFilterState {
  query: string;
  scope: 'all' | 'properties' | 'applicants' | 'collaborators' | 'high_match';
  sortByMatch: boolean;
}

const DEFAULT_PROPERTY_FILTERS: PropertyFilterState = {
  searchQuery: '',
  quickChip: 'all',
  propertyTypes: [],
  city: 'همه',
  status: 'همه وضعیت‌ها',
  zoning: 'همه',
  deed: '',
  minArea: '',
  maxArea: '',
  minBudget: '',
  maxBudget: '',
  sortBy: 'newest',
  sortAsc: false,
};

const DEFAULT_APPLICANT_FILTERS: ApplicantFilterState = {
  searchQuery: '',
  tab: 'all',
  dealType: '',
  city: '',
  priority: '',
  creditTier: '',
  minBudget: '',
  maxBudget: '',
};

const DEFAULT_COLLABORATOR_FILTERS: CollaboratorFilterState = {
  searchQuery: '',
  cityChip: 'all',
  tierFilter: '',
  statusFilter: '',
  commissionFilter: '',
  minCreditScore: 0,
};

const DEFAULT_SEARCH_STATE: SearchFilterState = {
  query: '',
  scope: 'all',
  sortByMatch: true,
};

interface AppContextValue {
  snapshot: GlobalAppSnapshot | null;
  loading: boolean;
  isOnline: boolean;
  currentUser: AuthUserProfile;
  setRole: (role: UserRole) => void;
  refreshSnapshot: () => Promise<void>;
  showToast: (
    message: string,
    type?: 'success' | 'error' | 'info',
    undoAction?: () => Promise<void> | void
  ) => void;
  askConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  askPermission: (
    permission: PermissionKey,
    eventPreview?: { title: string; dateLabel: string; timeLabel: string }
  ) => Promise<boolean>;
  openMapChooser: (lat: number, lng: number, label?: string) => void;
  isQuickCreateOpen: boolean;
  setQuickCreateOpen: (open: boolean) => void;
  propertyFilters: PropertyFilterState;
  setPropertyFilters: React.Dispatch<React.SetStateAction<PropertyFilterState>>;
  resetPropertyFilters: () => void;
  applicantFilters: ApplicantFilterState;
  setApplicantFilters: React.Dispatch<React.SetStateAction<ApplicantFilterState>>;
  resetApplicantFilters: () => void;
  collaboratorFilters: CollaboratorFilterState;
  setCollaboratorFilters: React.Dispatch<React.SetStateAction<CollaboratorFilterState>>;
  resetCollaboratorFilters: () => void;
  searchState: SearchFilterState;
  setSearchState: React.Dispatch<React.SetStateAction<SearchFilterState>>;
  resetSearchState: () => void;
  inboxInitialTab: string;
  setInboxInitialTab: (tab: string) => void;
  highlightedReminderId: string | null;
  setHighlightedReminderId: (id: string | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const PERMISSION_META: Record<PermissionKey, { title: string; description: string }> = {
  microphone: {
    title: 'مجوز دسترسی به میکروفون',
    description:
      'برای ضبط یادداشت صوتی مشاور، جستجوی صوتی و تبدیل گفتار به متن فارسی، برنامه کلید نیازمند دسترسی به میکروفون دستگاه شما است.',
  },
  camera: {
    title: 'مجوز دسترسی به دوربین',
    description:
      'برای ثبت مستقیم تصاویر محیطی از ملک و مستندات پرونده، برنامه کلید نیازمند دسترسی به دوربین گوشی است.',
  },
  geolocation: {
    title: 'مجوز دریافت موقعیت دقیق GPS',
    description:
      'برای ثبت مختصات دقیق جغرافیایی زمین یا ملک روی نقشه با دقت بالا، اجازه دسترسی به مکان‌یاب (GPS) را صادر فرمایید.',
  },
  clipboard: {
    title: 'مجوز خواندن حافظه کلیپ‌بورد',
    description:
      'برای استخراج خودکار مختصات یا لینک کپی‌شده از گوگل مپ، نشان و بلد، اجازه دسترسی به کلیپ‌بورد را تایید فرمایید.',
  },
  calendar: {
    title: 'مجوز ثبت رویداد در تقویم و آلارم گوشی',
    description:
      'برای ثبت دقیق یادآور و فعال‌سازی زنگ هشدار تقویم در زمان مقرر، جزئیات زیر در تقویم شما ثبت خواهد شد:',
  },
  notifications: {
    title: 'مجوز ارسال اعلان و هشدار پیگیری',
    description:
      'برای نمایش به‌موقع یادآورهای تماس، بازدید و تطبیق‌های هوشمند املاک، مجوز اعلان‌ها را فعال نمایید.',
  },
  files: {
    title: 'مجوز انتخاب فایل و تصاویر از گالری',
    description:
      'برای بارگذاری عکس‌های ملک یا اسناد ثبتی (PDF / تصویر سند تک‌برگ و کاداستر)، دسترسی به فایل‌های دستگاه لازم است.',
  },
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [snapshot, setSnapshot] = useState<GlobalAppSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [currentUser, setCurrentUser] = useState<AuthUserProfile>({
    uid: 'local_manager',
    name: localStorage.getItem('kelid_user_name') || 'مدیر ارشد کلید',
    email: localStorage.getItem('kelid_user_email') || 'markymahdi78@gmail.com',
    role: getCurrentUserRole(),
  });

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [permissionDialog, setPermissionDialog] = useState<PermissionDialogState | null>(null);
  const [mapChooser, setMapChooser] = useState<MapChooserState | null>(null);
  const [isQuickCreateOpen, setQuickCreateOpen] = useState(false);

  const [propertyFilters, setPropertyFilters] = useState<PropertyFilterState>(DEFAULT_PROPERTY_FILTERS);
  const [applicantFilters, setApplicantFilters] = useState<ApplicantFilterState>(DEFAULT_APPLICANT_FILTERS);
  const [collaboratorFilters, setCollaboratorFilters] = useState<CollaboratorFilterState>(DEFAULT_COLLABORATOR_FILTERS);
  const [searchState, setSearchState] = useState<SearchFilterState>(DEFAULT_SEARCH_STATE);
  const [inboxInitialTab, setInboxInitialTab] = useState('today');
  const [highlightedReminderId, setHighlightedReminderId] = useState<string | null>(null);

  const refreshSnapshot = useCallback(async () => {
    const snap = await getGlobalAppSnapshot();
    setSnapshot(snap);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await ensureSeedData();
        const snap = await getGlobalAppSnapshot();
        if (mounted) {
          setSnapshot(snap);
          setLoading(false);
        }
      } catch (e) {
        console.error('DB Init Error:', e);
        if (mounted) setLoading(false);
      }
    })();

    const unsubAuth = initAuth((profile) => {
      localStorage.setItem('kelid_user_name', profile.name);
      localStorage.setItem('kelid_user_email', profile.email);
      setCurrentUser(profile);
    });

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    livingGlassScheduler.start();

    return () => {
      mounted = false;
      unsubAuth();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      livingGlassScheduler.stop();
    };
  }, []);

  useEffect(() => {
    const anyModal = Boolean(confirmDialog || permissionDialog || mapChooser || isQuickCreateOpen);
    livingGlassScheduler.setModalOpen(anyModal);
  }, [confirmDialog, permissionDialog, mapChooser, isQuickCreateOpen]);

  const setRole = useCallback((role: UserRole) => {
    setCurrentUserRole(role);
    setCurrentUser((prev) => ({ ...prev, role }));
  }, []);

  const showToast = useCallback(
    (
      message: string,
      type: 'success' | 'error' | 'info' = 'success',
      undoAction?: () => Promise<void> | void
    ) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      setToasts((prev) => [{ id, message, type, undoAction }, ...prev.slice(0, 2)]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, undoAction ? 5500 : 3500);
    },
    []
  );

  const askConfirm = useCallback(
    (opts: {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
    }) => {
      return new Promise<boolean>((resolve) => {
        setConfirmDialog({
          ...opts,
          resolve: (val) => {
            setConfirmDialog(null);
            resolve(val);
          },
        });
      });
    },
    []
  );

  const askPermission = useCallback(
    (
      permission: PermissionKey,
      eventPreview?: { title: string; dateLabel: string; timeLabel: string }
    ) => {
      // If already granted in session (except calendar which always previews exact event per spec)
      const sessionKey = `kelid_perm_${permission}`;
      if (permission !== 'calendar' && sessionStorage.getItem(sessionKey) === 'granted') {
        return Promise.resolve(true);
      }
      const meta = PERMISSION_META[permission];
      return new Promise<boolean>((resolve) => {
        setPermissionDialog({
          permission,
          title: meta.title,
          description: meta.description,
          eventPreview,
          resolve: (allowed) => {
            setPermissionDialog(null);
            if (allowed && permission !== 'calendar') {
              sessionStorage.setItem(sessionKey, 'granted');
            }
            resolve(allowed);
          },
        });
      });
    },
    []
  );

  const openMapChooser = useCallback((lat: number, lng: number, label = 'موقعیت ملک') => {
    setMapChooser({ lat, lng, label });
  }, []);

  const resetPropertyFilters = useCallback(() => {
    setPropertyFilters(DEFAULT_PROPERTY_FILTERS);
  }, []);

  const resetApplicantFilters = useCallback(() => {
    setApplicantFilters(DEFAULT_APPLICANT_FILTERS);
  }, []);

  const resetCollaboratorFilters = useCallback(() => {
    setCollaboratorFilters(DEFAULT_COLLABORATOR_FILTERS);
  }, []);

  const resetSearchState = useCallback(() => {
    setSearchState(DEFAULT_SEARCH_STATE);
  }, []);

  return (
    <AppContext.Provider
      value={{
        snapshot,
        loading,
        isOnline,
        currentUser,
        setRole,
        refreshSnapshot,
        showToast,
        askConfirm,
        askPermission,
        openMapChooser,
        isQuickCreateOpen,
        setQuickCreateOpen,
        propertyFilters,
        setPropertyFilters,
        resetPropertyFilters,
        applicantFilters,
        setApplicantFilters,
        resetApplicantFilters,
        collaboratorFilters,
        setCollaboratorFilters,
        resetCollaboratorFilters,
        searchState,
        setSearchState,
        resetSearchState,
        inboxInitialTab,
        setInboxInitialTab,
        highlightedReminderId,
        setHighlightedReminderId,
      }}
    >
      {children}

      {/* Global Toast Stack */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] w-full max-w-sm px-4 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-enter pointer-events-auto rounded-2xl px-4 py-3 border shadow-[0_12px_36px_rgba(0,0,0,0.75)] backdrop-blur-xl flex items-center justify-between gap-3 text-xs font-bold ${
              t.type === 'error'
                ? 'bg-[#2a0910]/95 border-red-400/50 text-red-200'
                : 'bg-[#0a1328]/95 border-[#f1cb83]/45 text-[#f1cb83]'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <picture className="inline-flex items-center justify-center shrink-0 select-none">
                <source type="image/webp" srcSet={`${logoWebp1x} 1x, ${logoWebp2x} 2x`} />
                <img
                  src={logoPng1x}
                  srcSet={`${logoPng1x} 1x, ${logoPng2x} 2x`}
                  alt="کلید"
                  className="w-6 h-6 object-contain select-none"
                />
              </picture>
              <span className="leading-relaxed">{t.message}</span>
            </div>
            {t.undoAction && (
              <button
                type="button"
                onClick={async () => {
                  setToasts((prev) => prev.filter((item) => item.id !== t.id));
                  await t.undoAction?.();
                  await refreshSnapshot();
                }}
                className="px-2.5 py-1 rounded-lg bg-[#f1cb83] text-[#261900] text-[11px] font-extrabold shrink-0 hover:brightness-110"
              >
                واگرد (Undo)
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Offline Banner */}
      {!isOnline && (
        <div className="fixed top-0 inset-x-0 z-[110] bg-amber-500/95 text-[#261900] text-[11px] font-bold py-1 px-3 text-center flex items-center justify-center gap-1.5 shadow-md">
          <span className="material-symbols-outlined text-[15px]">wifi_off</span>
          <span>حالت آفلاین فعال است — تمام تغییرات در حافظه امن دستگاه ذخیره می‌شوند</span>
        </div>
      )}

      {/* Global Confirmation Dialog */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => confirmDialog.resolve(false)}
        >
          <div
            className="sheet-enter-up w-full max-w-sm rounded-2xl bg-[#0a152d]/95 border border-[#f1cb83]/35 p-5 shadow-2xl flex flex-col gap-4 text-center relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 mx-auto rounded-full bg-amber-400/15 border border-amber-400/35 flex items-center justify-center text-[#f1cb83]">
              <span className="material-symbols-outlined text-[26px]">
                {confirmDialog.danger ? 'warning' : 'help'}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[16px] font-bold text-[#dae2ff]">{confirmDialog.title}</h3>
              <p className="text-[12px] text-[#d1c5b4] leading-relaxed">{confirmDialog.message}</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => confirmDialog.resolve(true)}
                className={`py-2.5 px-3 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                  confirmDialog.danger
                    ? 'bg-red-500/20 border border-red-400/40 text-red-300 hover:bg-red-500/30'
                    : 'bg-gradient-to-r from-[#d4b06a] to-[#f1cb83] text-[#261900]'
                }`}
              >
                {confirmDialog.confirmLabel || 'بله، تایید'}
              </button>
              <button
                type="button"
                onClick={() => confirmDialog.resolve(false)}
                className="py-2.5 px-3 rounded-xl bg-white/10 border border-white/15 text-[#dae2ff] font-bold text-xs hover:bg-white/15 transition-all cursor-pointer"
              >
                {confirmDialog.cancelLabel || 'انصراف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Just-in-Time Permission Dialog */}
      {permissionDialog && (
        <div
          className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => permissionDialog.resolve(false)}
        >
          <div
            className="sheet-enter-up w-full max-w-sm rounded-2xl bg-[#0a152d]/95 border border-[#f1cb83]/40 p-5 shadow-2xl flex flex-col gap-4 text-right relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-white/10 pb-3">
              <picture className="inline-flex items-center justify-center shrink-0 select-none">
                <source type="image/webp" srcSet={`${logoWebp1x} 1x, ${logoWebp2x} 2x`} />
                <img
                  src={logoPng1x}
                  srcSet={`${logoPng1x} 1x, ${logoPng2x} 2x`}
                  alt="کلید"
                  className="w-8 h-8 object-contain select-none"
                />
              </picture>
              <h3 className="text-[15px] font-bold text-[#f1cb83]">{permissionDialog.title}</h3>
            </div>
            <p className="text-[12px] text-[#dae2ff] leading-relaxed">
              {permissionDialog.description}
            </p>
            {permissionDialog.eventPreview && (
              <div className="p-3 rounded-xl bg-[#050b17]/80 border border-[#f1cb83]/25 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#d1c5b4]">عنوان رویداد:</span>
                  <span className="font-bold text-[#dae2ff]">{permissionDialog.eventPreview.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#d1c5b4]">تاریخ شمسی:</span>
                  <span className="font-bold text-[#f1cb83]">{permissionDialog.eventPreview.dateLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#d1c5b4]">ساعت و هشدار:</span>
                  <span className="font-bold text-emerald-300">
                    {permissionDialog.eventPreview.timeLabel} (آلارم ۱۵ دقیقه قبل)
                  </span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => permissionDialog.resolve(true)}
                className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#261900] font-bold text-xs shadow-md cursor-pointer"
              >
                مجاز است (Allow)
              </button>
              <button
                type="button"
                onClick={() => permissionDialog.resolve(false)}
                className="py-2.5 px-3 rounded-xl bg-white/10 border border-white/15 text-[#d1c5b4] font-semibold text-xs cursor-pointer"
              >
                فعلاً نه (Not now)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Map-App Chooser Sheet (Asks EVERY time per specification) */}
      {mapChooser && (
        <MapChooserModal
          lat={mapChooser.lat}
          lng={mapChooser.lng}
          label={mapChooser.label}
          onClose={() => setMapChooser(null)}
        />
      )}
    </AppContext.Provider>
  );
};

import { getMapAppOptions } from '../services/maps';
import { toPersianDigits } from '../utils/persian';

const MapChooserModal: React.FC<{
  lat: number;
  lng: number;
  label: string;
  onClose: () => void;
}> = ({ lat, lng, label, onClose }) => {
  const options = getMapAppOptions(lat, lng, label);
  return (
    <div
      className="fixed inset-0 z-[135] bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="sheet-enter-up w-full max-w-sm rounded-3xl bg-[#0a1328]/95 border border-[#f1cb83]/35 p-5 shadow-2xl space-y-3.5 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#f1cb83] text-[22px]">explore</span>
            <div>
              <h3 className="text-[14px] font-bold text-[#dae2ff]">انتخاب برنامه مسیریاب</h3>
              <p className="text-[11px] text-[#d1c5b4] truncate max-w-[220px]">
                {label} ({toPersianDigits(lat.toFixed(4))}, {toPersianDigits(lng.toFixed(4))})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-[#d1c5b4]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {options.map((opt) => (
            <a
              key={opt.id}
              href={opt.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setTimeout(onClose, 150)}
              className="p-3 rounded-2xl bg-[#050b17]/75 border border-white/10 hover:border-[#f1cb83]/50 flex items-center justify-between transition-all"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/30 flex items-center justify-center text-[#f1cb83]">
                  <span className="material-symbols-outlined text-[20px]">{opt.icon}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-[#dae2ff]">{opt.name}</span>
                  <span className="text-[10px] text-[#d1c5b4]">{opt.subtitle}</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-[#f1cb83] text-[18px]">arrow_back</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
