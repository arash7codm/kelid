import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import logoPng1x from '../assets/kelid-logo-1x.png';
import logoWebp1x from '../assets/kelid-logo-1x.webp';
import logoPng2x from '../assets/kelid-logo-2x.png';
import logoWebp2x from '../assets/kelid-logo-2x.webp';
import { useApp } from '../hooks/useAppContext';
import { clearSavedListScrolls, runWithViewTransition } from '../motion';

export const AmbientBackground: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden bg-gradient-to-b from-[#060a16] via-[#091124] to-[#040813]">
      {/* Moving Layer 1: Warm Gold Radial Flare */}
      <div className="ambient-layer-1 absolute -top-32 right-[-10%] w-[420px] h-[420px] bg-gradient-to-br from-[#f1cb83]/25 via-[#d4b06a]/10 to-transparent rounded-full blur-[90px]" />

      {/* Moving Layer 2: Sapphire & Gold Mid Drift */}
      <div className="ambient-layer-2 absolute top-1/3 -left-28 w-[380px] h-[380px] bg-gradient-to-tr from-[#38bdf8]/15 via-[#f1cb83]/10 to-transparent rounded-full blur-[85px]" />

      {/* Moving Layer 3: Architectural Gold Sketch Grid & Bottom Aura */}
      <div className="ambient-layer-3 absolute inset-0">
        <svg className="w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="kelidGoldSketch" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f1cb83" stopOpacity="0.35" />
              <stop offset="50%" stopColor="#d4b06a" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#f1cb83" stopOpacity="0.25" />
            </linearGradient>
          </defs>
          <path
            d="M -50,180 L 450,260 M 380,80 L 100,520 M -30,420 L 480,360 M 40,700 L 420,620"
            fill="none"
            stroke="url(#kelidGoldSketch)"
            strokeDasharray="12 8"
            strokeWidth="0.85"
          />
          <circle
            cx="280"
            cy="340"
            r="160"
            fill="none"
            stroke="#f1cb83"
            strokeOpacity="0.07"
            strokeWidth="1"
          />
        </svg>
      </div>
    </div>
  );
};

export const KelidLogoIcon: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => (
  <picture className="inline-flex items-center justify-center shrink-0 select-none">
    <source type="image/webp" srcSet={`${logoWebp1x} 1x, ${logoWebp2x} 2x`} />
    <img
      src={logoPng1x}
      srcSet={`${logoPng1x} 1x, ${logoPng2x} 2x`}
      alt="کلید"
      decoding="async"
      className={`${className} object-contain select-none`}
    />
  </picture>
);

