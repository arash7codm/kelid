import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import logoPng1x from '../assets/kelid-logo-1x.png';
import logoWebp1x from '../assets/kelid-logo-1x.webp';
import logoPng2x from '../assets/kelid-logo-2x.png';
import logoWebp2x from '../assets/kelid-logo-2x.webp';
import { useApp } from '../hooks/useAppContext';
import { clearSavedListScrolls, runWithViewTransition } from '../motion';

/**
 * کانتینر سراسری پس‌زمینه نورانی و متحرک (۱۰ ثانیه حلقه پیوسته از داشبورد.html)
 * فقط یک‌بار در ریشه‌ی برنامه (App.tsx) رندر می‌شود و هنگام جابه‌جایی صفحات ریست نمی‌شود.
 */
export const AmbientBackground: React.FC = () => {
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        document.documentElement.classList.add('tab-hidden');
      } else {
        document.documentElement.classList.remove('tab-hidden');
      }
    };

    let rafId = 0;
    const handleResize = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        setIsMobileViewport(window.innerWidth < 640);
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleResize);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      id="kelid-global-ambient-bg"
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none"
    >
      {/* لایه ۱: بستر گرادیان سرمه‌ای عمیق (Obsidian deep background base) */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#060a16] via-[#091124] to-[#040813]" />

      {/* لایه ۲: شبکه برداری خطوط معماری طلایی و حلقه‌های متحدالمرکز (Luxury Architectural Sketch SVG) */}
      <svg className="absolute inset-0 w-full h-full opacity-25" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="goldSketchGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f1cb83" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#d4b06a" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#f1cb83" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        <path
          className="anim-sketch"
          d="M -50,180 L 450,260 M 380,80 L 100,520 M -30,420 L 480,360 M 40,700 L 420,620 M 200,50 L 320,850"
          fill="none"
          stroke="url(#goldSketchGrad)"
          strokeDasharray="12 8"
          strokeWidth="0.85"
        />
        <circle
          cx="280"
          cy="340"
          r="160"
          fill="none"
          stroke="#f1cb83"
          strokeOpacity="0.06"
          strokeWidth="1"
        />
        <circle
          cx="280"
          cy="340"
          r="230"
          fill="none"
          stroke="#f1cb83"
          strokeDasharray="8 6"
          strokeOpacity="0.04"
          strokeWidth="0.7"
        />
      </svg>

      {/* لایه ۳: واترمارک بزرگ و شناور کلید در مرکز-راست (Giant Animated Key Watermark Loop) */}
      <div className="absolute top-1/4 -right-16 w-80 h-80 anim-watermark flex items-center justify-center opacity-10">
        <span
          className="material-symbols-outlined text-[320px] text-[#f1cb83] select-none pointer-events-none"
          style={{ fontVariationSettings: "'wght' 200, 'FILL' 0" }}
        >
          key
        </span>
      </div>

      {/* لایه ۴: هاله‌های نورانی بزرگ بوکه طلایی و آبی (Pulsing Luxury Bokeh & Gold Light Caustics) */}
      <div
        className={`absolute -top-36 right-[-10%] w-[420px] h-[420px] bg-gradient-to-br from-[#f1cb83]/30 via-[#d4b06a]/15 to-transparent rounded-full ${
          isMobileViewport ? 'blur-[70px]' : 'blur-[90px]'
        } anim-glow-1`}
      />
      <div
        className={`absolute top-1/3 -left-32 w-[380px] h-[380px] bg-gradient-to-tr from-[#b8c5f5]/20 via-[#f1cb83]/10 to-transparent rounded-full ${
          isMobileViewport ? 'blur-[65px]' : 'blur-[85px]'
        } anim-glow-2`}
      />
      <div
        className={`absolute -bottom-28 inset-x-0 mx-auto w-[460px] h-[400px] bg-gradient-to-t from-[#f1cb83]/20 via-[#d4b06a]/10 to-transparent rounded-full ${
          isMobileViewport ? 'blur-[75px]' : 'blur-[95px]'
        } anim-glow-1`}
      />

      {/* لایه ۵: ذرات بوکه طلایی شناور - فاز اول (Floating Golden Bokeh Particles Layer 1) */}
      <div className="absolute inset-0 anim-particles-1">
        <div className="absolute top-[18%] left-[15%] w-3 h-3 rounded-full bg-[#f1cb83]/70 blur-[1px] shadow-[0_0_12px_#f1cb83]" />
        <div className="absolute top-[32%] right-[22%] w-2 h-2 rounded-full bg-[#ffdea3]/80 blur-[0.5px] shadow-[0_0_8px_#ffdea3]" />
        <div className="absolute top-[48%] left-[30%] w-4 h-4 rounded-full bg-[#f1cb83]/40 blur-[2px] shadow-[0_0_16px_#f1cb83]" />
        <div className="absolute top-[65%] right-[14%] w-2.5 h-2.5 rounded-full bg-[#f1cb83]/60 blur-[1px] shadow-[0_0_10px_#f1cb83]" />
        {!isMobileViewport && (
          <div className="absolute top-[78%] left-[18%] w-3.5 h-3.5 rounded-full bg-[#f1cb83]/50 blur-[1.5px] shadow-[0_0_14px_#f1cb83]" />
        )}
        <div className="absolute top-[90%] right-[35%] w-2 h-2 rounded-full bg-[#f1cb83]/70 blur-[0.8px] shadow-[0_0_9px_#f1cb83]" />
      </div>

      {/* لایه ۶: ذرات بوکه طلایی و سفید شناور - فاز معکوس (Floating Golden Bokeh Particles Layer 2) */}
      <div className="absolute inset-0 anim-particles-2">
        <div className="absolute top-[25%] right-[32%] w-1.5 h-1.5 rounded-full bg-white/70 blur-[0.5px] shadow-[0_0_6px_#fff]" />
        <div className="absolute top-[40%] left-[10%] w-3 h-3 rounded-full bg-[#f1cb83]/60 blur-[1px] shadow-[0_0_12px_#f1cb83]" />
        <div className="absolute top-[58%] right-[8%] w-2 h-2 rounded-full bg-[#ffdea3]/80 blur-[0.8px] shadow-[0_0_10px_#f1cb83]" />
        <div className="absolute top-[72%] left-[42%] w-2.5 h-2.5 rounded-full bg-[#f1cb83]/50 blur-[1px] shadow-[0_0_10px_#f1cb83]" />
        {!isMobileViewport && (
          <div className="absolute top-[85%] left-[8%] w-1.5 h-1.5 rounded-full bg-white/60 blur-[0.5px]" />
        )}
      </div>

      {/* لایه ۷: شبکه نقطه‌ای ظریف میکرو (Subtle Obsidian Scanline/Micro-grid sheen) */}
      <div className="absolute inset-0 bg-[radial-gradient(#f1cb83_0.5px,transparent_0.5px)] [background-size:24px_24px] opacity-[0.04]" />
    </div>
  );
};

