import {
  ApplicantRecord,
  CollaboratorRecord,
  PropertyRecord,
  ReminderRecord,
} from '../db/schema';
import { normalizePersianText } from '../utils/persian';
import { localParseNaturalSearch } from './ai';

export interface SearchHit<T> {
  item: T;
  matchedFields: string[];
  matchedTextSnippet?: string;
}

function checkMultiWordFields(
  queryWords: string[],
  fields: Array<{ label: string; value: string | number | undefined | null }>
): string[] {
  if (queryWords.length === 0) return [];
  const normalizedFields = fields
    .map((f) => ({
      label: f.label,
      norm: normalizePersianText(String(f.value ?? '')),
    }))
    .filter((f) => f.norm.length > 0);

  const matchedLabels = new Set<string>();

  for (const word of queryWords) {
    let wordFoundInAnyField = false;
    for (const nf of normalizedFields) {
      if (nf.norm.includes(word)) {
        wordFoundInAnyField = true;
        matchedLabels.add(nf.label);
      }
    }
    if (!wordFoundInAnyField) {
      return []; // Every word must match somewhere
    }
  }

  return Array.from(matchedLabels);
}

export function searchPropertiesSmart(
  properties: PropertyRecord[],
  query: string
): Array<SearchHit<PropertyRecord>> {
  const trimmed = query.trim();
  if (!trimmed) {
    return properties.map((item) => ({ item, matchedFields: [] }));
  }

  const parsed = localParseNaturalSearch(trimmed);
  const normQuery = normalizePersianText(trimmed);
  const words = (parsed.keywords.length > 0 ? parsed.keywords : normQuery.split(/\s+/)).map(
    normalizePersianText
  ).filter(Boolean);

  const results: Array<SearchHit<PropertyRecord>> = [];

  for (const prop of properties) {
    const matchedFields: string[] = [];

    // Check natural language numeric filters if present
    if (parsed.propertyType && prop.propertyType !== parsed.propertyType) continue;
    if (parsed.city && !normalizePersianText(prop.city).includes(normalizePersianText(parsed.city))) {
      continue;
    }
    if (parsed.minArea && prop.area < parsed.minArea) continue;
    if (parsed.maxArea && prop.area > parsed.maxArea) continue;
    if (parsed.maxPrice && prop.totalPrice > parsed.maxPrice) continue;

    if (parsed.propertyType) matchedFields.push(`کاربری: ${prop.propertyType}`);
    if (parsed.minArea || parsed.maxArea) matchedFields.push(`متراژ: ${prop.area} متر`);
    if (parsed.maxPrice) matchedFields.push('بازه بودجه');

    const fieldChecks = [
      { label: 'کد فایل', value: prop.code },
      { label: 'عنوان ملک', value: prop.title },
      { label: 'شهر', value: prop.city },
      { label: 'محله', value: prop.district },
      { label: 'نوع سند', value: `${prop.deedType} ${prop.deedCustom || ''}` },
      { label: 'وضعیت بافت', value: `${prop.zoningStatus} ${prop.zoningCustom || ''}` },
      { label: 'نام مالک', value: prop.ownerName },
      { label: 'تلفن مالک', value: prop.ownerPhone },
      { label: 'معرف/همکار', value: prop.contactPartnerName },
      { label: 'آدرس و رونوشت صوتی', value: `${prop.exactAddress || ''} ${prop.voiceTranscript || ''}` },
      { label: 'یادداشت پرونده', value: prop.internalNotes },
    ];

    const wordMatches = checkMultiWordFields(words, fieldChecks);
    if (words.length > 0 && wordMatches.length === 0) {
      continue;
    }

    results.push({
      item: prop,
      matchedFields: Array.from(new Set([...matchedFields, ...wordMatches])),
    });
  }

  return results;
}

