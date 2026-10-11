import { APP_CONFIG } from '../config';
import {
  ApplicantRecord,
  db,
  MatchLinkRecord,
  PropertyRecord,
} from '../db/schema';
import { getTodayJalali, normalizePersianText, toPersianDigits } from '../utils/persian';

export interface ScoredMatch {
  applicant: ApplicantRecord;
  property: PropertyRecord;
  score: number;
  reasons: string[];
}

export function calculateMatchScore(
  applicant: Partial<ApplicantRecord>,
  property: PropertyRecord
): { score: number; reasons: string[] } {
  if (property.deleted || property.status === 'فروخته‌شده' || property.status === 'غیرفعال') {
    return { score: 0, reasons: [] };
  }

  let totalWeight = 0;
  let earnedWeight = 0;
  const reasons: string[] = [];

  // 1. City / Location Match (Weight: 30)
  totalWeight += 30;
  const propCityNorm = normalizePersianText(property.city);
  const propDistNorm = normalizePersianText(property.district);
  const appCities = (applicant.cities || []).map(normalizePersianText).filter(Boolean);
  const appHoods = (applicant.neighborhoods || []).map(normalizePersianText).filter(Boolean);

  if (appCities.length === 0) {
    earnedWeight += 22;
  } else {
    const cityMatched = appCities.some(
      (c) => c.includes(propCityNorm) || propCityNorm.includes(c)
    );
    if (cityMatched) {
      earnedWeight += 25;
      reasons.push(`منطقه ${property.city}`);
      if (
        appHoods.length === 0 ||
        appHoods.some((h) => h.includes(propDistNorm) || propDistNorm.includes(h))
      ) {
        earnedWeight += 5;
        if (property.district) reasons.push(`محله ${property.district}`);
      }
    }
  }

  // 2. Budget Match (Weight: 30)
  totalWeight += 30;
  const minB = applicant.minBudget || 0;
  const maxB = applicant.maxBudget || 0;
  const pPrice = property.totalPrice || 0;
  if (maxB > 0 && pPrice > 0) {
    if (pPrice >= minB * 0.85 && pPrice <= maxB * 1.05) {
      earnedWeight += 30;
      reasons.push('منطبق با بودجه');
    } else if (pPrice <= maxB * 1.18) {
      earnedWeight += 20;
      reasons.push('نزدیک به سقف بودجه');
    } else if (pPrice < minB * 0.85) {
      earnedWeight += 18;
    }
  } else {
    earnedWeight += 20;
  }

  // 3. Area Match (Weight: 20)
  totalWeight += 20;
  const minA = applicant.minArea || 0;
  const maxA = applicant.maxArea || 0;
  const pArea = property.area || 0;
  if ((minA > 0 || maxA > 0) && pArea > 0) {
    const low = minA > 0 ? minA : 0;
    const high = maxA > 0 ? maxA : Infinity;
    if (pArea >= low * 0.9 && pArea <= high * 1.1) {
      earnedWeight += 20;
      reasons.push(`متراژ ${toPersianDigits(pArea)} متر`);
    } else if (pArea >= low * 0.75 && pArea <= high * 1.25) {
      earnedWeight += 13;
    }
  } else {
    earnedWeight += 15;
  }

  // 4. Deed & Zoning Match (Weight: 20)
  totalWeight += 20;
  const propDeedNorm = normalizePersianText(`${property.deedType} ${property.deedCustom || ''}`);
  const propZoneNorm = normalizePersianText(`${property.zoningStatus} ${property.zoningCustom || ''}`);
  const appDeeds = (applicant.desiredDeeds || []).map(normalizePersianText);
  const appZones = (applicant.desiredZonings || []).map(normalizePersianText);

  let legalPoints = 0;
  if (appDeeds.length === 0) {
    legalPoints += 10;
  } else if (
    appDeeds.some(
      (d) =>
        (d.includes('تک برگ') && propDeedNorm.includes('تک برگ')) ||
        (d.includes('شورا') && propDeedNorm.includes('شورا')) ||
        (d.includes('مشاع') && propDeedNorm.includes('مشاع')) ||
        (d.includes('بنچاق') && propDeedNorm.includes('بنچاق')) ||
        propDeedNorm.includes(d)
    )
  ) {
    legalPoints += 10;
    reasons.push(property.deedType);
  } else if (propDeedNorm.includes('تک برگ')) {
    legalPoints += 8;
  }

  if (appZones.length === 0) {
    legalPoints += 10;
  } else if (
    appZones.some(
      (z) =>
        (z.includes('مسکونی') && propZoneNorm.includes('مسکونی')) ||
        (z.includes('بافت') && propZoneNorm.includes('داخل بافت')) ||
        (z.includes('توریستی') && propZoneNorm.includes('توریستی')) ||
        (z.includes('الحاق') && propZoneNorm.includes('الحاق'))
    )
  ) {
    legalPoints += 10;
    reasons.push(property.zoningStatus);
  } else if (propZoneNorm.includes('داخل بافت')) {
    legalPoints += 8;
  }

  earnedWeight += legalPoints;

  const rawScore = Math.round((earnedWeight / totalWeight) * 100);
  const clampedScore = Math.max(0, Math.min(100, rawScore));
  return { score: clampedScore, reasons };
}

export async function runMatchingEngine(notifyNewMatches = true): Promise<MatchLinkRecord[]> {
  const [applicants, properties, existingLinks] = await Promise.all([
    db.applicants.filter((a) => !a.deleted).toArray(),
    db.properties.filter((p) => !p.deleted && (p.status === 'فعال' || p.status === 'در مذاکره')).toArray(),
    db.matchLinks.toArray(),
  ]);

  const existingMap = new Map<string, MatchLinkRecord>();
  existingLinks.forEach((l) => existingMap.set(l.id, l));

  const newLinks: MatchLinkRecord[] = [];
  const nowIso = new Date().toISOString();
  const todayJalali = getTodayJalali(true);

  for (const app of applicants) {
    for (const prop of properties) {
      const { score } = calculateMatchScore(app, prop);
      const id = `${app.id}_${prop.id}`;
      const prev = existingMap.get(id);

      if (score >= APP_CONFIG.MATCH_THRESHOLD) {
        const record: MatchLinkRecord = {
          id,
          applicantId: app.id,
          propertyId: prop.id,
          score,
          dismissed: prev ? prev.dismissed : false,
          updatedAt: nowIso,
        };
        newLinks.push(record);

        if (!prev && notifyNewMatches) {
          await db.notifications.put({
            id: `notif_match_${id}_${Date.now()}`,
            title: `تطبیق هوشمند ${toPersianDigits(score)}٪: ${app.name} و ${prop.code}`,
            body: `ملک «${prop.title}» (${prop.code}) با شرایط درخواستی متقاضی ${app.name} (${app.code}) مطابقت دارد.`,
            type: 'match',
            jalaliDate: todayJalali,
            createdAt: nowIso,
            read: false,
            dismissed: false,
            targetRoute: `/properties/${prop.id}`,
          });
        }
      } else if (prev) {
        await db.matchLinks.delete(id);
      }
    }
  }

  if (newLinks.length > 0) {
    await db.matchLinks.bulkPut(newLinks);
  }

  return newLinks;
}