export const KelidLogoIcon: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => (
  <picture className="inline-flex items-center justify-center shrink-0 select-none">
    <source type="image/webp" srcSet={`${logoWebp1x} 1x, ${logoWebp2x} 2x`} />
    <img
      src={logoPng1x}
      srcSet={`${logoPng1x} 1x, ${logoPng2x} 2x`}
      alt="کلید لوکس"
      decoding="async"
      className={`${className} object-contain select-none drop-shadow-[0_0_10px_rgba(241,203,131,0.85)] transition-transform duration-300 hover:scale-105`}
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

  const menuOpen = isQuickCreateOpen && !isViewer;

  return (
    <>
      {/* ========================================================= */}
      {/* QUICK ACTION MENU OVERLAY MODAL (از داشبورد.html)          */}
      {/* ========================================================= */}
      <div
        id="quick-menu-backdrop"
        onClick={() => setQuickCreateOpen(false)}
        className={`fixed inset-0 z-40 bg-[#050a16]/75 backdrop-blur-xl transition-all duration-400 flex flex-col justify-end pb-24 px-4 ${
          menuOpen ? 'open' : ''
        }`}
      >
        <div
          id="quick-menu-panel"
          onClick={(e) => e.stopPropagation()}
          style={{
            perspective: '1000px',
            background: 'rgba(12, 17, 28, 0.85)',
          }}
          className={`w-full max-w-sm mx-auto frosted-menu-panel rounded-2xl p-4 flex flex-col gap-4 relative overflow-hidden ${
            menuOpen ? 'open' : ''
          }`}
        >
          {/* هدر مودال دسترسی سریع */}
          <div className="flex items-center justify-between border-b border-[#f1cb83]/20 pb-3 relative z-20">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 live-dot-pulse" />
              <span className="text-[17px] font-bold text-white tracking-wide drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                دسترسی سریع و ثبت اطلاعات
              </span>
            </div>
            <button
              type="button"
              aria-label="بستن منو"
              onClick={(e) => {
                e.stopPropagation();
                setQuickCreateOpen(false);
              }}
              className="w-10 h-10 min-w-[44px] min-h-[44px] rounded-full bg-[#2c344b]/80 hover:bg-[#30394f] border border-white/20 flex items-center justify-center text-[#d1c5b4] hover:text-white active:scale-90 transition-all duration-200 cursor-pointer shadow-md relative z-50"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* شبکه ۴ کارت سه‌بعدی با موج شناور، مه‌ی نورانی و درخشش نوبتی */}
          <div className="grid grid-cols-2 gap-3 relative z-10" style={{ perspective: '1000px' }}>
            {/* کارت ۱: ثبت ملک */}
            <button
              type="button"
              onClick={() => selectQuickAction('/properties/new')}
              style={{
                background: 'linear-gradient(145deg, rgba(241, 203, 131, 0.12), rgba(14, 18, 30, 0.97))',
                border: '1px solid rgba(241, 203, 131, 0.38)',
                transform: 'rotateY(-2.5deg) rotateX(2deg)',
              }}
              className="menu-card-item wave-float-1 raised-3d-card p-3.5 glow-anim-gold cursor-pointer flex flex-col items-center text-center group"
            >
              <div className="card-mist-layer card-mist-layer-1" />
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-[#f1cb83]/25 to-[#f1cb83]/10 border border-[#f1cb83]/50 flex items-center justify-center text-[#f1cb83] mb-2.5 icon-convex-bubble group-hover:scale-110 group-hover:rotate-3">
                <span className="material-symbols-outlined text-[30px] drop-shadow-[0_0_10px_rgba(241,203,131,0.9)]">
                  real_estate_agent
                </span>
              </div>
              <span className="text-[17px] font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] group-hover:text-[#f1cb83] transition-colors">
                ثبت ملک
              </span>
              <span className="text-[12px] text-slate-200 mt-1 font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
                فروش، رهن و اجاره
              </span>
            </button>

            {/* کارت ۲: ثبت متقاضی جدید */}
            <button
              type="button"
              onClick={() => selectQuickAction('/applicants/new')}
              style={{
                background: 'linear-gradient(145deg, rgba(56, 189, 248, 0.12), rgba(14, 18, 30, 0.97))',
                border: '1px solid rgba(56, 189, 248, 0.38)',
                transform: 'rotateY(2.5deg) rotateX(2deg)',
              }}
              className="menu-card-item wave-float-2 raised-3d-card p-3.5 glow-anim-blue cursor-pointer flex flex-col items-center text-center group"
            >
              <div className="card-mist-layer card-mist-layer-2" />
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-sky-400/25 to-sky-500/10 border border-sky-400/50 flex items-center justify-center text-sky-400 mb-2.5 icon-convex-bubble group-hover:scale-110 group-hover:-rotate-3">
                <span className="material-symbols-outlined text-[30px] drop-shadow-[0_0_10px_rgba(56,189,248,0.9)]">
                  person_add
                </span>
              </div>
              <span className="text-[17px] font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] group-hover:text-sky-300 transition-colors">
                ثبت متقاضی جدید
              </span>
              <span className="text-[12px] text-slate-200 mt-1 font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
                خریدار یا مستاجر
              </span>
            </button>

            {/* کارت ۳: ثبت همکار جدید */}
            <button
              type="button"
              onClick={() => selectQuickAction('/collaborators/new')}
              style={{
                background: 'linear-gradient(145deg, rgba(52, 211, 153, 0.12), rgba(14, 18, 30, 0.97))',
                border: '1px solid rgba(52, 211, 153, 0.38)',
                transform: 'rotateY(-2.5deg) rotateX(-2deg)',
              }}
              className="menu-card-item wave-float-3 raised-3d-card p-3.5 glow-anim-emerald cursor-pointer flex flex-col items-center text-center group"
            >
              <div className="card-mist-layer card-mist-layer-3" />
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-emerald-400/25 to-emerald-500/10 border border-emerald-400/50 flex items-center justify-center text-emerald-400 mb-2.5 icon-convex-bubble group-hover:scale-110 group-hover:rotate-3">
                <span className="material-symbols-outlined text-[30px] drop-shadow-[0_0_10px_rgba(52,211,153,0.9)]">
                  handshake
                </span>
              </div>
              <span className="text-[17px] font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] group-hover:text-emerald-300 transition-colors">
                ثبت همکار جدید
              </span>
              <span className="text-[12px] text-slate-200 mt-1 font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
                مشاور و آژانس همکار
              </span>
            </button>

            {/* کارت ۴: یادآوری صوتی */}
            <button
              type="button"
              onClick={() => selectQuickAction('/reminders/new')}
              style={{
                background: 'linear-gradient(145deg, rgba(245, 158, 11, 0.12), rgba(14, 18, 30, 0.97))',
                border: '1px solid rgba(245, 158, 11, 0.38)',
                transform: 'rotateY(2.5deg) rotateX(-2deg)',
              }}
              className="menu-card-item wave-float-4 raised-3d-card p-3.5 glow-anim-amber cursor-pointer flex flex-col items-center text-center group"
            >
              <div className="card-mist-layer card-mist-layer-4" />
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-amber-400/25 to-amber-500/10 border border-amber-400/50 flex items-center justify-center text-amber-400 mb-2.5 icon-convex-bubble group-hover:scale-110 group-hover:-rotate-3">
                <span className="material-symbols-outlined text-[30px] drop-shadow-[0_0_10px_rgba(245,158,11,0.9)]">
                  mic
                </span>
              </div>
              <span className="text-[17px] font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] group-hover:text-amber-300 transition-colors">
                یادآوری صوتی
              </span>
              <div className="flex items-center gap-1.5 mt-1.5 h-4">
                <span className="w-1 rounded-full bg-amber-300 sound-bar-1 shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                <span className="w-1 rounded-full bg-amber-300 sound-bar-2 shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                <span className="w-1 rounded-full bg-amber-300 sound-bar-3 shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                <span className="w-1 rounded-full bg-amber-300 sound-bar-4 shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                <span className="w-1 rounded-full bg-amber-300 sound-bar-5 shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* FIXED BOTTOM NAVIGATION BAR (از داشبورد.html)             */}
      {/* ========================================================= */}
      <nav
        aria-label="ناوبری اصلی"
        className="fixed bottom-0 inset-x-0 z-50 pb-safe bg-[#080d1a]/85 backdrop-blur-2xl border-t border-[#f1cb83]/15 shadow-[0_-8px_32px_rgba(0,0,0,0.6)]"
      >
        <div className="h-20 px-4 flex items-center justify-between relative max-w-lg mx-auto">
          {/* تب ۱: داشبورد */}
          <button
            type="button"
            aria-current={isDashboard ? 'page' : undefined}
            onClick={() => goTab('/dashboard')}
            className={`nav-tab flex-1 flex flex-col items-center justify-center gap-1 h-full min-w-[44px] transition-all duration-300 active:scale-90 cursor-pointer ${
              isDashboard
                ? 'text-[#f1cb83] scale-105 font-semibold drop-shadow-[0_0_8px_rgba(241,203,131,0.5)]'
                : 'text-[#d1c5b4] hover:text-[#f1cb83] hover:scale-105'
            }`}
          >
            <span
              className="material-symbols-outlined text-[24px] nav-icon transition-transform duration-300"
              style={isDashboard ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              dashboard
            </span>
            <span className="text-[11px] font-medium">داشبورد</span>
          </button>

          {/* تب ۲: ملک‌ها */}
          <button
            type="button"
            aria-current={isProperties ? 'page' : undefined}
            onClick={() => goTab('/properties')}
            className={`nav-tab flex-1 flex flex-col items-center justify-center gap-1 h-full min-w-[44px] transition-all duration-300 active:scale-90 cursor-pointer ${
              isProperties
                ? 'text-[#f1cb83] scale-105 font-semibold drop-shadow-[0_0_8px_rgba(241,203,131,0.5)]'
                : 'text-[#d1c5b4] hover:text-[#f1cb83] hover:scale-105'
            }`}
          >
            <span
              className="material-symbols-outlined text-[24px] nav-icon transition-transform duration-300"
              style={isProperties ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              real_estate_agent
            </span>
            <span className="text-[11px] font-medium">ملک‌ها</span>
          </button>

          {/* دکمه مرکزی + با هاله نورانی تپنده و چرخش به X */}
          <div className="flex-1 flex items-center justify-center relative">
            {!isViewer ? (
              <>
                <div className="-top-8 absolute w-16 h-16 pointer-events-none flex items-center justify-center">
                  <div className="absolute w-16 h-16 rounded-full border border-[#f1cb83]/40 bg-[#f1cb83]/10 shadow-[0_0_24px_rgba(241,203,131,0.5)] golden-action-pulse" />
                  <div className="absolute -inset-1 rounded-full bg-[#f1cb83]/25 blur-xl pointer-events-none golden-action-pulse" />
                </div>
                <button
                  id="center-action-btn"
                  type="button"
                  aria-label="دسترسی سریع"
                  onClick={() => setQuickCreateOpen(!isQuickCreateOpen)}
                  className="-top-8 absolute w-16 h-16 rounded-full border border-[#f1cb83]/40 backdrop-blur-2xl bg-gradient-to-b from-white/25 via-transparent to-[#f1cb83]/10 hover:scale-110 active:scale-90 text-[#f1cb83] flex items-center justify-center transition-all duration-300 overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_2px_rgba(255,255,255,0.6),inset_0_-2px_4px_rgba(0,0,0,0.3)] hover:shadow-[0_0_30px_rgba(241,203,131,0.7)] z-10 cursor-pointer group"
                >
                  <div className="absolute inset-0 rounded-full pointer-events-none bg-gradient-to-b from-white/25 via-transparent to-[#f1cb83]/10 opacity-80 group-hover:opacity-100 transition-opacity" />
                  <div className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden rounded-full z-10">
                    <div className="absolute top-[-20%] -left-full w-full h-[140%] bg-gradient-to-r from-transparent via-white/40 to-transparent blur-[1px] group-hover:left-full transition-all duration-700 ease-in-out" />
                  </div>
                  <span
                    id="center-plus-icon"
                    className={`material-symbols-outlined text-[30px] font-bold relative z-20 select-none text-[#f1cb83] drop-shadow-[0_0_10px_rgba(241,203,131,0.85)] ${
                      menuOpen ? 'rotate-x' : ''
                    }`}
                  >
                    add
                  </span>
                </button>
              </>
            ) : (
              <div className="-top-8 absolute w-16 h-16 rounded-full border border-white/10 bg-[#0d1527]/80 flex items-center justify-center text-white/30">
                <span className="material-symbols-outlined text-[24px]">lock</span>
              </div>
            )}
          </div>

          {/* تب ۳: متقاضی */}
          <button
            type="button"
            aria-current={isApplicants ? 'page' : undefined}
            onClick={() => goTab('/applicants')}
            className={`nav-tab flex-1 flex flex-col items-center justify-center gap-1 h-full min-w-[44px] transition-all duration-300 active:scale-90 cursor-pointer ${
              isApplicants
                ? 'text-[#f1cb83] scale-105 font-semibold drop-shadow-[0_0_8px_rgba(241,203,131,0.5)]'
                : 'text-[#d1c5b4] hover:text-[#f1cb83] hover:scale-105'
            }`}
          >
            <span
              className="material-symbols-outlined text-[24px] nav-icon transition-transform duration-300"
              style={isApplicants ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              group
            </span>
            <span className="text-[11px] font-medium">متقاضی</span>
          </button>

          {/* تب ۴: همکاران */}
          <button
            type="button"
            aria-current={isCollaborators ? 'page' : undefined}
            onClick={() => goTab('/collaborators')}
            className={`nav-tab flex-1 flex flex-col items-center justify-center gap-1 h-full min-w-[44px] transition-all duration-300 active:scale-90 cursor-pointer ${
              isCollaborators
                ? 'text-[#f1cb83] scale-105 font-semibold drop-shadow-[0_0_8px_rgba(241,203,131,0.5)]'
                : 'text-[#d1c5b4] hover:text-[#f1cb83] hover:scale-105'
            }`}
          >
            <span
              className="material-symbols-outlined text-[24px] nav-icon transition-transform duration-300"
              style={isCollaborators ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              handshake
            </span>
            <span className="text-[11px] font-medium">همکاران</span>
          </button>
        </div>
      </nav>
    </>
  );
};
