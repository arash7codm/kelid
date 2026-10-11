import { ReminderRecord } from '../db/schema';
import { jalaliToDateObject, toPersianDigits } from '../utils/persian';
import { getAccessToken } from './auth';

function toIcsUtcString(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function toIcsLocalTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(
    d.getMinutes()
  )}00`;
}

export interface CalendarEventMetadata {
  propertyLabel?: string;
  contactLabel?: string;
  actionLabels?: string[];
}

export function buildCalendarDescription(
  reminder: ReminderRecord,
  meta?: CalendarEventMetadata
): string {
  const lines: string[] = [];
  if (reminder.aiSummary) {
    lines.push(`خلاصه اقدام: ${reminder.aiSummary}`);
  }
  if (meta?.propertyLabel) {
    lines.push(`پرونده ملکی: ${meta.propertyLabel}`);
  }
  if (meta?.contactLabel) {
    lines.push(`مخاطب مرتبط: ${meta.contactLabel}`);
  }
  if (meta?.actionLabels && meta.actionLabels.length > 0) {
    lines.push(`دسته‌بندی اقدام: ${meta.actionLabels.join('، ')}`);
  }
  const priorityLabel =
    reminder.priority === 'urgent'
      ? 'فوری و بحرانی'
      : reminder.priority === 'low'
      ? 'کم‌اهمیت'
      : 'عادی';
  lines.push(`اولویت: ${priorityLabel}`);
  if (reminder.transcript) {
    lines.push(`متن یادداشت صوتی: «${reminder.transcript}»`);
  }
  lines.push('ثبت‌شده در سامانه مدیریت املاک کلید');
  return lines.join('\n');
}

/**
 * Generates and downloads a standard .ics calendar event with Asia/Tehran timezone
 * and multiple VALARM blocks (extra alarms for urgent/critical reminders).
 */
export function exportReminderAsIcs(
  reminder: ReminderRecord,
  meta?: CalendarEventMetadata
): void {
  const startDate =
    jalaliToDateObject(reminder.jalaliDate, reminder.time) || new Date(Date.now() + 3600000);
  const endDate = new Date(startDate.getTime() + 45 * 60 * 1000); // 45 mins

  const descriptionText = buildCalendarDescription(reminder, meta).replace(/\n/g, '\\n');
  const summaryText = `کلید: ${reminder.title}`;

  const alarmBlocks: string[] = [
    // Alarm at exact event time
    'BEGIN:VALARM',
    'TRIGGER:PT0S',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summaryText}`,
    'END:VALARM',
    // Alarm 10 minutes before
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    `DESCRIPTION:۱۰ دقیقه تا موعد: ${summaryText}`,
    'END:VALARM',
  ];

  // Extra 30-minute advance alarm + audio trigger for urgent/critical tasks
  if (reminder.priority === 'urgent') {
    alarmBlocks.push(
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      `DESCRIPTION:[فوری و بحرانی] ۳۰ دقیقه تا موعد: ${summaryText}`,
      'END:VALARM'
    );
  }

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kelid Luxury Real Estate CRM//FA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tehran',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0330',
    'TZOFFSETTO:+0330',
    'TZNAME:+0330',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${reminder.id}@kelid.estate`,
    `DTSTAMP:${toIcsUtcString(new Date())}`,
    `DTSTART;TZID=Asia/Tehran:${toIcsLocalTimeString(startDate)}`,
    `DTEND;TZID=Asia/Tehran:${toIcsLocalTimeString(endDate)}`,
    `SUMMARY:${summaryText}`,
    `DESCRIPTION:${descriptionText}`,
    `PRIORITY:${reminder.priority === 'urgent' ? '1' : reminder.priority === 'normal' ? '5' : '9'}`,
    'STATUS:CONFIRMED',
    ...alarmBlocks,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kelid-reminder-${reminder.code || 'event'}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates a direct Google Calendar Web Template URL so the user can add the event
 * to Google Calendar with one tap even without OAuth token.
 */
export function getGoogleCalendarTemplateUrl(
  reminder: ReminderRecord,
  meta?: CalendarEventMetadata
): string {
  const startDate =
    jalaliToDateObject(reminder.jalaliDate, reminder.time) || new Date(Date.now() + 3600000);
  const endDate = new Date(startDate.getTime() + 45 * 60 * 1000);

  const datesParam = `${toIcsUtcString(startDate)}/${toIcsUtcString(endDate)}`;
  const title = `کلید (${reminder.code}): ${reminder.title}`;
  const details = buildCalendarDescription(reminder, meta);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: datesParam,
    details,
    ctz: 'Asia/Tehran',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function createOrUpdateGoogleCalendarEvent(
  reminder: ReminderRecord,
  meta?: CalendarEventMetadata
): Promise<{ status: 'added' | 'ics_exported' | 'failed'; eventId?: string }> {
  const token = getAccessToken();
  const startDate =
    jalaliToDateObject(reminder.jalaliDate, reminder.time) || new Date(Date.now() + 3600000);
  const endDate = new Date(startDate.getTime() + 45 * 60 * 1000);
  const timeZone = 'Asia/Tehran';

  if (!token || !navigator.onLine) {
    exportReminderAsIcs(reminder, meta);
    return { status: 'ics_exported' };
  }

  try {
    const overrides =
      reminder.priority === 'urgent'
        ? [
            { method: 'popup', minutes: 30 },
            { method: 'popup', minutes: 10 },
            { method: 'popup', minutes: 0 },
          ]
        : [
            { method: 'popup', minutes: 10 },
            { method: 'popup', minutes: 0 },
          ];

    const body = {
      summary: `کلید (${reminder.code}): ${reminder.title}`,
      description: buildCalendarDescription(reminder, meta),
      start: {
        dateTime: startDate.toISOString(),
        timeZone,
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone,
      },
      reminders: {
        useDefault: false,
        overrides,
      },
    };

    const url = reminder.calendarEventId
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${reminder.calendarEventId}`
      : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

    const method = reminder.calendarEventId ? 'PUT' : 'POST';
    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      exportReminderAsIcs(reminder, meta);
      return { status: 'ics_exported' };
    }
    const data = await resp.json();
    return { status: 'added', eventId: data.id };
  } catch {
    exportReminderAsIcs(reminder, meta);
    return { status: 'ics_exported' };
  }
}

