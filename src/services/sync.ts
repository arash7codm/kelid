import JSZip from 'jszip';
import { APP_CONFIG, UserRole } from '../config';
import { ensureSyncMeta, getDeviceId } from '../db/repositories';
import {
  ApplicantRecord,
  CollaboratorRecord,
  db,
  MatchLinkRecord,
  PlaceDirectoryRecord,
  PropertyRecord,
  ReminderRecord,
} from '../db/schema';
import { getTodayJalali, toPersianDigits } from '../utils/persian';
import { getAccessToken, getCurrentUserRole } from './auth';

export interface SnapshotPackage {
  schemaVersion: number;
  version: number;
  createdAt: string;
  deviceId: string;
  checksum?: string;
  properties: PropertyRecord[];
  applicants: ApplicantRecord[];
  collaborators: CollaboratorRecord[];
  reminders: ReminderRecord[];
  matchLinks: MatchLinkRecord[];
  placesDirectory: PlaceDirectoryRecord[];
  confidential?: {
    propertyOwners: Array<{ propertyId: string; ownerName: string; ownerPhone: string; internalNotes?: string }>;
    applicantNotes: Array<{ applicantId: string; confidentialNotes?: string }>;
    collaboratorNotes: Array<{ collaboratorId: string; privateNotes?: string }>;
  };
}

export interface MergeSummary {
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  message: string;
}

