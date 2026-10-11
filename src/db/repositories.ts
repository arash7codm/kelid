import { APP_CONFIG } from '../config';
import { runMatchingEngine } from '../services/matching';
import {
  compareJalaliDates,
  getTodayJalali,
  isCurrentJalaliMonth,
  isJalaliDateOverdue,
  toEnglishDigits,
  toPersianDigits,
} from '../utils/persian';
import {
  ApplicantRecord,
  CollaboratorRecord,
  db,
  MatchLinkRecord,
  MediaBlobRecord,
  NotificationRecord,
  PlaceDirectoryRecord,
  PropertyRecord,
  ReminderRecord,
  SyncMetaRecord,
} from './schema';

export function getDeviceId(): string {
  let devId = localStorage.getItem('kelid_device_id');
  if (!devId) {
    devId = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem('kelid_device_id', devId);
  }
  return devId;
}

export async function ensureSyncMeta(): Promise<SyncMetaRecord> {
  let meta = await db.syncMeta.get('singleton');
  if (!meta) {
    meta = {
      id: 'singleton',
      deviceId: getDeviceId(),
      localVersion: 1,
      lastBackedUpVersion: 1,
      serverLatestVersion: 1,
      lastBackupAt: undefined,
      workspaceMembers: [],
      mergeHistory: [],
    };
    await db.syncMeta.put(meta);
  }
  return meta;
}

export async function markLocalMutation() {
  const meta = await ensureSyncMeta();
  await db.syncMeta.update('singleton', {
    localVersion: (meta.localVersion || 1) + 1,
    lastLocalMutationAt: new Date().toISOString(),
  });
}

