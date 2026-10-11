# کلید (Kelid) — سامانه هوشمند مدیریت املاک و سرمایه‌گذاری (Offline-First Luxury Real Estate CRM PWA)

سامانه **کلید (Kelid)** یک وب‌اپلیکیشن پیشرفته (PWA) با معماری **Offline-First**، طراحی **Living Glass (شیشه زنده)** و پشتیبانی کامل از هوش مصنوعی فارسی، تقویم شمسی (جلالی)، همگام‌سازی ابری **Google Drive**، انتخاب پوشه مشترک با **Google Picker** و ثبت آلارم در **Google Calendar** است.

---

## ۱. راهنمای راه‌اندازی و تنظیمات (Setup Guide — فارسی)

### الف) اجرای محلی پروژه
1. وابستگی‌ها را نصب کنید:
   ```bash
   npm install
   ```
2. فایل `.env` را از روی `.env.example` بسازید و کلید `GEMINI_API_KEY` خود را قرار دهید.
3. سرور توسعه (Express + Vite در پورت ۳۰۰۰) را اجرا کنید:
   ```bash
   npm run dev
   ```

### ب) تنظیمات Google Cloud Console (OAuth, Drive, Picker, Calendar)
تمامی شناسه‌های پیکربندی در یک فایل مرکزی (`src/config/index.ts` متصل به `firebase-applet-config.json`) قرار دارند:
1. وارد [Google Cloud Console](https://console.cloud.google.com/) شوید و سرویس‌های زیر را در بخش **APIs & Services > Library** فعال کنید:
   - **Google Drive API**
   - **Google Picker API**
   - **Google Calendar API**
2. در بخش **OAuth consent screen** اسکوپ‌های زیر را اضافه نمایید:
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/drive.metadata.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
3. در بخش **Credentials** یک **OAuth 2.0 Client ID (Web application)** و یک **API Key** بسازید و آدرس دامنه برنامه را در `Authorized JavaScript origins` قرار دهید.

---

## 2. English Setup & Architecture Guide

### Architecture Highlights
- **Offline-First Storage**: Powered by **IndexedDB (Dexie)** with separate `mediaBlobs` storage (SHA-256 content-hash deduplication) so UI queries and 2,000+ record filters remain instantaneous (`< 50ms`).
- **Central Configuration**: All OAuth, API Key, Project ID, and Gemini model constants live in `src/config/index.ts`.
- **Google Drive Cloud Sync (`get -> merge -> upload`)**:
  - Never overwrites blindly: fetches remote snapshot, merges record-by-record using `id + updatedAt + version` with soft-delete tombstones (`deletedAt`), rotates the last 3 snapshots, and keeps confidential manager notes in a separate `kelid-confidential-manager.json` file.
- **Role-Based Access Control (RBAC)**:
  - **مدیر (Manager)**: Full access including confidential owner identity/phone/commission fields, cloud sync, and encrypted backup sharing.
  - **همکار (Collaborator)**: Can create/edit files, applicants, and reminders; confidential manager section is hidden and stripped from shared backups.
  - **بیننده (Viewer)**: Read-only mode; all create/edit/delete and quick-action (`+`) buttons are hidden.
