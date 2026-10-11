import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { APP_CONFIG, UserRole } from '../config';

const rawConfig = firebaseConfig as Record<string, string | undefined>;
let auth: ReturnType<typeof getAuth> | null = null;

// Only initialize Firebase Auth if a valid Firebase apiKey is present
if (rawConfig.apiKey && rawConfig.apiKey.trim().length > 0) {
  try {
    const app = getApps().length === 0 ? initializeApp(rawConfig) : getApps()[0];
    auth = getAuth(app);
  } catch {
    auth = null;
  }
}

const provider = new GoogleAuthProvider();
APP_CONFIG.DRIVE_SCOPES.forEach((scope) => provider.addScope(scope));

let isSigningIn = false;
// In-memory access token cache ONLY (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export interface AuthUserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  role: UserRole;
}

export function getCurrentUserRole(): UserRole {
  const saved = localStorage.getItem('kelid_user_role') as UserRole | null;
  if (saved === 'مدیر' || saved === 'ویرایشگر' || saved === 'بیننده') {
    return saved;
  }
  return 'مدیر';
}

export function setCurrentUserRole(role: UserRole) {
  localStorage.setItem('kelid_user_role', role);
  window.dispatchEvent(new Event('kelid-role-changed'));
}

export function getConfiguredOAuthClientId(): string {
  return (
    localStorage.getItem('kelid_oauth_client_id')?.trim() ||
    APP_CONFIG.CLIENT_ID ||
    ''
  );
}

export function initAuth(
  onAuthSuccess?: (user: AuthUserProfile, token: string | null) => void,
  onAuthFailure?: () => void
) {
  if (!auth) {
    return () => {};
  }
  try {
    return onAuthStateChanged(
      auth,
      async (user: User | null) => {
        if (user) {
          const profile: AuthUserProfile = {
            uid: user.uid,
            name: user.displayName || localStorage.getItem('kelid_user_name') || 'مدیر کلید',
            email: user.email || localStorage.getItem('kelid_user_email') || '',
            photoURL: user.photoURL || undefined,
            role: getCurrentUserRole(),
          };
          if (onAuthSuccess) onAuthSuccess(profile, cachedAccessToken);
        } else if (!isSigningIn) {
          cachedAccessToken = null;
          if (onAuthFailure) onAuthFailure();
        }
      },
      () => {
        if (onAuthFailure) onAuthFailure();
      }
    );
  } catch {
    if (onAuthFailure) onAuthFailure();
    return () => {};
  }
}

function formatGoogleAuthError(err: any): string {
  const raw = String(err?.message || err?.error || err?.code || '');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const lower = raw.toLowerCase();

  if (
    lower.includes('origin_mismatch') ||
    lower.includes('redirect_uri_mismatch') ||
    lower.includes('unauthorized-domain') ||
    lower.includes('auth/unauthorized-domain') ||
    lower.includes('idpiframe_initialization_failed') ||
    lower.includes('not a valid origin') ||
    lower.includes('invalid_request')
  ) {
    return `آدرس فعلی (${origin}) در کنسول ابری گوگل (Google Cloud Console) به‌عنوان مبدا مجاز (Authorized JavaScript origin) ثبت نشده است. لطفاً طبق راهنمای PHONE-GUIDE.md آدرس ${origin} را در بخش Credentials کلاینت OAuth اضافه کنید.`;
  }

  if (lower.includes('popup_closed_by_user') || lower.includes('auth/popup-closed-by-user')) {
    return 'پنجره ورود گوگل بسته شد. لطفاً مجدداً تلاش کنید.';
  }

  if (lower.includes('popup_blocked') || lower.includes('auth/popup-blocked')) {
    return 'مرورگر پنجره بازشو (Popup) ورود گوگل را مسدود کرد. لطفاً اجازه باز شدن پنجره را بدهید.';
  }

  if (lower.includes('access_denied')) {
    return 'دسترسی به حساب گوگل یا مجوزهای Drive / Calendar تایید نشد.';
  }

  return raw || 'خطا در احراز هویت گوگل. لطفاً اتصال اینترنت و تنظیمات دامنه مجاز (Authorized Origin) را بررسی کنید.';
}