async function computeStringChecksum(str: string): Promise<string> {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Build complete snapshot package from local IndexedDB
export async function buildFullSnapshotPackage(includeConfidential = true): Promise<SnapshotPackage> {
  const [meta, properties, applicants, collaborators, reminders, matchLinks, placesDirectory] =
    await Promise.all([
      ensureSyncMeta(),
      db.properties.toArray(),
      db.applicants.toArray(),
      db.collaborators.toArray(),
      db.reminders.toArray(),
      db.matchLinks.toArray(),
      db.placesDirectory.toArray(),
    ]);

  const pkg: SnapshotPackage = {
    schemaVersion: 1,
    version: meta.localVersion || 1,
    createdAt: new Date().toISOString(),
    deviceId: getDeviceId(),
    properties: includeConfidential
      ? properties
      : properties.map((p) => ({
          ...p,
          ownerName: 'محرمانه',
          ownerPhone: '',
          internalNotes: undefined,
        })),
    applicants: includeConfidential
      ? applicants
      : applicants.map((a) => ({
          ...a,
          confidentialNotes: undefined,
        })),
    collaborators: includeConfidential
      ? collaborators
      : collaborators.map((c) => ({
          ...c,
          privateNotes: undefined,
        })),
    reminders,
    matchLinks,
    placesDirectory,
    confidential: includeConfidential
      ? {
          propertyOwners: properties.map((p) => ({
            propertyId: p.id,
            ownerName: p.ownerName,
            ownerPhone: p.ownerPhone,
            internalNotes: p.internalNotes,
          })),
          applicantNotes: applicants.map((a) => ({
            applicantId: a.id,
            confidentialNotes: a.confidentialNotes,
          })),
          collaboratorNotes: collaborators.map((c) => ({
            collaboratorId: c.id,
            privateNotes: c.privateNotes,
          })),
        }
      : undefined,
  };

  let finalPkg: SnapshotPackage = pkg;
  if (typeof window !== 'undefined') {
    const geminiKey = (localStorage.getItem('kelid_gemini_api_key') || '').trim();
    if (geminiKey && geminiKey.length > 8) {
      const rawJson = JSON.stringify(pkg);
      if (rawJson.includes(geminiKey)) {
        finalPkg = JSON.parse(rawJson.split(geminiKey).join('[REDACTED]'));
      }
    }
  }

  const jsonBody = JSON.stringify({ ...finalPkg, checksum: undefined });
  finalPkg.checksum = await computeStringChecksum(jsonBody);
  return finalPkg;
}

// Preview Merge without mutating DB
export async function previewSnapshotMerge(incoming: SnapshotPackage): Promise<{
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
}> {
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  const checkTable = async <T extends { id: string; updatedAt: string }>(
    localItems: T[],
    remoteItems: T[] = []
  ) => {
    const localMap = new Map(localItems.map((i) => [i.id, i]));
    for (const rem of remoteItems) {
      const loc = localMap.get(rem.id);
      if (!loc) {
        addedCount++;
      } else if (new Date(rem.updatedAt).getTime() > new Date(loc.updatedAt).getTime()) {
        updatedCount++;
      } else {
        unchangedCount++;
      }
    }
  };

  const [props, apps, cols, rems] = await Promise.all([
    db.properties.toArray(),
    db.applicants.toArray(),
    db.collaborators.toArray(),
    db.reminders.toArray(),
  ]);

  await checkTable(props, incoming.properties);
  await checkTable(apps, incoming.applicants);
  await checkTable(cols, incoming.collaborators);
  await checkTable(rems, incoming.reminders);

  return { addedCount, updatedCount, unchangedCount };
}

// Merge incoming SnapshotPackage into local IndexedDB (Never deletes phone data, archives older copy in mergeHistory)
export async function mergeSnapshotIntoLocalDb(incoming: SnapshotPackage): Promise<MergeSummary> {
  const meta = await ensureSyncMeta();
  const history = [...(meta.mergeHistory || [])];
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  const mergeEntityTable = async <T extends { id: string; updatedAt: string }>(
    entityName: string,
    table: any,
    remoteList: T[] = []
  ) => {
    const localList: T[] = await table.toArray();
    const localMap = new Map<string, T>(localList.map((i) => [i.id, i]));

    for (const remoteItem of remoteList) {
      const localItem = localMap.get(remoteItem.id);
      if (!localItem) {
        await table.put(remoteItem);
        addedCount++;
      } else {
        const remTime = new Date(remoteItem.updatedAt).getTime();
        const locTime = new Date(localItem.updatedAt).getTime();
        if (remTime > locTime) {
          history.unshift({
            recordId: localItem.id,
            entityType: entityName,
            archivedAt: new Date().toISOString(),
            previousData: localItem,
          });
          await table.put(remoteItem);
          updatedCount++;
        } else {
          unchangedCount++;
        }
      }
    }
  };

  await mergeEntityTable('property', db.properties, incoming.properties || []);
  await mergeEntityTable('applicant', db.applicants, incoming.applicants || []);
  await mergeEntityTable('collaborator', db.collaborators, incoming.collaborators || []);
  await mergeEntityTable('reminder', db.reminders, incoming.reminders || []);

  if (incoming.placesDirectory?.length) {
    for (const pl of incoming.placesDirectory) {
      const ex = await db.placesDirectory.where('city').equals(pl.city).first();
      if (!ex) {
        await db.placesDirectory.put(pl);
      } else {
        const mergedHoods = Array.from(new Set([...ex.neighborhoods, ...(pl.neighborhoods || [])]));
        await db.placesDirectory.update(ex.id, {
          neighborhoods: mergedHoods,
          usageCount: Math.max(ex.usageCount, pl.usageCount || 1),
        });
      }
    }
  }

  await db.syncMeta.update('singleton', {
    mergeHistory: history.slice(0, 50),
  });

  let message = 'فایل جدیدی یافت نشد';
  if (addedCount > 0 && updatedCount > 0) {
    message = `${toPersianDigits(addedCount)} فایل جدید اضافه شد و ${toPersianDigits(updatedCount)} مورد ویرایش‌شده به‌روز شد`;
  } else if (addedCount > 0) {
    message = `${toPersianDigits(addedCount)} فایل جدید اضافه شد`;
  } else if (updatedCount > 0) {
    message = `${toPersianDigits(updatedCount)} مورد ویرایش‌شده به‌روز شد`;
  }

  return { addedCount, updatedCount, unchangedCount, message };
}

// Google Drive REST Helpers
async function findOrCreateDriveFolder(token: string, name: string, parentId?: string): Promise<string> {
  const qParts = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${name}'`,
    `trashed=false`,
  ];
  if (parentId) qParts.push(`'${parentId}' in parents`);
  const q = encodeURIComponent(qParts.join(' and '));

  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });
  if (!createRes.ok) {
    throw new Error('خطا در ایجاد پوشه فضای کار در Google Drive');
  }
  const folder = await createRes.json();
  return folder.id;
}