// Auto-generate unique code for F, C, H, R
export async function generateNextCode(prefix: 'F' | 'C' | 'H' | 'R'): Promise<string> {
  const tableMap = {
    F: db.properties,
    C: db.applicants,
    H: db.collaborators,
    R: db.reminders,
  };
  const all = await tableMap[prefix].toArray();
  let maxNum = 0;
  for (const item of all) {
    const clean = toEnglishDigits(item.code || '');
    const m = clean.match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const next = maxNum + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

// SHA-256 Hash for Media Blobs
export async function computeBlobHash(blob: Blob): Promise<string> {
  try {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `hash_${blob.size}_${Date.now()}`;
  }
}

export async function saveMediaBlob(
  file: Blob,
  fileName: string,
  dimensions?: { width: number; height: number }
): Promise<MediaBlobRecord> {
  const hash = await computeBlobHash(file);
  const existing = await db.mediaBlobs.where('hash').equals(hash).first();
  if (existing) return existing;

  const rec: MediaBlobRecord = {
    id: `media_${hash.substring(0, 16)}_${Date.now()}`,
    hash,
    mimeType: file.type || 'application/octet-stream',
    blob: file,
    fileName,
    sizeBytes: file.size,
    width: dimensions?.width,
    height: dimensions?.height,
    createdAt: new Date().toISOString(),
  };
  await db.mediaBlobs.put(rec);
  await markLocalMutation();
  return rec;
}

const blobUrlCache = new Map<string, string>();
export async function getMediaBlobUrl(mediaId: string | undefined): Promise<string | null> {
  if (!mediaId) return null;
  if (mediaId.startsWith('/') || mediaId.startsWith('http') || mediaId.startsWith('data:')) {
    return mediaId;
  }
  if (blobUrlCache.has(mediaId)) {
    return blobUrlCache.get(mediaId)!;
  }
  const rec = await db.mediaBlobs.get(mediaId);
  if (!rec || !rec.blob) return null;
  const url = URL.createObjectURL(rec.blob);
  blobUrlCache.set(mediaId, url);
  return url;
}

// Shared Place Directory Service
export async function registerPlaceUsage(city: string, neighborhoods: string[] = []) {
  const cleanCity = city.trim();
  if (!cleanCity) return;
  const existing = await db.placesDirectory.where('city').equals(cleanCity).first();
  const cleanHoods = neighborhoods.map((h) => h.trim()).filter(Boolean);

  if (existing) {
    const mergedHoods = Array.from(new Set([...existing.neighborhoods, ...cleanHoods]));
    await db.placesDirectory.update(existing.id, {
      neighborhoods: mergedHoods,
      usageCount: existing.usageCount + 1,
      updatedAt: new Date().toISOString(),
    });
  } else {
    const rec: PlaceDirectoryRecord = {
      id: `place_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      city: cleanCity,
      neighborhoods: cleanHoods,
      usageCount: 1,
      updatedAt: new Date().toISOString(),
    };
    await db.placesDirectory.put(rec);
  }
}

export async function getTopUsedCities(limit = 3): Promise<string[]> {
  const all = await db.placesDirectory.orderBy('usageCount').reverse().toArray();
  return all.slice(0, limit).map((p) => p.city);
}

export async function getAllPlacesDirectory(): Promise<PlaceDirectoryRecord[]> {
  return db.placesDirectory.orderBy('usageCount').reverse().toArray();
}

// Synchronize Follow-up Date with Reminder Store
export async function syncFollowupReminder(params: {
  entityType: 'property' | 'applicant' | 'collaborator';
  entityId: string;
  entityCode: string;
  entityTitle: string;
  followupDate?: string;
}) {
  const { entityType, entityId, entityCode, entityTitle, followupDate } = params;
  if (!followupDate || !followupDate.trim()) return;

  const fieldMap = {
    property: 'linkedPropertyId',
    applicant: 'linkedApplicantId',
    collaborator: 'linkedCollaboratorId',
  } as const;

  const existing = await db.reminders
    .filter((r) => !r.deleted && r.status === 'pending' && r[fieldMap[entityType]] === entityId)
    .first();

  const nowIso = new Date().toISOString();
  if (existing) {
    await db.reminders.update(existing.id, {
      jalaliDate: toPersianDigits(followupDate),
      updatedAt: nowIso,
      version: (existing.version || 1) + 1,
    });
  } else {
    const code = await generateNextCode('R');
    const newReminder: ReminderRecord = {
      id: `rem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      code,
      title: `پیگیری دوره پرونده ${entityTitle} (${entityCode})`,
      transcript: `یادآور خودکار ثبت‌شده برای موعد پیگیری ${entityTitle} (${entityCode}) در تاریخ ${toPersianDigits(followupDate)}.`,
      jalaliDate: toPersianDigits(followupDate),
      time: '10:30',
      timeDisplay: '۱۰:۳۰ قبل‌ازظهر',
      linkedPropertyId: entityType === 'property' ? entityId : undefined,
      linkedApplicantId: entityType === 'applicant' ? entityId : undefined,
      linkedCollaboratorId: entityType === 'collaborator' ? entityId : undefined,
      customLinks: [],
      categories: ['phone'],
      priority: isJalaliDateOverdue(followupDate) ? 'urgent' : 'normal',
      smsNotification: true,
      registerInCartable: true,
      status: 'pending',
      calendarStatus: 'none',
      syncStatus: 'local',
      aiFilledFields: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
      deviceId: getDeviceId(),
      deleted: false,
    };
    await db.reminders.put(newReminder);
  }
}

// CRUD Operations with Soft Delete & Undo
export async function saveProperty(data: Partial<PropertyRecord> & { id?: string }): Promise<PropertyRecord> {
  const nowIso = new Date().toISOString();
  const existing = data.id ? await db.properties.get(data.id) : undefined;
  const code = existing?.code || data.code || (await generateNextCode('F'));
  const id = existing?.id || data.id || `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const record: PropertyRecord = {
    ...(existing || {}),
    ...(data as PropertyRecord),
    id,
    code,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    version: (existing?.version || 0) + 1,
    deviceId: getDeviceId(),
    deleted: false,
    photos: data.photos || existing?.photos || [],
    documents: data.documents || existing?.documents || [],
  };

  await db.properties.put(record);
  if (record.city) {
    await registerPlaceUsage(record.city, record.district ? [record.district] : []);
  }
  if (record.nextFollowupDate) {
    await syncFollowupReminder({
      entityType: 'property',
      entityId: record.id,
      entityCode: record.code,
      entityTitle: record.title,
      followupDate: record.nextFollowupDate,
    });
  }
  await markLocalMutation();
  await runMatchingEngine(true);
  return record;
}

export async function saveApplicant(data: Partial<ApplicantRecord> & { id?: string }): Promise<ApplicantRecord> {
  const nowIso = new Date().toISOString();
  const existing = data.id ? await db.applicants.get(data.id) : undefined;
  const code = existing?.code || data.code || (await generateNextCode('C'));
  const id = existing?.id || data.id || `app_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Rule: "جدید" status ends at the first contact
  let status = data.status || existing?.status || 'جدید';
  if (status === 'جدید' && data.lastContactDate) {
    status = 'در حال پیگیری';
  }

  const record: ApplicantRecord = {
    ...(existing || {}),
    ...(data as ApplicantRecord),
    id,
    code,
    status,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    version: (existing?.version || 0) + 1,
    deviceId: getDeviceId(),
    deleted: false,
  };

  await db.applicants.put(record);
  for (const c of record.cities || []) {
    await registerPlaceUsage(c, record.neighborhoods || []);
  }
  if (record.nextFollowupDate) {
    await syncFollowupReminder({
      entityType: 'applicant',
      entityId: record.id,
      entityCode: record.code,
      entityTitle: record.name,
      followupDate: record.nextFollowupDate,
    });
  }
  await markLocalMutation();
  await runMatchingEngine(true);
  return record;
}

export async function saveCollaborator(
  data: Partial<CollaboratorRecord> & { id?: string }
): Promise<CollaboratorRecord> {
  const nowIso = new Date().toISOString();
  const existing = data.id ? await db.collaborators.get(data.id) : undefined;
  const code = existing?.code || data.code || (await generateNextCode('H'));
  const id = existing?.id || data.id || `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const record: CollaboratorRecord = {
    ...(existing || {}),
    ...(data as CollaboratorRecord),
    id,
    code,
    successfulDealsCount: data.successfulDealsCount ?? existing?.successfulDealsCount ?? 0,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    version: (existing?.version || 0) + 1,
    deviceId: getDeviceId(),
    deleted: false,
  };

  await db.collaborators.put(record);
  if (record.primaryCity) {
    await registerPlaceUsage(record.primaryCity, record.neighborhoods || []);
  }
  if (record.nextFollowupDate) {
    await syncFollowupReminder({
      entityType: 'collaborator',
      entityId: record.id,
      entityCode: record.code,
      entityTitle: record.name,
      followupDate: record.nextFollowupDate,
    });
  }
  await markLocalMutation();
  return record;
}

export async function saveReminder(data: Partial<ReminderRecord> & { id?: string }): Promise<ReminderRecord> {
  const nowIso = new Date().toISOString();
  const existing = data.id ? await db.reminders.get(data.id) : undefined;
  const code = existing?.code || data.code || (await generateNextCode('R'));
  const id = existing?.id || data.id || `rem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const record: ReminderRecord = {
    ...(existing || {}),
    ...(data as ReminderRecord),
    id,
    code,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    version: (existing?.version || 0) + 1,
    deviceId: getDeviceId(),
    deleted: false,
  };

  await db.reminders.put(record);

  // Update derived nextFollowupDate on linked applicant/collaborator
  if (record.status === 'pending' && record.jalaliDate) {
    if (record.linkedApplicantId) {
      await db.applicants.update(record.linkedApplicantId, {
        nextFollowupDate: record.jalaliDate,
      });
    }
    if (record.linkedCollaboratorId) {
      await db.collaborators.update(record.linkedCollaboratorId, {
        nextFollowupDate: record.jalaliDate,
      });
    }
  }

  await markLocalMutation();
  return record;
}

export async function completeReminderWithResult(
  reminderId: string,
  callResult?: 'موفق' | 'بی‌پاسخ' | 'نیاز به تماس مجدد'
) {
  const rem = await db.reminders.get(reminderId);
  if (!rem) return;
  const nowIso = new Date().toISOString();
  const todayJalali = getTodayJalali(true);

  await db.reminders.update(reminderId, {
    status: 'done',
    callResult,
    completedAt: nowIso,
    updatedAt: nowIso,
    version: (rem.version || 1) + 1,
  });

  if (rem.linkedApplicantId) {
    const app = await db.applicants.get(rem.linkedApplicantId);
    if (app) {
      await db.applicants.update(app.id, {
        lastContactDate: todayJalali,
        status: app.status === 'جدید' ? 'در حال پیگیری' : app.status,
      });
    }
  }

  if (rem.linkedCollaboratorId) {
    await db.collaborators.update(rem.linkedCollaboratorId, {
      lastContactDate: todayJalali,
      lastContactResult: callResult || 'موفق',
    });
  }

  await markLocalMutation();
}

export async function softDeleteEntity(
  table: 'properties' | 'applicants' | 'collaborators' | 'reminders',
  id: string
): Promise<() => Promise<void>> {
  const nowIso = new Date().toISOString();
  await (db[table] as any).update(id, {
    deleted: true,
    updatedAt: nowIso,
  });
  await markLocalMutation();

  // Return undo callback
  return async () => {
    await (db[table] as any).update(id, {
      deleted: false,
      updatedAt: new Date().toISOString(),
    });
    await markLocalMutation();
  };
}

// ============================================================================
// ONE SHARED SELECTORS MODULE (Used by ALL screens so numbers always agree)
// ============================================================================
export interface GlobalAppSnapshot {
  properties: PropertyRecord[];
  applicants: ApplicantRecord[];
  collaborators: CollaboratorRecord[];
  reminders: ReminderRecord[];
  matchLinks: MatchLinkRecord[];
  notifications: NotificationRecord[];
  syncMeta: SyncMetaRecord;

  // Derived Counters
  propertyStats: {
    total: number;
    active: number;
    negotiating: number;
    sold: number;
    inactive: number;
    newThisMonth: number;
    needFollowup: number;
    missingCoordinatesCount: number;
    premiumTop3: PropertyRecord[];
  };
  applicantStats: {
    total: number;
    overdue: number;
    following: number;
    newCount: number;
    visitCount: number;
    doneCount: number;
    totalDemandToman: number;
  };
  collaboratorStats: {
    total: number;
    overdue: number;
    activePartners: number;
    newPartners: number;
    evaluatingPartners: number;
    inactivePartners: number;
    receivedFilesCount: number;
  };
  inboxStats: {
    totalToday: number;
    overdueAndUrgent: number;
    callsAndVisits: number;
    completedCount: number;
    callsCount: number;
    visitsCount: number;
  };
  dashboardAlerts: Array<{
    id: string;
    badge: string;
    codeLabel: string;
    delayLabel: string;
    title: string;
    subtitle: string;
    actionLabel: string;
    phone?: string;
    targetRoute: string;
    propertyIdForDismiss?: string;
  }>;
  unreadNotificationsCount: number;
  syncStatusColor: 'green' | 'yellow' | 'red';
  pendingUnsyncedCount: number;
}

export async function getGlobalAppSnapshot(): Promise<GlobalAppSnapshot> {
  const [
    allProperties,
    allApplicants,
    allCollaborators,
    allReminders,
    allMatches,
    allNotifications,
    syncMeta,
  ] = await Promise.all([
    db.properties.filter((p) => !p.deleted).toArray(),
    db.applicants.filter((a) => !a.deleted).toArray(),
    db.collaborators.filter((c) => !c.deleted).toArray(),
    db.reminders.filter((r) => !r.deleted).toArray(),
    db.matchLinks.toArray(),
    db.notifications.filter((n) => !n.dismissed).toArray(),
    ensureSyncMeta(),
  ]);

  const todayJalali = getTodayJalali(false);

  // Reminders & Overdue Calculations
  const pendingReminders = allReminders.filter((r) => r.status === 'pending');
  const completedReminders = allReminders.filter((r) => r.status === 'done');

  const overdueReminders = pendingReminders.filter(
    (r) => isJalaliDateOverdue(r.jalaliDate) || r.priority === 'urgent'
  );

  // Applicant overdue check
  const isApplicantOverdue = (a: ApplicantRecord) => {
    if (a.nextFollowupDate && isJalaliDateOverdue(a.nextFollowupDate)) return true;
    return pendingReminders.some(
      (r) => r.linkedApplicantId === a.id && isJalaliDateOverdue(r.jalaliDate)
    );
  };

  // Collaborator overdue check
  const isCollaboratorOverdue = (c: CollaboratorRecord) => {
    if (c.nextFollowupDate && isJalaliDateOverdue(c.nextFollowupDate)) return true;
    return pendingReminders.some(
      (r) => r.linkedCollaboratorId === c.id && isJalaliDateOverdue(r.jalaliDate)
    );
  };

  // Expired Permit Properties (not dismissed)
  const expiredPermitProps = allProperties.filter(
    (p) =>
      !p.dismissPermitWarning &&
      p.permitExpiryDate &&
      isJalaliDateOverdue(p.permitExpiryDate)
  );

  // Dashboard Alerts List
  const dashboardAlerts: GlobalAppSnapshot['dashboardAlerts'] = [];

  for (const prop of expiredPermitProps) {
    dashboardAlerts.push({
      id: `alert_permit_${prop.id}`,
      badge: 'جواز منقضی شده',
      codeLabel: `فایل: ${prop.code}`,
      delayLabel: `انقضا: ${toPersianDigits(prop.permitExpiryDate)}`,
      title: `${prop.title} (${prop.code})`,
      subtitle: 'مهلت اعتبار پروانه ساختمانی سپری شده است و نیاز به تمدید دارد',
      actionLabel: 'تماس با مالک',
      phone: prop.ownerPhone,
      targetRoute: `/properties/${prop.id}`,
      propertyIdForDismiss: prop.id,
    });
  }

  for (const app of allApplicants.filter(isApplicantOverdue)) {
    dashboardAlerts.push({
      id: `alert_app_${app.id}`,
      badge: 'پیگیری عقب‌افتاده',
      codeLabel: app.code,
      delayLabel: `موعد: ${toPersianDigits(app.nextFollowupDate || getTodayJalali(true))}`,
      title: `${app.name} (${app.desiredPropertyTypes.join('، ') || 'متقاضی'})`,
      subtitle: `پیگیری وضعیت خرید و هماهنگی بازدید پرونده ${app.code}`,
      actionLabel: 'پیگیری سریع',
      phone: app.phone,
      targetRoute: `/applicants/${app.id}/edit`,
    });
  }

  for (const col of allCollaborators.filter(isCollaboratorOverdue)) {
    dashboardAlerts.push({
      id: `alert_col_${col.id}`,
      badge: 'پیگیری همکار معوق',
      codeLabel: col.code,
      delayLabel: `موعد: ${toPersianDigits(col.nextFollowupDate || getTodayJalali(true))}`,
      title: `${col.name} (${col.agencyName || col.primaryCity})`,
      subtitle: 'پیگیری تماس جدید و دریافت فایل‌های پیشنهادی مشترک',
      actionLabel: 'تماس با همکار',
      phone: col.phone,
      targetRoute: `/collaborators/${col.id}/edit`,
    });
  }

  // Property Stats
  const activeProps = allProperties.filter((p) => p.status === 'فعال');
  const negotiatingProps = allProperties.filter((p) => p.status === 'در مذاکره');
  const soldProps = allProperties.filter((p) => p.status === 'فروخته‌شده');
  const inactiveProps = allProperties.filter((p) => p.status === 'غیرفعال');
  const newThisMonthProps = allProperties.filter((p) => isCurrentJalaliMonth(p.registerDate));
  const missingCoordinatesCount = allProperties.filter(
    (p) => typeof p.lat !== 'number' || typeof p.lng !== 'number'
  ).length;
  const premiumTop3 = [...activeProps]
    .sort((a, b) => (b.totalPrice || 0) - (a.totalPrice || 0))
    .slice(0, 3);

  // Applicant Stats
  const overdueApplicantsCount = allApplicants.filter(isApplicantOverdue).length;
  const followingApplicantsCount = allApplicants.filter((a) => a.status === 'در حال پیگیری').length;
  const newApplicantsCount = allApplicants.filter((a) => a.status === 'جدید').length;
  const visitApplicantsCount = allApplicants.filter((a) => a.status === 'بازدید').length;
  const doneApplicantsCount = allApplicants.filter((a) => a.status === 'معامله‌شده').length;
  const totalDemandToman = allApplicants.reduce((sum, a) => sum + (a.maxBudget || 0), 0);

  // Collaborator Stats
  const overdueCollaboratorsCount = allCollaborators.filter(isCollaboratorOverdue).length;
  const activePartnersCount = allCollaborators.filter(
    (c) => c.cooperationStatus === 'همکاری فعال (VIP)'
  ).length;
  const newPartnersCount = allCollaborators.filter(
    (c) => c.cooperationStatus === 'تازه آشنا / جدید'
  ).length;
  const evaluatingPartnersCount = allCollaborators.filter(
    (c) => c.cooperationStatus === 'در حال ارزیابی'
  ).length;
  const inactivePartnersCount = allCollaborators.filter(
    (c) => c.cooperationStatus === 'غیرفعال / راکد'
  ).length;
  const receivedFilesCount = allProperties.filter(
    (p) => Boolean(p.referrerCollaboratorId || p.contactSource === 'همکار معتمد')
  ).length;

  // Inbox Stats
  const todayOrActiveReminders = allReminders.filter(
    (r) =>
      r.status === 'pending' ||
      compareJalaliDates(r.jalaliDate, todayJalali) === 0
  );
  const callsCount = pendingReminders.filter((r) => r.categories.includes('phone')).length;
  const visitsCount = pendingReminders.filter((r) => r.categories.includes('visit')).length;

  // Sync Status Light derived strictly from real backup & mutation data
  const pendingUnsyncedCount = Math.max(
    0,
    (syncMeta.localVersion || 1) - (syncMeta.lastBackedUpVersion || 1)
  );
  const totalRecordsCount =
    allProperties.length +
    allApplicants.length +
    allCollaborators.length +
    allReminders.length;

  let syncStatusColor: 'green' | 'yellow' | 'red' = 'yellow';
  if (!syncMeta.lastBackupAt) {
    // No backup has ever been made yet
    syncStatusColor = pendingUnsyncedCount > 0 || totalRecordsCount > 0 ? 'red' : 'yellow';
  } else if ((syncMeta.serverLatestVersion || 1) > (syncMeta.lastBackedUpVersion || 1)) {
    syncStatusColor = 'yellow';
  } else if (pendingUnsyncedCount > 0) {
    const hoursSinceBackup =
      (Date.now() - new Date(syncMeta.lastBackupAt).getTime()) / (1000 * 3600);
    syncStatusColor = hoursSinceBackup >= APP_CONFIG.BACKUP_RED_HOURS ? 'red' : 'yellow';
  } else {
    syncStatusColor = 'green';
  }

  return {
    properties: allProperties,
    applicants: allApplicants,
    collaborators: allCollaborators,
    reminders: allReminders,
    matchLinks: allMatches,
    notifications: allNotifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    syncMeta,
    propertyStats: {
      total: allProperties.length,
      active: activeProps.length,
      negotiating: negotiatingProps.length,
      sold: soldProps.length,
      inactive: inactiveProps.length,
      newThisMonth: newThisMonthProps.length,
      needFollowup: dashboardAlerts.length,
      missingCoordinatesCount,
      premiumTop3,
    },
    applicantStats: {
      total: allApplicants.length,
      overdue: overdueApplicantsCount,
      following: followingApplicantsCount,
      newCount: newApplicantsCount,
      visitCount: visitApplicantsCount,
      doneCount: doneApplicantsCount,
      totalDemandToman,
    },
    collaboratorStats: {
      total: allCollaborators.length,
      overdue: overdueCollaboratorsCount,
      activePartners: activePartnersCount,
      newPartners: newPartnersCount,
      evaluatingPartners: evaluatingPartnersCount,
      inactivePartners: inactivePartnersCount,
      receivedFilesCount,
    },
    inboxStats: {
      totalToday: todayOrActiveReminders.length,
      overdueAndUrgent: overdueReminders.length,
      callsAndVisits: callsCount + visitsCount,
      completedCount: completedReminders.length,
      callsCount,
      visitsCount,
    },
    dashboardAlerts,
    unreadNotificationsCount: allNotifications.filter((n) => !n.read).length,
    syncStatusColor,
    pendingUnsyncedCount,
  };
}

// ============================================================================
// DATABASE INITIALIZATION (No seeded demo/sample data — starts 100% empty)
// ============================================================================
const LEGACY_DEMO_IDS = {
  properties: ['prop_f001', 'prop_f002', 'prop_f006', 'prop_f007', 'prop_f011'],
  collaborators: ['col_h001', 'col_h002', 'col_h003'],
  applicants: ['app_c001', 'app_c002'],
  reminders: ['rem_r001', 'rem_r002', 'rem_r003', 'rem_r004', 'rem_r005'],
  notifications: ['notif_init_1', 'notif_init_2', 'notif_init_3'],
  places: [
    'place_kelarabad',
    'place_motelghoo',
    'place_namakabrud',
    'place_noshahr',
    'place_abbasabad',
  ],
};

export async function ensureSeedData() {
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    try {
      await navigator.storage.persist();
    } catch {
      // ignore
    }
  }

  // Purge any previously seeded demo records and fake backup status if present
  if (typeof window !== 'undefined' && localStorage.getItem('kelid_demo_purged_v2') !== '1') {
    await Promise.all([
      db.properties.bulkDelete(LEGACY_DEMO_IDS.properties),
      db.collaborators.bulkDelete(LEGACY_DEMO_IDS.collaborators),
      db.applicants.bulkDelete(LEGACY_DEMO_IDS.applicants),
      db.reminders.bulkDelete(LEGACY_DEMO_IDS.reminders),
      db.notifications.bulkDelete(LEGACY_DEMO_IDS.notifications),
      db.placesDirectory.bulkDelete(LEGACY_DEMO_IDS.places),
    ]);

    // Remove any matchLinks referencing demo entities
    const allLinks = await db.matchLinks.toArray();
    const demoLinkIds = allLinks
      .filter(
        (l) =>
          LEGACY_DEMO_IDS.applicants.includes(l.applicantId) ||
          LEGACY_DEMO_IDS.properties.includes(l.propertyId)
      )
      .map((l) => l.id);
    if (demoLinkIds.length > 0) {
      await db.matchLinks.bulkDelete(demoLinkIds);
    }

    // Reset syncMeta if it was initialized with the fake 18h-ago backup timestamp
    const existingMeta = await db.syncMeta.get('singleton');
    if (existingMeta) {
      const hasFakeMembers = existingMeta.workspaceMembers?.some(
        (m) => m.email === 'manager@kelid.estate' || m.email === 'advisor@kelid.estate'
      );
      if (hasFakeMembers || !existingMeta.lastRefreshAt) {
        await db.syncMeta.put({
          id: 'singleton',
          deviceId: getDeviceId(),
          localVersion: 1,
          lastBackedUpVersion: 1,
          serverLatestVersion: 1,
          lastBackupAt: undefined,
          workspaceMembers: [],
          mergeHistory: [],
        });
      }
    }

    localStorage.setItem('kelid_demo_purged_v2', '1');
  }

  await ensureSyncMeta();
}
