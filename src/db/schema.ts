import Dexie, { type Table } from 'dexie';
import { CreditTier, PropertyStatus, UserRole } from '../config';

export interface BaseEntity {
  id: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deviceId: string;
  deleted: boolean;
}

export interface PropertyPhotoItem {
  mediaId: string;
  label: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  fallbackUrl?: string;
}

export interface PropertyDocumentItem {
  mediaId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  status: 'uploading' | 'processing' | 'ready';
  extractedText?: string;
  isConfidential: boolean;
  attachToContract: boolean;
}

export interface PropertyRecord extends BaseEntity {
  title: string;
  propertyType: 'زمین' | 'ویلا' | 'آپارتمان' | 'باغ' | 'تجاری';
  status: PropertyStatus;
  registerDate: string;
  city: string;
  district: string;
  deedType: string;
  deedCustom?: string;
  zoningStatus: string;
  zoningCustom?: string;

  area: number;
  pricePerMeter: number;
  totalPrice: number;
  negotiable: boolean;

  // Extended 10 Sections
  province?: string;
  accessPath?: string;
  lotLabel?: string;

  length?: number;
  width?: number;
  lotShape?: string;

  frontageCount?: string;
  passageWidth?: number;

  orientation?: string;

  landUsage?: string;
  structureStatus?: string;
  zoningAuth?: string[];
  fencingDesc?: string;

  zoningDensity?: string;
  maxLotCoverage?: string;
  densityFloors?: string;
  permitStageType?: string;

  utilLocation?: string;
  utilities?: {
    water: boolean;
    power: boolean;
    gas: boolean;
    phone: boolean;
    fiber: boolean;
  };
  utilDesc?: string;

  inquiryStatus?: string;
  permitNo?: string;
  substructureArea?: number;
  permitIssueDate?: string;
  permitExpiryDate?: string;
  dismissPermitWarning?: boolean;

  commissionRate?: string;
  paymentMethod?: string;
  paymentTerms?: string;

  referrerCollaboratorId?: string;
  contactPartnerName?: string;
  contactSource?: string;
  lastContactDate?: string;
  nextFollowupDate?: string;

  internalNotes?: string; // Confidential (Manager only)

  // Type-specific fields
  builtArea?: number;
  roomsCount?: number;
  buildingAge?: number;
  villaFloors?: string;
  villaAmenities?: string[];

  floorNumber?: number;
  totalFloors?: number;
  unitsPerFloor?: number;
  hasParking?: boolean;
  hasStorage?: boolean;
  hasElevator?: boolean;
  aptDirection?: string;

  commercialFrontage?: number;
  ceilingHeight?: number;
  commercialUsage?: string;
  hasBusinessLicense?: boolean;

  // Location & Voice
  lat?: number;
  lng?: number;
  locationSourceUrl?: string;
  exactAddress?: string;
  voiceNoteMediaId?: string;
  voiceTranscript?: string;

  // Media & Docs
  photos: PropertyPhotoItem[];
  documents: PropertyDocumentItem[];

  // Confidential Owner Info
  ownerName: string;
  ownerPhone: string;
}

export interface ApplicantRecord extends BaseEntity {
  name: string;
  phone: string;
  priority: 'vip' | 'cash' | 'urgent' | 'normal';
  gender: 'male' | 'female';
  creditTier: CreditTier | 'neutral';
  status: 'جدید' | 'در حال پیگیری' | 'بازدید' | 'معامله‌شده';

  referrerId: string; // Collaborator ID or channel code
  referrerLabel: string;
  collaboratorRating?: number; // 1-5 stars if referrer is a collaborator
  confidentialNotes?: string; // Confidential (Manager only)

  dealTypes: string[];
  desiredPropertyTypes: string[];

  cities: string[];
  neighborhoods: string[];
  placementTypes: string[];

  minArea: number;
  maxArea: number;
  minBudget: number;
  maxBudget: number;
  cashPercentage: number;
  allowBarter: boolean;
  barterDescription?: string;
  settlementTimeline?: string;

  desiredDeeds: string[];
  desiredZonings: string[];

  lastContactDate?: string;
  nextFollowupDate?: string;
}

export interface CollaboratorRecord extends BaseEntity {
  name: string;
  phone: string;
  agencyName?: string;
  role: 'مدیر آژانس' | 'سرپرست رنج' | 'مشاور مستقل' | 'سرمایه‌گذار سازنده';
  gender: 'male' | 'female';
  performanceTier: CreditTier | 'neutral';

  primaryCity: string;
  neighborhoods: string[];
  specializations: string[];
  masteryBadges: string[]; // 'داخل بافت' | 'تک‌برگ عرصه' | 'جنگل جلگه‌ای' | 'هکتاری'