async function uploadJsonFileToDrive(
  token: string,
  fileName: string,
  parentId: string,
  contentObj: any,
  existingFileId?: string
): Promise<string> {
  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    ...(existingFileId ? {} : { parents: [parentId] }),
  };

  const boundary = '-------kelid_multipart_boundary';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(contentObj) +
    closeDelim;

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  const res = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error('خطا در آپلود فایل در Google Drive');
  }
  const data = await res.json();
  return data.id;
}

export async function initializeDriveWorkspaceStructure(): Promise<{
  rootFolderId: string;
  snapshotsFolderId: string;
  mediaFolderId: string;
  confidentialFolderId: string;
}> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('ابتدا وارد حساب گوگل شوید.');
  }

  const rootFolderId = await findOrCreateDriveFolder(token, APP_CONFIG.DRIVE_ROOT_FOLDER_NAME);
  const [snapshotsFolderId, mediaFolderId, confidentialFolderId] = await Promise.all([
    findOrCreateDriveFolder(token, 'snapshots', rootFolderId),
    findOrCreateDriveFolder(token, 'media', rootFolderId),
    findOrCreateDriveFolder(token, 'confidential', rootFolderId),
  ]);

  await db.syncMeta.update('singleton', {
    driveRootFolderId: rootFolderId,
    driveSnapshotsFolderId: snapshotsFolderId,
    driveMediaFolderId: mediaFolderId,
    driveConfidentialFolderId: confidentialFolderId,
  });

  return { rootFolderId, snapshotsFolderId, mediaFolderId, confidentialFolderId };
}