export const BottomNavAndQuickMenu: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, isQuickCreateOpen, setQuickCreateOpen } = useApp();

  const isViewer = currentUser.role === 'بیننده';
  const path = location.pathname;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isQuickCreateOpen) {
        setQuickCreateOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isQuickCreateOpen, setQuickCreateOpen]);

  const goTab = (target: string) => {
    if (isQuickCreateOpen) setQuickCreateOpen(false);
    clearSavedListScrolls();
    if (path === target) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      return;
    }
    runWithViewTransition(() => {
      navigate(target, { state: { resetScroll: true } });
    });
  };

  const selectQuickAction = (route: string) => {
    setQuickCreateOpen(false);
    clearSavedListScrolls();
    runWithViewTransition(() => {
      navigate(route, { state: { resetScroll: true } });
    });
  };

  const isDashboard = path === '/dashboard' || path === '/';
  const isProperties = path === '/properties';
  const isApplicants = path === '/applicants';
  const isCollaborators = path === '/collaborators';

  return (
    <>
      {/* Quick Action Menu Overlay Modal (State 2: Menu from Stitch Image 8.html) */}
      {isQuickCreateOpen && !isViewer && (
        <div
          id="quick-menu-backdrop"
          onClick={() => setQuickCreateOpen(false)}
          className="fixed inset-0 z-45 bg-[#050a16]/75 backdrop-blur-xl transition-all duration-300 flex flex-col justify-end pb-24 px-4"
        >
          <div
            id="quick-menu-panel"
            onClick={(e) => e.stopPropagation()}
            className="sheet-enter-up w-full max-w-sm mx-auto rounded-2xl p-4 flex flex-col gap-4 relative overflow-hidden border border-[#f1cb83]/30 bg-[#0c111c]/90 shadow-[0_24px_64px_rgba(0,0,0,0.88),0_0_35px_rgba(241,203,131,0.12)]"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#f1cb83]/20 pb-3 relative z-20">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 live-dot-pulse" />
                <span className="text-[16px] font-bold text-white tracking-wide">
                  دسترسی سریع و ثبت اطلاعات
                </span>
              </div>
              <button
                type="button"
                aria-label="بستن منو"
                onClick={() => setQuickCreateOpen(false)}
                className="w-10 h-10 min-w-[44px] min-h-[44px] rounded-full bg-[#2c344b]/80 hover:bg-[#30394f] border border-white/20 flex items-center justify-center text-[#d1c5b4] hover:text-white active:scale-90 transition-all cursor-pointer shadow-md"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* 4 Cards Grid (2x2 Layout from Stitch) */}
            <div className="grid grid-cols-2 gap-3 relative z-10">
              {/* Card 1: ثبت ملک */}
              <button
                type="button"
                onClick={() => selectQuickAction('/properties/new')}
                className="stagger-item-0 p-3.5 rounded-2xl border border-[#f1cb83]/40 bg-gradient-to-br from-[#f1cb83]/15 to-[#0e121e]/95 hover:border-[#f1cb83] cursor-pointer flex flex-col items-center text-center group shadow-lg transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-[#f1cb83]/25 to-[#f1cb83]/10 border border-[#f1cb83]/50 flex items-center justify-center text-[#f1cb83] mb-2.5 group-hover:scale-105 transition-transform">
                  <span className="material-symbols-outlined text-[30px] drop-shadow-[0_0_10px_rgba(241,203,131,0.9)]">
                    real_estate_agent
                  </span>
                </div>
                <span className="text-[16px] font-bold text-white group-hover:text-[#f1cb83] transition-colors">
                  ثبت ملک
                </span>
                <span className="text-[11px] text-slate-300 mt-1 font-medium">
                  فروش، رهن و اجاره
                </span>
              </button>

              {/* Card 2: ثبت متقاضی جدید */}
              <button
                type="button"
                onClick={() => selectQuickAction('/applicants/new')}
                className="stagger-item-1 p-3.5 rounded-2xl border border-sky-400/40 bg-gradient-to-br from-sky-400/15 to-[#0e121e]/95 hover:border-sky-400 cursor-pointer flex flex-col items-center text-center group shadow-lg transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-sky-400/25 to-sky-500/10 border border-sky-400/50 flex items-center justify-center text-sky-400 mb-2.5 group-hover:scale-105 transition-transform">
                  <span className="material-symbols-outlined text-[30px] drop-shadow-[0_0_10px_rgba(56,189,248,0.9)]">
                    person_add
                  </span>
                </div>
                <span className="text-[16px] font-bold text-white group-hover:text-sky-300 transition-colors">
                  ثبت متقاضی جدید
                </span>
                <span className="text-[11px] text-slate-300 mt-1 font-medium">
                  خریدار یا مستاجر
                </span>
              </button>

              {/* Card 3: ثبت همکار جدید */}
              <button
                type="button"
                onClick={() => selectQuickAction('/collaborators/new')}
                className="stagger-item-2 p-3.5 rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-emerald-400/15 to-[#0e121e]/95 hover:border-emerald-400 cursor-pointer flex flex-col items-center text-center group shadow-lg transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-emerald-400/25 to-emerald-500/10 border border-emerald-400/50 flex items-center justify-center text-emerald-400 mb-2.5 group-hover:scale-105 transition-transform">
                  <span className="material-symbols-outlined text-[30px] drop-shadow-[0_0_10px_rgba(52,211,153,0.9)]">
                    handshake
                  </span>
                </div>
                <span className="text-[16px] font-bold text-white group-hover:text-emerald-300 transition-colors">
                  ثبت همکار جدید
                </span>
                <span className="text-[11px] text-slate-300 mt-1 font-medium">
                  مشاور و آژانس همکار
                </span>
              </button>

              {/* Card 4: یادآوری صوتی */}
              <button
                type="button"
                onClick={() => selectQuickAction('/reminders/new')}
                className="stagger-item-3 p-3.5 rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-400/15 to-[#0e121e]/95 hover:border-amber-400 cursor-pointer flex flex-col items-center text-center group shadow-lg transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-amber-400/25 to-amber-500/10 border border-amber-400/50 flex items-center justify-center text-amber-400 mb-2.5 group-hover:scale-105 transition-transform">
                  <span className="material-symbols-outlined text-[30px] drop-shadow-[0_0_10px_rgba(245,158,11,0.9)]">
                    mic
                  </span>
                </div>
                <span className="text-[16px] font-bold text-white group-hover:text-amber-300 transition-colors">
                  یادآوری صوتی
                </span>
                <div className="flex items-center gap-1.5 mt-1.5 h-4">
                  <span className="w-1 h-2.5 rounded-full bg-amber-300 animate-pulse" />
                  <span className="w-1 h-4 rounded-full bg-amber-300 animate-pulse" />
                  <span className="w-1 h-3 rounded-full bg-amber-300 animate-pulse" />
                  <span className="w-1 h-4 rounded-full bg-amber-300 animate-pulse" />
                  <span className="w-1 h-2 rounded-full bg-amber-300 animate-pulse" />
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fixed Bottom Navigation Bar (Stitch Design) */}
      <nav className="fixed bottom-0 inset-x-0 z-50 pb-safe bg-[#080d1a]/88 backdrop-blur-xl border-t border-[#f1cb83]/20 shadow-[0_-8px_32px_rgba(0,0,0,0.65)]">
        <div className="h-20 px-4 flex items-center justify-between relative max-w-lg mx-auto">
          {/* Tab 1: داشبورد */}
          <button
            type="button"
            onClick={() => goTab('/dashboard')}
            className={`nav-tab flex-1 flex flex-col items-center justify-center gap-1 h-full min-w-[44px] transition-all cursor-pointer ${
              isDashboard
                ? 'text-[#f1cb83] scale-105 font-bold drop-shadow-[0_0_8px_rgba(241,203,131,0.5)]'
                : 'text-[#d1c5b4] hover:text-[#f1cb83]'
            }`}
          >
            <span
              className="material-symbols-outlined text-[24px]"
              style={isDashboard ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              dashboard
            </span>
            <span className="text-[11px]">داشبورد</span>
          </button>

          {/* Tab 2: ملک‌ها */}
          <button
            type="button"
            onClick={() => goTab('/properties')}
            className={`nav-tab flex-1 flex flex-col items-center justify-center gap-1 h-full min-w-[44px] transition-all cursor-pointer ${
              isProperties
                ? 'text-[#f1cb83] scale-105 font-bold drop-shadow-[0_0_8px_rgba(241,203,131,0.5)]'
                : 'text-[#d1c5b4] hover:text-[#f1cb83]'
            }`}
          >
            <span
              className="material-symbols-outlined text-[24px]"
              style={isProperties ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              real_estate_agent
            </span>
            <span className="text-[11px]">ملک‌ها</span>
          </button>

          {/* Center Dynamic Action Button (+ to X) — Hidden for بیننده per spec */}
          {!isViewer ? (
            <div className="flex-1 flex items-center justify-center relative">
              <div className="-top-8 absolute w-16 h-16 pointer-events-none flex items-center justify-center">
                <div className="absolute w-16 h-16 rounded-full border border-[#f1cb83]/45 bg-[#f1cb83]/15 shadow-[0_0_24px_rgba(241,203,131,0.5)]" />
              </div>
              <button
                type="button"
                aria-label="دسترسی سریع"
                onClick={() => setQuickCreateOpen(!isQuickCreateOpen)}
                className="-top-8 absolute w-16 h-16 rounded-full border border-[#f1cb83]/50 backdrop-blur-xl bg-gradient-to-b from-white/25 via-[#f1cb83]/10 to-[#070d1a] hover:scale-105 active:scale-95 text-[#f1cb83] flex items-center justify-center transition-all shadow-[0_8px_32px_rgba(0,0,0,0.6),inset_0_1px_2px_rgba(255,255,255,0.6)] z-10 cursor-pointer"
              >
                <span
                  className={`material-symbols-outlined text-[30px] font-bold select-none text-[#f1cb83] drop-shadow-[0_0_10px_rgba(241,203,131,0.85)] transition-transform duration-300 ${
                    isQuickCreateOpen ? 'rotate-135 scale-105' : ''
                  }`}
                >
                  add
                </span>
              </button>
            </div>
          ) : (
            <div className="w-4" />
          )}

          {/* Tab 3: متقاضیان */}
          <button
            type="button"
            onClick={() => goTab('/applicants')}
            className={`nav-tab flex-1 flex flex-col items-center justify-center gap-1 h-full min-w-[44px] transition-all cursor-pointer ${
              isApplicants
                ? 'text-[#f1cb83] scale-105 font-bold drop-shadow-[0_0_8px_rgba(241,203,131,0.5)]'
                : 'text-[#d1c5b4] hover:text-[#f1cb83]'
            }`}
          >
            <span
              className="material-symbols-outlined text-[24px]"
              style={isApplicants ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              group
            </span>
            <span className="text-[11px]">متقاضیان</span>
          </button>

          {/* Tab 4: همکاران */}
          <button
            type="button"
            onClick={() => goTab('/collaborators')}
            className={`nav-tab flex-1 flex flex-col items-center justify-center gap-1 h-full min-w-[44px] transition-all cursor-pointer ${
              isCollaborators
                ? 'text-[#f1cb83] scale-105 font-bold drop-shadow-[0_0_8px_rgba(241,203,131,0.5)]'
                : 'text-[#d1c5b4] hover:text-[#f1cb83]'
            }`}
          >
            <span
              className="material-symbols-outlined text-[24px]"
              style={isCollaborators ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              handshake
            </span>
            <span className="text-[11px]">همکاران</span>
          </button>
        </div>
      </nav>
    </>
  );
};
