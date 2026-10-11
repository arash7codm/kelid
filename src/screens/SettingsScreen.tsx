import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AmbientBackground, BottomNavAndQuickMenu, KelidLogoIcon } from '../components/Layout';
import { APP_CONFIG, UserRole } from '../config';
import { useApp } from '../hooks/useAppContext';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { aiService, getStoredGeminiApiKey, setStoredGeminiApiKey } from '../services/ai';
import {
  getAccessToken,
  googleSignIn,
  logoutGoogle,
} from '../services/auth';
import {
  exportBackupPackage,
  getStorageQuotaEstimate,
  inviteWorkspaceMember,
  openGoogleDriveFolderPicker,
  runCloudBackupAndSync,
  runPullOnlyRefresh,
  shareBackupPackage,
} from '../services/sync';
import { getRelativeTimePersian, toPersianDigits } from '../utils/persian';

export const SettingsScreen: React.FC = () => {
  const navigate = useNavigate();
  const {
    snapshot,
    currentUser,
    setRole,
    refreshSnapshot,
    showToast,
  } = useApp();
  const { isInstallable, isInstalled, install } = usePWAInstall();

  const [nameInput, setNameInput] = useState(currentUser.name);
  const [geminiKey, setGeminiKey] = useState(getStoredGeminiApiKey());
  const [showKey, setShowKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('ویرایشگر');
  const [pickedFolder, setPickedFolder] = useState<{ id: string; name: string } | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [storageInfo, setStorageInfo] = useState({
    usageMB: 0,
    quotaMB: 0,
    percent: 0,
    nearFull: false,
  });

  useEffect(() => {
    setNameInput(currentUser.name);
  }, [currentUser.name]);

  useEffect(() => {
    getStorageQuotaEstimate().then(setStorageInfo);
  }, [snapshot]);

  const handleSaveGeminiKey = async () => {
    const clean = geminiKey.trim();
    setStoredGeminiApiKey(clean);
    if (!clean) {
      showToast('کلید هوش مصنوعی Gemini از حافظه گوشی پاک شد', 'info');
      return;
    }
    setTestingKey(true);
    try {
      const res = await aiService.testConnection();
      if (res.ok) {
        showToast(res.message, 'success');
      } else {
        showToast(res.message, 'error');
      }
    } finally {
      setTestingKey(false);
    }
  };

  const handleCloudSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await runCloudBackupAndSync();
      await refreshSnapshot();
      showToast(`پشتیبان‌گیری ابری انجام شد: ${res.message}`, 'success');
    } catch (e: any) {
      showToast(e?.message || 'خطا در پشتیبان‌گیری ابری', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePullRefresh = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await runPullOnlyRefresh();
      await refreshSnapshot();
      showToast(`به‌روزرسانی انجام شد: ${res.message}`, 'success');
    } catch (e: any) {
      showToast(e?.message || 'خطا در دریافت نسخه ابری', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleInviteMember = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      showToast('لطفاً ایمیل معتبر گوگل وارد کنید', 'error');
      return;
    }
    const { inviteLink } = await inviteWorkspaceMember(inviteEmail, inviteName, inviteRole);
    await refreshSnapshot();
    navigator.clipboard?.writeText(inviteLink).catch(() => {});
    setInviteEmail('');
    setInviteName('');
    showToast('عضو جدید ثبت شد و لینک دعوت در کلیپ‌بورد کپی گردید', 'success');
  };

  const statusDotClass =
    snapshot?.syncStatusColor === 'red'
      ? 'bg-red-500 shadow-[0_0_10px_#ef4444]'
      : snapshot?.syncStatusColor === 'yellow'
      ? 'bg-amber-400 shadow-[0_0_10px_#f59e0b]'
      : 'bg-emerald-400 shadow-[0_0_10px_#34d399]';

  return (
    <div className="min-h-screen bg-transparent text-[#dae2ff] relative overflow-x-hidden pb-32">
      <header className="fixed top-0 inset-x-0 z-40 pt-safe bg-[#080d1a]/60 backdrop-blur-2xl border-b border-[#f1cb83]/15">
        <div className="h-16 px-5 flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-10 h-10 rounded-xl crystal-glass-subtle flex items-center justify-center text-[#f1cb83] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
            <div>
              <h1 className="text-base font-extrabold text-[#dae2ff]">تنظیمات و حساب کاربری</h1>
              <p className="text-[10px] text-[#d1c5b4]">
                مدیریت کلید Gemini، فضای ابری گوگل و پشتیبان‌گیری
              </p>
            </div>
          </div>
          <KelidLogoIcon className="h-10 w-10" />
        </div>
      </header>

      <main className="page-enter-forward relative z-10 max-w-lg mx-auto pt-20 px-5 space-y-4 text-right">
        {/* 1. User Role & Profile */}
        <section className="rounded-2xl crystal-glass p-4 space-y-3 border border-[#f1cb83]/25">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">
                manage_accounts
              </span>
              <h2 className="text-sm font-bold text-[#dae2ff]">نقش و مشخصات مشاور</h2>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-[#f1cb83]/15 border border-[#f1cb83]/30 text-[#f1cb83] text-[11px] font-bold">
              {currentUser.role}
            </span>
          </div>

          <div>
            <label className="block text-[11px] text-[#d1c5b4] mb-1">نام نمایشی در سامانه</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="flex-1 h-10 px-3 rounded-xl bg-[#050b17] border border-[#f1cb83]/25 text-xs text-white"
              />
              <button
                type="button"
                onClick={async () => {
                  if (nameInput.trim()) {
                    localStorage.setItem('kelid_user_name', nameInput.trim());
                    window.dispatchEvent(new Event('kelid-role-changed'));
                    await refreshSnapshot();
                    showToast('نام کاربری ذخیره شد', 'success');
                  }
                }}
                className="h-10 px-3.5 rounded-xl bg-[#f1cb83] text-[#261900] text-xs font-bold cursor-pointer"
              >
                ذخیره
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-[#d1c5b4] mb-1.5">سطح دسترسی</label>
            <div className="grid grid-cols-3 gap-2">
              {(['مدیر', 'ویرایشگر', 'بیننده'] as UserRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRole(r);
                    showToast(`سطح دسترسی به «${r}» تغییر یافت`, 'info');
                  }}
                  className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    currentUser.role === r
                      ? 'bg-[#f1cb83]/20 border-[#f1cb83] text-[#f1cb83]'
                      : 'bg-white/5 border-white/10 text-[#d1c5b4]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 2. User's Own Gemini API Key Stored on Phone */}
        <section className="rounded-2xl crystal-glass p-4 space-y-3 border border-[#f1cb83]/25">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">
                auto_awesome
              </span>
              <h2 className="text-sm font-bold text-[#dae2ff]">کلید هوش مصنوعی Gemini (روی گوشی)</h2>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                geminiKey.trim()
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                  : 'bg-white/10 text-[#d1c5b4]'
              }`}
            >
              {geminiKey.trim() ? 'ثبت‌شده روی گوشی' : 'استفاده از موتور آفلاین'}
            </span>
          </div>

          <p className="text-[11px] text-[#d1c5b4] leading-relaxed">
            کلید شخصی Gemini شما صرفاً در حافظه مرورگر گوشی شما ذخیره می‌شود و مستقیماً از مرورگر برای رونویسی صوتی، OCR اسناد و استخراج هوشمند استفاده می‌گردد.
          </p>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                dir="ltr"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full h-10 pl-3 pr-9 rounded-xl bg-[#050b17] border border-[#f1cb83]/25 text-xs text-white text-left font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#d1c5b4] cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {showKey ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            <button
              type="button"
              disabled={testingKey}
              onClick={handleSaveGeminiKey}
              className="h-10 px-3.5 rounded-xl bg-gradient-to-r from-[#d4b06a] to-[#f1cb83] text-[#261900] text-xs font-extrabold shrink-0 cursor-pointer"
            >
              {testingKey ? 'بررسی...' : 'ذخیره و تست'}
            </button>
          </div>
        </section>

        {/* 3. Google Drive & Google Calendar Integration */}
        <section className="rounded-2xl crystal-glass p-4 space-y-3 border border-[#f1cb83]/25">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KelidLogoIcon className="w-7 h-7" />
              <h2 className="text-sm font-bold text-[#dae2ff]">
                ورود و اتصال Google Drive و Google Calendar
              </h2>
            </div>
            <span className={`w-2.5 h-2.5 rounded-full ${statusDotClass}`} />
          </div>

          <div className="p-3 rounded-xl bg-[#050b17]/80 border border-white/10 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#d1c5b4]">وضعیت آخرین پشتیبان‌گیری:</span>
              <span className="font-bold text-[#f1cb83]">
                {snapshot?.syncMeta.lastBackupAt
                  ? getRelativeTimePersian(snapshot.syncMeta.lastBackupAt)
                  : 'هنوز هیچ پشتیبان‌گیری انجام نشده است'}
              </span>
            </div>
            {snapshot?.syncMeta.lastBackupAt && storageInfo.usageMB > 0 && (
              <div className="flex items-center justify-between text-[11px] text-[#d1c5b4]">
                <span>حجم داده‌های ذخیره‌شده:</span>
                <span>{toPersianDigits(storageInfo.usageMB)} مگابایت</span>
              </div>
            )}
          </div>

          {Boolean(getAccessToken()) ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-xs">
                <span className="text-emerald-200 truncate">{currentUser.email || currentUser.name}</span>
                <button
                  type="button"
                  onClick={async () => {
                    await logoutGoogle();
                    await refreshSnapshot();
                    showToast('از حساب گوگل خارج شدید', 'info');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 text-[11px] font-bold cursor-pointer"
                >
                  خروج از حساب
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleCloudSync}
                  disabled={isSyncing}
                  className="py-2.5 rounded-xl bg-[#f1cb83] text-[#261900] text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">cloud_upload</span>
                  <span>پشتیبان‌گیری ابری</span>
                </button>
                <button
                  type="button"
                  onClick={handlePullRefresh}
                  disabled={isSyncing}
                  className="py-2.5 rounded-xl bg-white/10 border border-white/15 text-[#dae2ff] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">cloud_download</span>
                  <span>دریافت از Drive</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  openGoogleDriveFolderPicker(
                    (folder) => {
                      setPickedFolder(folder);
                      showToast(`پوشه اشتراکی «${folder.name}» انتخاب شد`, 'success');
                    },
                    (msg) => showToast(msg, 'error')
                  )
                }
                className="w-full py-2 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/35 text-[#f1cb83] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">folder_shared</span>
                <span>
                  {pickedFolder
                    ? `پوشه انتخاب‌شده: ${pickedFolder.name}`
                    : 'انتخاب پوشه اشتراکی در Google Drive'}
                </span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={async () => {
                try {
                  await googleSignIn();
                  await refreshSnapshot();
                  showToast('اتصال به Google Drive و Google Calendar برقرار شد', 'success');
                } catch (e: any) {
                  showToast(e?.message || 'خطا در ورود با حساب گوگل', 'error');
                }
              }}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#261900] text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">login</span>
              <span>ورود با حساب گوگل (فعال‌سازی Drive و Calendar)</span>
            </button>
          )}

          {/* Local Export & Share */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onClick={async () => {
                await exportBackupPackage(false);
                await refreshSnapshot();
                showToast('فایل JSON پشتیبان ذخیره شد', 'success');
              }}
              className="py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-[#f1cb83] cursor-pointer"
            >
              دانلود JSON
            </button>
            <button
              type="button"
              onClick={async () => {
                await exportBackupPackage(true);
                await refreshSnapshot();
                showToast('بسته کامل ZIP با تصاویر ذخیره شد', 'success');
              }}
              className="py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-[#dae2ff] cursor-pointer"
            >
              دانلود ZIP کامل
            </button>
            <button
              type="button"
              onClick={async () => {
                await shareBackupPackage({ mode: 'full' });
                await refreshSnapshot();
              }}
              className="py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-emerald-300 cursor-pointer"
            >
              اشتراک‌گذاری
            </button>
          </div>
        </section>

        {/* 4. Team Workspace Invite */}
        {currentUser.role === 'مدیر' && (
          <section className="rounded-2xl crystal-glass p-4 space-y-3 border border-[#f1cb83]/25">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">
                group_add
              </span>
              <h2 className="text-sm font-bold text-[#dae2ff]">دعوت همکار به فضای کاری</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="نام مشاور"
                className="h-9 px-3 rounded-xl bg-[#050b17] border border-[#f1cb83]/25 text-xs text-white"
              />
              <input
                type="email"
                dir="ltr"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="advisor@gmail.com"
                className="h-9 px-3 rounded-xl bg-[#050b17] border border-[#f1cb83]/25 text-xs text-white text-left"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="h-9 px-3 rounded-xl bg-[#050b17] border border-[#f1cb83]/25 text-xs text-white flex-1"
              >
                <option value="ویرایشگر">ویرایشگر</option>
                <option value="بیننده">بیننده</option>
                <option value="مدیر">مدیر</option>
              </select>
              <button
                type="button"
                onClick={handleInviteMember}
                className="h-9 px-4 rounded-xl bg-[#f1cb83] text-[#261900] text-xs font-bold cursor-pointer"
              >
                افزودن و کپی لینک
              </button>
            </div>
          </section>
        )}

        {/* 5. Device Health Check & PWA Install */}
        <section className="rounded-2xl crystal-glass p-4 space-y-3 border border-[#f1cb83]/25">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">
                health_and_safety
              </span>
              <h2 className="text-sm font-bold text-[#dae2ff]">تست سلامت دستگاه و نصب برنامه</h2>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-[10px] font-bold">
              {isInstalled ? 'نصب‌شده روی گوشی' : 'آماده بررسی'}
            </span>
          </div>

          <p className="text-[11px] text-[#d1c5b4] leading-relaxed">
            بررسی واقعی ۱۷ قابلیت کلیدی روی گوشی شامل میکروفون، دوربین، GPS، کلیپ‌بورد، حافظه آفلاین، Google Drive، تقویم و هوش مصنوعی Gemini.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => navigate('/settings/health')}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#261900] text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">fact_check</span>
              <span>تست سلامت دستگاه</span>
            </button>

            {isInstallable && !isInstalled && (
              <button
                type="button"
                onClick={install}
                className="py-2.5 px-4 rounded-xl bg-[#f1cb83]/20 border border-[#f1cb83]/45 text-[#f1cb83] text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">install_mobile</span>
                <span>نصب برنامه</span>
              </button>
            )}
          </div>
        </section>

        {/* About & Version Section */}
        <footer className="pt-4 pb-2 flex flex-col items-center justify-center gap-2 text-center">
          <KelidLogoIcon className="w-12 h-12" />
          <p className="text-xs font-extrabold text-[#f1cb83]">کلید — سامانه مدیریت هوشمند املاک و سرمایه‌گذاری</p>
          <p className="text-[10px] text-[#d1c5b4]">
            نسخه {toPersianDigits(APP_CONFIG.APP_VERSION)} • ذخیره‌سازی امن آفلاین (IndexedDB) و همگام‌سازی Google Drive
          </p>
        </footer>
      </main>
    </div>
  );
};