export async function googleSignIn(): Promise<{
  user: AuthUserProfile;
  accessToken: string;
} | null> {
  const gsiWin = window as any;
  const clientId = getConfiguredOAuthClientId();
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  // 1. Prefer pure browser Google Identity Services (GIS) OAuth2 Token Client (works in standalone installed PWA & any static host)
  if (gsiWin.google?.accounts?.oauth2 && clientId) {
    return new Promise((resolve, reject) => {
      try {
        isSigningIn = true;
        const tokenClient = gsiWin.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: [
            'openid',
            'email',
            'profile',
            ...APP_CONFIG.DRIVE_SCOPES,
          ].join(' '),
          error_callback: (errObj: any) => {
            isSigningIn = false;
            const errType = String(errObj?.type || errObj?.message || '');
            if (errType === 'popup_failed_to_open' || errType === 'popup_closed') {
              reject(new Error(formatGoogleAuthError({ error: errType })));
              return;
            }
            reject(
              new Error(
                `آدرس فعلی (${currentOrigin}) در Google Cloud Console به‌عنوان مبدا مجاز (Authorized JavaScript Origins) ثبت نشده یا پنجره ورود مسدود شده است.`
              )
            );
          },
          callback: async (tokenResponse: any) => {
            isSigningIn = false;
            if (tokenResponse?.error) {
              reject(new Error(formatGoogleAuthError(tokenResponse)));
              return;
            }
            const accessToken = tokenResponse?.access_token;
            if (!accessToken) {
              reject(new Error('توکن دسترسی گوگل دریافت نشد.'));
              return;
            }
            cachedAccessToken = accessToken;

            let name = localStorage.getItem('kelid_user_name') || 'مدیر کلید';
            let email = localStorage.getItem('kelid_user_email') || '';
            let photoURL: string | undefined;
            let uid = 'google_user';

            try {
              const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (userRes.ok) {
                const info = await userRes.json();
                uid = info.sub || uid;
                name = info.name || name;
                email = info.email || email;
                photoURL = info.picture;
              }
            } catch {
              // ignore userinfo fetch failure
            }

            if (name) localStorage.setItem('kelid_user_name', name);
            if (email) localStorage.setItem('kelid_user_email', email);

            const profile: AuthUserProfile = {
              uid,
              name,
              email,
              photoURL,
              role: getCurrentUserRole(),
            };
            resolve({ user: profile, accessToken });
          },
        });
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } catch (err: any) {
        isSigningIn = false;
        reject(new Error(formatGoogleAuthError(err)));
      }
    });
  }

  // 2. Fallback to Firebase Auth popup if configured
  if (auth) {
    try {
      isSigningIn = true;
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('توکن دسترسی گوگل دریافت نشد.');
      }
      cachedAccessToken = credential.accessToken;
      const profile: AuthUserProfile = {
        uid: result.user.uid,
        name: result.user.displayName || 'مدیر کلید',
        email: result.user.email || '',
        photoURL: result.user.photoURL || undefined,
        role: getCurrentUserRole(),
      };
      return { user: profile, accessToken: cachedAccessToken };
    } catch (err: any) {
      throw new Error(formatGoogleAuthError(err));
    } finally {
      isSigningIn = false;
    }
  }

  throw new Error(
    `کتابخانه احراز هویت گوگل هنوز بارگذاری نشده یا آدرس فعلی (${currentOrigin}) در لیست Authorized JavaScript origins کنسول گوگل مجاز نیست.`
  );
}

export function getAccessToken(): string | null {
  return cachedAccessToken;
}

export async function logoutGoogle() {
  const gsiWin = window as any;
  if (cachedAccessToken && gsiWin.google?.accounts?.oauth2?.revoke) {
    try {
      gsiWin.google.accounts.oauth2.revoke(cachedAccessToken, () => {});
    } catch {
      // ignore
    }
  }
  if (auth) {
    try {
      await auth.signOut();
    } catch {
      // ignore
    }
  }
  cachedAccessToken = null;
}
