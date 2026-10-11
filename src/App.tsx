import React, { useEffect, useLayoutEffect, useRef } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import { AmbientBackground, BottomNavAndQuickMenu, KelidLogoIcon } from './components/Layout';
import { AppProvider, useApp } from './hooks/useAppContext';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  consumeReturningToList,
  getSavedListScrollPosition,
  resetAllScrollTargets,
  saveListScrollPosition,
} from './motion';
import { ApplicantFormScreen } from './screens/ApplicantFormScreen';
import { ApplicantsListScreen } from './screens/ApplicantsListScreen';
import { CollaboratorFormScreen } from './screens/CollaboratorFormScreen';
import { CollaboratorsListScreen } from './screens/CollaboratorsListScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { PropertiesListScreen } from './screens/PropertiesListScreen';
import { PropertyDetailScreen } from './screens/PropertyDetailScreen';
import { PropertyFormScreen } from './screens/PropertyFormScreen';
import { RemindersScreen } from './screens/RemindersScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { DeviceHealthScreen } from './screens/DeviceHealthScreen';
import { VoiceAssistantScreen } from './screens/VoiceAssistantScreen';

const LIST_PATHS = new Set(['/properties', '/applicants', '/collaborators', '/search']);

function getRouterBasename(): string {
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname;
  // Support hosting from a GitHub Pages sub-path (e.g. /repo-name/...) and root domain
  const knownRoutes = [
    '/dashboard',
    '/properties',
    '/applicants',
    '/collaborators',
    '/reminders',
    '/inbox',
    '/settings',
    '/voice-assistant',
    '/search',
    '/login',
  ];
  for (const r of knownRoutes) {
    const idx = path.indexOf(r);
    if (idx > 0) {
      return path.slice(0, idx);
    }
  }
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 1 && !knownRoutes.includes(`/${segs[0]}`) && !segs[0].includes('.')) {
    return `/${segs[0]}`;
  }
  return '';
}

function isDetailOrEditPath(path: string): boolean {
  if (path === '/properties/new' || path === '/applicants/new' || path === '/collaborators/new') {
    return false;
  }
  return (
    /^\/properties\/[^/]+(\/edit)?$/.test(path) ||
    /^\/applicants\/[^/]+\/edit$/.test(path) ||
    /^\/collaborators\/[^/]+\/edit$/.test(path)
  );
}

const ScrollController: React.FC = () => {
  const location = useLocation();
  const navType = useNavigationType();
  const prevPathRef = useRef<string>(location.pathname);

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    const currentPath = location.pathname;
    if (!LIST_PATHS.has(currentPath)) return;

    const onScroll = () => {
      saveListScrollPosition(currentPath);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname]);

  useLayoutEffect(() => {
    const prevPath = prevPathRef.current;
    const nextPath = location.pathname;
    prevPathRef.current = nextPath;

    const navState = (location.state as { restoreScroll?: boolean; resetScroll?: boolean } | null) || null;
    const explicitReturning = consumeReturningToList() || Boolean(navState?.restoreScroll);
    const shouldRestoreList =
      !navState?.resetScroll &&
      LIST_PATHS.has(nextPath) &&
      isDetailOrEditPath(prevPath) &&
      (navType === 'POP' || explicitReturning);

    if (shouldRestoreList) {
      const targetY = getSavedListScrollPosition(nextPath);
      resetAllScrollTargets(targetY);
      const raf = window.requestAnimationFrame(() => {
        resetAllScrollTargets(targetY);
      });
      return () => window.cancelAnimationFrame(raf);
    }

    if (LIST_PATHS.has(nextPath)) {
      saveListScrollPosition(nextPath, 0);
    }
    resetAllScrollTargets(0);
  }, [location.pathname, location.key, location.state, navType]);

  return null;
};

const AppShell: React.FC = () => {
  const location = useLocation();
  const { loading, isQuickCreateOpen, currentUser } = useApp();
  const { isInstallable, install } = usePWAInstall();

  const isPropertyDetailRoute =
    /^\/properties\/[^/]+$/.test(location.pathname) && location.pathname !== '/properties/new';

  const quickMenuBlurActive = isQuickCreateOpen && currentUser.role !== 'بیننده';

  return (
    <div className="min-h-screen relative bg-transparent text-[#dae2ff] select-none overflow-x-hidden">
      <ScrollController />
      {/* پس‌زمینه سراسری واحد — فقط یک‌بار در ریشه‌ی برنامه ساخته می‌شود و هرگز ریست نمی‌شود */}
      <AmbientBackground />

      {loading ? (
        <div className="min-h-screen relative z-10 bg-transparent flex flex-col items-center justify-center gap-3 select-none">
          <KelidLogoIcon className="w-16 h-16" />
          <span className="text-sm font-extrabold text-[#f1cb83] tracking-tight">کلید</span>
        </div>
      ) : (
        <>
          <div
            id="app-route-content"
            className="relative z-10 transition-all duration-500"
            style={{
              filter: quickMenuBlurActive ? 'blur(5px)' : 'none',
              opacity: quickMenuBlurActive ? 0.7 : 1,
            }}
          >
            {isInstallable && location.pathname === '/dashboard' && (
              <div className="relative z-40 max-w-lg mx-auto px-5 pt-2">
                <div className="crystal-glass rounded-xl p-2.5 border border-[#f1cb83]/45 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <KelidLogoIcon className="w-7 h-7" />
                    <span className="text-[11px] font-bold text-white">
                      نصب نسخه وب‌اپلیکیشن (PWA) کلید روی صفحه اصلی گوشی
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={install}
                    className="gold-pill-btn px-3 py-1 rounded-lg text-[11px] font-extrabold shrink-0 cursor-pointer"
                  >
                    نصب برنامه
                  </button>
                </div>
              </div>
            )}

            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardScreen />} />

              {/* Properties Routes */}
              <Route path="/properties" element={<PropertiesListScreen />} />
              <Route path="/properties/new" element={<PropertyFormScreen />} />
              <Route path="/properties/:id" element={<PropertyDetailScreen />} />
              <Route path="/properties/:id/edit" element={<PropertyFormScreen />} />

              {/* Applicants Routes */}
              <Route path="/applicants" element={<ApplicantsListScreen />} />
              <Route path="/applicants/new" element={<ApplicantFormScreen />} />
              <Route path="/applicants/:id/edit" element={<ApplicantFormScreen />} />

              {/* Collaborators Routes */}
              <Route path="/collaborators" element={<CollaboratorsListScreen />} />
              <Route path="/collaborators/new" element={<CollaboratorFormScreen />} />
              <Route path="/collaborators/:id/edit" element={<CollaboratorFormScreen />} />

              {/* Reminders & Smart Inbox Routes */}
              <Route path="/reminders" element={<RemindersScreen />} />
              <Route path="/reminders/new" element={<RemindersScreen />} />
              <Route path="/inbox" element={<RemindersScreen />} />

              {/* Settings & Device Health Routes */}
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/settings/health" element={<DeviceHealthScreen />} />

              {/* Voice Assistant & Global Smart Search Routes */}
              <Route path="/voice-assistant" element={<VoiceAssistantScreen />} />
              <Route path="/search" element={<SearchScreen />} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>

          {!isPropertyDetailRoute && <BottomNavAndQuickMenu />}
        </>
      )}
    </div>
  );
};

export default function App() {
  const basename = getRouterBasename();
  return (
    <BrowserRouter basename={basename}>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </BrowserRouter>
  );
}