export function searchApplicantsSmart(
  applicants: ApplicantRecord[],
  query: string
): Array<SearchHit<ApplicantRecord>> {
  const trimmed = query.trim();
  if (!trimmed) {
    return applicants.map((item) => ({ item, matchedFields: [] }));
  }
  const words = normalizePersianText(trimmed).split(/\s+/).filter(Boolean);
  const results: Array<SearchHit<ApplicantRecord>> = [];

  for (const app of applicants) {
    const fieldChecks = [
      { label: 'کد متقاضی', value: app.code },
      { label: 'نام متقاضی', value: app.name },
      { label: 'شماره تماس', value: app.phone },
      { label: 'معرف', value: app.referrerLabel },
      { label: 'شهر هدف', value: (app.cities || []).join(' ') },
      { label: 'محله ترجیحی', value: (app.neighborhoods || []).join(' ') },
      { label: 'نوع معامله', value: (app.dealTypes || []).join(' ') },
      { label: 'یادداشت', value: app.confidentialNotes },
    ];

    const matchedFields = checkMultiWordFields(words, fieldChecks);
    if (matchedFields.length > 0) {
      results.push({ item: app, matchedFields });
    }
  }

  return results;
}

export function searchCollaboratorsSmart(
  collaborators: CollaboratorRecord[],
  properties: PropertyRecord[],
  query: string
): Array<SearchHit<CollaboratorRecord>> {
  const trimmed = query.trim();
  if (!trimmed) {
    return collaborators.map((item) => ({ item, matchedFields: [] }));
  }
  const words = normalizePersianText(trimmed).split(/\s+/).filter(Boolean);
  const results: Array<SearchHit<CollaboratorRecord>> = [];

  for (const col of collaborators) {
    const linkedProps = properties.filter((p) => p.referrerCollaboratorId === col.id);
    const linkedCodes = linkedProps.map((p) => `${p.code} ${p.title}`).join(' ');

    const fieldChecks = [
      { label: 'کد همکار', value: col.code },
      { label: 'نام همکار', value: col.name },
      { label: 'شماره تماس', value: col.phone },
      { label: 'دفتر املاک', value: col.agencyName },
      { label: 'شهر', value: col.primaryCity },
      { label: 'محدوده فعالیت', value: (col.neighborhoods || []).join(' ') },
      { label: 'تخصص', value: (col.specializations || []).join(' ') },
      { label: 'شرایط کمیسیون', value: col.commissionNotes },
      { label: 'فایل‌های مرتبط', value: linkedCodes },
      { label: 'یادداشت', value: col.privateNotes },
    ];

    const matchedFields = checkMultiWordFields(words, fieldChecks);
    if (matchedFields.length > 0) {
      results.push({ item: col, matchedFields });
    }
  }

  return results;
}

export function searchRemindersSmart(
  reminders: ReminderRecord[],
  properties: PropertyRecord[],
  applicants: ApplicantRecord[],
  collaborators: CollaboratorRecord[],
  query: string
): Array<SearchHit<ReminderRecord>> {
  const trimmed = query.trim();
  if (!trimmed) {
    return reminders.map((item) => ({ item, matchedFields: [] }));
  }
  const words = normalizePersianText(trimmed).split(/\s+/).filter(Boolean);
  const results: Array<SearchHit<ReminderRecord>> = [];

  for (const rem of reminders) {
    const prop = properties.find((p) => p.id === rem.linkedPropertyId);
    const app = applicants.find((a) => a.id === rem.linkedApplicantId);
    const col = collaborators.find((c) => c.id === rem.linkedCollaboratorId);

    const fieldChecks = [
      { label: 'کد یادآور', value: rem.code },
      { label: 'عنوان اقدام', value: rem.title },
      { label: 'متن یادداشت صوتی', value: rem.transcript },
      { label: 'ملک مرتبط', value: prop ? `${prop.code} ${prop.title} ${prop.ownerPhone}` : '' },
      { label: 'متقاضی مرتبط', value: app ? `${app.code} ${app.name} ${app.phone}` : '' },
      { label: 'همکار مرتبط', value: col ? `${col.code} ${col.name} ${col.phone}` : '' },
    ];

    const matchedFields = checkMultiWordFields(words, fieldChecks);
    if (matchedFields.length > 0) {
      results.push({ item: rem, matchedFields });
    }
  }

  return results;
}