export async function deleteGoogleCalendarEvent(calendarEventId?: string): Promise<void> {
  const token = getAccessToken();
  if (!token || !calendarEventId || !navigator.onLine) return;
  try {
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${calendarEventId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  } catch {
    // ignore
  }
}

const activeNotificationTimers = new Map<string, number>();

/**
 * Schedules a real browser/ServiceWorker notification while the PWA/tab is open,
 * and sends an immediate confirmation notification if requested.
 */
export async function scheduleInAppReminderNotification(
  reminder: ReminderRecord,
  meta?: CalendarEventMetadata
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return false;
    }
  }
  if (permission !== 'granted') {
    return false;
  }

  // Clear previous timer for this reminder if any
  const prevTimer = activeNotificationTimers.get(reminder.id);
  if (prevTimer) {
    window.clearTimeout(prevTimer);
    activeNotificationTimers.delete(reminder.id);
  }

  const targetDate = jalaliToDateObject(reminder.jalaliDate, reminder.time);
  if (!targetDate) return true;

  const delayMs = targetDate.getTime() - Date.now();
  // Schedule if due within the next 24 hours while app is open
  if (delayMs > 0 && delayMs <= 24 * 3600 * 1000) {
    const timerId = window.setTimeout(async () => {
      activeNotificationTimers.delete(reminder.id);
      const title = `🔔 یادآور کلید: ${reminder.title}`;
      const body = `${meta?.propertyLabel ? `${meta.propertyLabel} • ` : ''}${
        meta?.contactLabel ? `${meta.contactLabel} • ` : ''
      }ساعت ${toPersianDigits(reminder.time)}`;

      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.showNotification) {
            await reg.showNotification(title, {
              body,
              icon: './icon-192x192.png',
              badge: './icon-96x96.png',
              tag: `kelid-rem-${reminder.id}`,
              dir: 'rtl',
              lang: 'fa',
            });
            return;
          }
        }
        new Notification(title, {
          body,
          icon: './icon-192x192.png',
          dir: 'rtl',
          lang: 'fa',
        });
      } catch {
        // ignore notification error
      }
    }, delayMs);

    activeNotificationTimers.set(reminder.id, timerId);
  }

  return true;
}