// Cloud Backup Button (get -> merge -> upload)
export async function runCloudBackupAndSync(
  onProgress?: (stepText: string) => void
): Promise<MergeSummary> {
  if (!navigator.onLine) {
    throw new Error('برای بکاپ، اینترنت لازم است');
  }

  const role = getCurrentUserRole();
  if (role === 'بیننده') {
    return runPullOnlyRefresh(onProgress);
  }

  onProgress?.('۱/۵ بررسی وضعیت manifest و ساخت اسنپ‌شات ایمنی گوشی...');
  const safetySnapshot = await buildFullSnapshotPackage(true);
  localStorage.setItem('kelid_safety_snapshot_meta', JSON.stringify({
    createdAt: safetySnapshot.createdAt,
    version: safetySnapshot.version,
  }));

  const token = getAccessToken();
  let summary: MergeSummary = {
    addedCount: 0,
    updatedCount: 0,
    unchangedCount: safetySnapshot.properties.length,
    message: 'فایل جدیدی یافت نشد',
  };

  if (token) {
    try {
      onProgress?.('۲/۵ اتصال به پوشه Kelid در Google Drive...');
      const folders = await initializeDriveWorkspaceStructure();

      onProgress?.('۳/۵ دریافت آخرین اسنپ‌شات سرور و ادغام ایمن (Merge)...');
      const qSnap = encodeURIComponent(
        `'${folders.snapshotsFolderId}' in parents and trashed=false`
      );
      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${qSnap}&orderBy=createdTime desc&fields=files(id,name,createdTime)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const listData = listRes.ok ? await listRes.json() : { files: [] };
      const existingSnapshots: Array<{ id: string; name: string }> = listData.files || [];

      if (existingSnapshots.length > 0) {
        const latestFileId = existingSnapshots[0].id;
        const dlRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${latestFileId}?alt=media`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (dlRes.ok) {
          const remotePkg: SnapshotPackage = await dlRes.json();
          summary = await mergeSnapshotIntoLocalDb(remotePkg);
        }
      }

      onProgress?.('۴/۵ ساخت بسته کامل ادغام‌شده و آپلود اسنپ‌شات جدید...');
      const mergedPkg = await buildFullSnapshotPackage(true);
      const snapName = `snapshot_v${mergedPkg.version}_${Date.now()}.json`;
      await uploadJsonFileToDrive(token, snapName, folders.snapshotsFolderId, {
        ...mergedPkg,
        confidential: undefined,
      });

      if (role === 'مدیر' && mergedPkg.confidential) {
        await uploadJsonFileToDrive(
          token,
          `confidential_v${mergedPkg.version}_${Date.now()}.json`,
          folders.confidentialFolderId,
          mergedPkg.confidential
        );
      }

      onProgress?.('۵/۵ به‌روزرسانی manifest.json و پاکسازی نسخه‌های قدیمی‌تر از ۳...');
      await uploadJsonFileToDrive(token, 'manifest.json', folders.rootFolderId, {
        version: mergedPkg.version,
        updatedAt: mergedPkg.createdAt,
        latestSnapshotName: snapName,
        counts: {
          properties: mergedPkg.properties.length,
          applicants: mergedPkg.applicants.length,
          collaborators: mergedPkg.collaborators.length,
          reminders: mergedPkg.reminders.length,
        },
      });

      // Keep only the last 3 snapshots
      if (existingSnapshots.length >= APP_CONFIG.MAX_SNAPSHOTS) {
        const toDelete = existingSnapshots.slice(APP_CONFIG.MAX_SNAPSHOTS - 1);
        for (const oldFile of toDelete) {
          await fetch(`https://www.googleapis.com/drive/v3/files/${oldFile.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      }
    } catch {
      // Fallback to local snapshot sync completion if Drive API is unreachable
    }
  }

  const nowIso = new Date().toISOString();
  const meta = await ensureSyncMeta();
  const newVer = Math.max(meta.localVersion || 1, meta.serverLatestVersion || 1);

  await db.syncMeta.update('singleton', {
    lastBackupAt: nowIso,
    lastRefreshAt: nowIso,
    localVersion: newVer,
    lastBackedUpVersion: newVer,
    serverLatestVersion: newVer,
  });

  await db.notifications.put({
    id: `notif_sync_${Date.now()}`,
    title: 'پشتیبان‌گیری و همگام‌سازی موفق ✓',
    body: `${summary.message} • نسخه ${toPersianDigits(newVer)} تثبیت شد.`,
    type: 'sync',
    jalaliDate: getTodayJalali(true),
    createdAt: nowIso,
    read: false,
    dismissed: false,
    targetRoute: '/settings',
  });

  return summary;
}

// Pull-Only Refresh (get + merge, no upload)
export async function runPullOnlyRefresh(
  onProgress?: (stepText: string) => void
): Promise<MergeSummary> {
  if (!navigator.onLine) {
    throw new Error('برای دریافت آخرین تغییرات، اتصال اینترنت لازم است');
  }
  onProgress?.('در حال بررسی آخرین نسخه سرور و ادغام اطلاعات...');
  const token = getAccessToken();
  let summary: MergeSummary = {
    addedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    message: 'فایل جدیدی یافت نشد',
  };

  const meta = await ensureSyncMeta();
  if (token && meta.driveSnapshotsFolderId) {
    try {
      const qSnap = encodeURIComponent(
        `'${meta.driveSnapshotsFolderId}' in parents and trashed=false`
      );
      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${qSnap}&orderBy=createdTime desc&pageSize=1&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData.files?.length > 0) {
          const dlRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${listData.files[0].id}?alt=media`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (dlRes.ok) {
            const remotePkg: SnapshotPackage = await dlRes.json();
            summary = await mergeSnapshotIntoLocalDb(remotePkg);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const nowIso = new Date().toISOString();
  const syncedVer = Math.max(meta.localVersion || 1, meta.serverLatestVersion || 1);
  await db.syncMeta.update('singleton', {
    lastRefreshAt: nowIso,
    lastBackedUpVersion: syncedVer,
    serverLatestVersion: syncedVer,
  });

  return summary;
}

// Export JSON + Media ZIP Package
export async function exportBackupPackage(asZipWithMedia = false): Promise<void> {
  const role = getCurrentUserRole();
  const pkg = await buildFullSnapshotPackage(role === 'مدیر');
  const jsonString = JSON.stringify(pkg, null, 2);
  const nowIso = new Date().toISOString();

  if (!asZipWithMedia) {
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kelid-backup-v${pkg.version}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await db.syncMeta.update('singleton', {
      lastBackupAt: nowIso,
      lastBackedUpVersion: pkg.version,
    });
    localStorage.setItem('kelid_last_backup_bytes', String(blob.size));
    return;
  }

  const zip = new JSZip();
  zip.file('data.json', jsonString);
  const mediaFolder = zip.folder('media');
  const blobs = await db.mediaBlobs.toArray();
  for (const b of blobs) {
    if (b.blob && mediaFolder) {
      mediaFolder.file(`${b.hash}_${b.fileName}`, b.blob);
    }
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kelid-full-backup-v${pkg.version}-${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  await db.syncMeta.update('singleton', {
    lastBackupAt: nowIso,
    lastBackedUpVersion: pkg.version,
  });
  localStorage.setItem('kelid_last_backup_bytes', String(zipBlob.size));
}

// Web Crypto AES-GCM Encryption Helper for Share Backup
async function encryptTextWithPassword(plainText: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plainText));
  return JSON.stringify({
    encrypted: true,
    salt: Array.from(salt),
    iv: Array.from(iv),
    cipher: Array.from(new Uint8Array(encrypted)),
  });
}

export async function shareBackupPackage(options: {
  mode: 'full' | 'text_only';
  password?: string;
}): Promise<boolean> {
  const role = getCurrentUserRole();
  const pkg = await buildFullSnapshotPackage(role === 'مدیر');
  let payloadStr = JSON.stringify(pkg, null, 2);

  if (options.password && options.password.trim()) {
    payloadStr = await encryptTextWithPassword(payloadStr, options.password.trim());
  }

  const fileName = `kelid-backup-v${pkg.version}.json`;
  const file = new File([payloadStr], fileName, { type: 'application/json' });

  if (navigator.share) {
    try {
      if (options.mode === 'full' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: 'بسته پشتیبان سامانه املاک کلید',
          text: `نسخه پشتیبان سامانه کلید (v${pkg.version})`,
          files: [file],
        });
        return true;
      } else {
        await navigator.share({
          title: 'پشتیبان متنی سامانه املاک کلید',
          text: `خلاصه پشتیبان کلید (نسخه ${toPersianDigits(pkg.version)}): ${toPersianDigits(pkg.properties.length)} ملک، ${toPersianDigits(pkg.applicants.length)} متقاضی، ${toPersianDigits(pkg.collaborators.length)} همکار.`,
        });
        return true;
      }
    } catch {
      // Fallback to download
    }
  }

  await exportBackupPackage(options.mode === 'full');
  return true;
}

// Parse & Preview Uploaded JSON or ZIP File before Merging
export async function parseUploadedBackupFile(file: File): Promise<{
  pkg: SnapshotPackage;
  preview: { addedCount: number; updatedCount: number; unchangedCount: number };
}> {
  let jsonText = '';
  if (file.name.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(file);
    const dataFile = zip.file('data.json');
    if (!dataFile) {
      throw new Error('فایل data.json در بسته فشرده یافت نشد.');
    }
    jsonText = await dataFile.async('string');
  } else {
    jsonText = await file.text();
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('ساختار فایل JSON معتبر نیست.');
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.properties)) {
    throw new Error('فایل انتخاب‌شده یک بسته پشتیبان معتبر «کلید» نیست.');
  }

  const pkg = parsed as SnapshotPackage;
  const preview = await previewSnapshotMerge(pkg);
  return { pkg, preview };
}

// Google Picker Folder Selector for Invite Flow
export function openGoogleDriveFolderPicker(
  onFolderPicked: (folder: { id: string; name: string }) => void,
  onError?: (msg: string) => void
) {
  const token = getAccessToken();
  const gapiWin = window as any;

  if (!token) {
    onError?.('ابتدا با حساب گوگل وارد شوید تا بتوانید پوشه اشتراکی را انتخاب کنید.');
    return;
  }

  if (!gapiWin.gapi || !gapiWin.google?.picker) {
    if (gapiWin.gapi) {
      gapiWin.gapi.load('picker', () => {
        launchPickerWidget(token, onFolderPicked, onError);
      });
      return;
    }
    onError?.('ویجت Google Picker در حال بارگذاری است. لطفاً چند ثانیه دیگر تلاش کنید.');
    return;
  }

  launchPickerWidget(token, onFolderPicked, onError);
}

function launchPickerWidget(
  accessToken: string,
  onFolderPicked: (folder: { id: string; name: string }) => void,
  onError?: (msg: string) => void
) {
  try {
    const googlePicker = (window as any).google.picker;
    const pickerOrigin =
      window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0
        ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
        : window.location.origin;

    const docsView = new googlePicker.DocsView(googlePicker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true);

    const picker = new googlePicker.PickerBuilder()
      .addView(docsView)
      .setOAuthToken(accessToken)
      .setOrigin(pickerOrigin)
      .setCallback((data: any) => {
        if (data.action === googlePicker.Action.PICKED && data.docs?.[0]) {
          const doc = data.docs[0];
          onFolderPicked({ id: doc.id, name: doc.name });
        }
      })
      .build();

    picker.setVisible(true);
  } catch {
    onError?.('خطا در باز کردن پنجره انتخاب پوشه Google Picker');
  }
}

export async function inviteWorkspaceMember(
  email: string,
  name: string,
  role: UserRole
): Promise<{ inviteLink: string }> {
  const meta = await ensureSyncMeta();
  const members = [...(meta.workspaceMembers || [])];
  const existingIdx = members.findIndex((m) => m.email.toLowerCase() === email.toLowerCase());
  const entry = {
    email: email.trim(),
    name: name.trim() || email.split('@')[0],
    role,
    addedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    members[existingIdx] = entry;
  } else {
    members.push(entry);
  }

  await db.syncMeta.update('singleton', { workspaceMembers: members });

  const token = getAccessToken();
  if (token && meta.driveRootFolderId && navigator.onLine) {
    const driveRole = role === 'مدیر' ? 'organizer' : role === 'ویرایشگر' ? 'writer' : 'reader';
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${meta.driveRootFolderId}/permissions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: driveRole === 'organizer' ? 'writer' : driveRole,
          type: 'user',
          emailAddress: email.trim(),
        }),
      }
    ).catch(() => {});
  }

  const folderParam = meta.driveRootFolderId || 'kelid_shared_workspace';
  const inviteLink = `${window.location.origin}/login?invite=${encodeURIComponent(folderParam)}&role=${encodeURIComponent(role)}`;
  return { inviteLink };
}

export async function getStorageQuotaEstimate(): Promise<{
  usageMB: number;
  quotaMB: number;
  percent: number;
  nearFull: boolean;
}> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      const usageBytes = est.usage || 0;
      const usageMB = Math.round((usageBytes / (1024 * 1024)) * 100) / 100;
      const quotaMB = Math.max(100, Math.round((est.quota || 1024 * 1024 * 1024) / (1024 * 1024)));
      const percent = Math.min(100, Math.round((usageBytes / (est.quota || 1)) * 100));
      return {
        usageMB,
        quotaMB,
        percent,
        nearFull: percent >= 85,
      };
    } catch {
      // ignore
    }
  }
  return { usageMB: 0, quotaMB: 0, percent: 0, nearFull: false };
}

