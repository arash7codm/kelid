import firebaseConfig from '../../firebase-applet-config.json';

export const APP_CONFIG = {
  APP_NAME: 'کلید',
  APP_VERSION: '2.4.0',
  CLIENT_ID: firebaseConfig.oAuthClientId || '',
  API_KEY: firebaseConfig.apiKey || '',
  PROJECT_ID: firebaseConfig.projectId || '',
  APP_URL: typeof window !== 'undefined' ? window.location.origin : '',
  DRIVE_ROOT_FOLDER_NAME: 'Kelid',
  DRIVE_SCOPES: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
  AI_TEXT_MODEL: 'gemini-3.8-flash',
  AI_TRANSCRIBE_MODEL: 'gemini-3.5-transcribe',
  MATCH_THRESHOLD: 70,
  MAX_SNAPSHOTS: 3,
  BACKUP_RED_HOURS: 24,
  ASSETS: {
    LOGO_KEY: './images/kelid-logo-2x.png',
    LOGO_KEY_1X: './images/kelid-logo-1x.png',
    LOGO_KEY_WEBP_1X: './images/kelid-logo-1x.webp',
    LOGO_KEY_WEBP_2X: './images/kelid-logo-2x.webp',
    LOGO_EMBLEM: './images/kelid-logo-2x.png',
    LOGO_BADGE: './images/kelid-badge-circle.png',
    PROPERTY_LAND: './images/kelarabad-land.jpg',
    PROPERTY_VILLA: './images/motelghoo-villa.jpg',
    PROPERTY_PLOT: './images/namakabrud-plot.jpg',
  },
} as const;

export type UserRole = 'مدیر' | 'ویرایشگر' | 'بیننده';

export type PropertyStatus = 'فعال' | 'در مذاکره' | 'فروخته‌شده' | 'غیرفعال';

export type CreditTier = 'عالی' | 'خوب' | 'عادی' | 'ضعیف';