  commissionSplit: '50_50' | 'bonus';
  commissionNotes?: string;

  cooperationStatus: 'همکاری فعال (VIP)' | 'تازه آشنا / جدید' | 'در حال ارزیابی' | 'غیرفعال / راکد';
  nextFollowupDate?: string;
  lastContactDate?: string;
  lastContactResult?: 'موفق' | 'بی‌پاسخ' | 'نیاز به تماس مجدد';
  privateNotes?: string; // Confidential (Manager only)
  successfulDealsCount: number;
}

export type ReminderCategory =
  | 'phone'
  | 'inquiry'
  | 'visit'
  | 'finance'
  | 'documents'
  | 'meeting';

export interface ReminderRecord extends BaseEntity {
  title: string;
  transcript: string;
  audioMediaId?: string;
  audioDurationSec?: number;

  jalaliDate: string;
  weekday?: string;
  dateReason?: string;
  time: string;
  timeDisplay: string;
  timeReason?: string;
  timeNeedsConfirmation?: boolean;

  linkedPropertyId?: string;
  linkedApplicantId?: string;
  linkedCollaboratorId?: string;
  customLinks: string[];

  categories: ReminderCategory[];
  priority: 'urgent' | 'normal' | 'low';
  priorityReason?: string;

  smsNotification: boolean;
  registerInCartable: boolean;
  syncWithPhoneCalendar?: boolean;

  status: 'pending' | 'done';
  callResult?: 'موفق' | 'بی‌پاسخ' | 'نیاز به تماس مجدد';
  completedAt?: string;

  calendarStatus: 'added' | 'denied' | 'ics_exported' | 'failed' | 'none';
  calendarEventId?: string;
  syncStatus: 'local' | 'uploaded';

  aiFilledFields: string[];
  aiSummary?: string;
}

export interface MatchLinkRecord {
  id: string; // `${applicantId}_${propertyId}`
  applicantId: string;
  propertyId: string;
  score: number;
  dismissed: boolean;
  updatedAt: string;
}

export interface PlaceDirectoryRecord {
  id: string;
  city: string;
  neighborhoods: string[];
  usageCount: number;
  updatedAt: string;
}

export interface MediaBlobRecord {
  id: string;
  hash: string;
  mimeType: string;
  blob: Blob;
  fileName: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  title: string;
  body: string;
  type: 'reminder' | 'match' | 'sync' | 'workspace';
  jalaliDate: string;
  createdAt: string;
  read: boolean;
  dismissed: boolean;
  targetRoute: string;
}

export interface WorkspaceMember {
  email: string;
  name: string;
  role: UserRole;
  addedAt: string;
}

export interface SyncMetaRecord {
  id: string; // 'singleton'
  deviceId: string;
  lastBackupAt?: string;
  lastRefreshAt?: string;
  lastLocalMutationAt?: string;
  localVersion: number;
  lastBackedUpVersion: number;
  serverLatestVersion: number;
  driveRootFolderId?: string;
  driveSnapshotsFolderId?: string;
  driveMediaFolderId?: string;
  driveConfidentialFolderId?: string;
  workspaceMembers: WorkspaceMember[];
  mergeHistory: Array<{
    recordId: string;
    entityType: string;
    archivedAt: string;
    previousData: any;
  }>;
}

export class KelidDatabase extends Dexie {
  properties!: Table<PropertyRecord, string>;
  applicants!: Table<ApplicantRecord, string>;
  collaborators!: Table<CollaboratorRecord, string>;
  reminders!: Table<ReminderRecord, string>;
  matchLinks!: Table<MatchLinkRecord, string>;
  placesDirectory!: Table<PlaceDirectoryRecord, string>;
  mediaBlobs!: Table<MediaBlobRecord, string>;
  notifications!: Table<NotificationRecord, string>;
  syncMeta!: Table<SyncMetaRecord, string>;

  constructor() {
    super('KelidRealEstateCRM');
    this.version(1).stores({
      properties: 'id, code, status, propertyType, city, totalPrice, area, referrerCollaboratorId, updatedAt, deleted',
      applicants: 'id, code, status, priority, referrerId, maxBudget, updatedAt, deleted',
      collaborators: 'id, code, cooperationStatus, primaryCity, phone, updatedAt, deleted',
      reminders: 'id, code, status, priority, jalaliDate, linkedPropertyId, linkedApplicantId, linkedCollaboratorId, updatedAt, deleted',
      matchLinks: 'id, applicantId, propertyId, score, dismissed',
      placesDirectory: 'id, &city, usageCount',
      mediaBlobs: 'id, hash, mimeType, createdAt',
      notifications: 'id, type, jalaliDate, read, dismissed, createdAt',
      syncMeta: 'id',
    });
  }
}

export const db = new KelidDatabase();
