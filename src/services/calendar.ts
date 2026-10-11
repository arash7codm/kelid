import { ReminderRecord } from '../db/schema';
import { jalaliToDateObject } from '../utils/persian';
import { getAccessToken } from './auth';

function toIcsUtcString(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

export function exportReminderAsIcs(reminder: ReminderRecord): void {
  const startDate = jalaliToDateObject(reminder.jalaliDate, reminder.time) || new Date(Date.now() + 3600000);
  const endDate = new Date(startDate.getTime() + 45 * 60 * 1000); // 45 mins

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kelid Luxury Real Estate CRM//FA',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${reminder.id}@kelid.estate`,
    `DTSTAMP:${toIcsUtcString(new Date())}`,
    `DTSTART:${toIcsUtcString(startDate)}`,
    `DTEND:${toIcsUtcString(endDate)}`,
    `SUMMARY:کلید: ${reminder.title}`,
    `DESCRIPTION:${(reminder.transcript || '').replace(/\n/g, '\\n')}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:یادآوری سامانه املاک کلید',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kelid-reminder-${reminder.code}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function createOrUpdateGoogleCalendarEvent(
  reminder: ReminderRecord
): Promise<{ status: 'added' | 'ics_exported' | 'failed'; eventId?: string }> {
  const token = getAccessToken();
  const startDate = jalaliToDateObject(reminder.jalaliDate, reminder.time) || new Date(Date.now() + 3600000);
  const endDate = new Date(startDate.getTime() + 45 * 60 * 1000);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tehran';

  if (!token || !navigator.onLine) {
    exportReminderAsIcs(reminder);
    return { status: 'ics_exported' };
  }

  try {
    const body = {
      summary: `کلید (${reminder.code}): ${reminder.title}`,
      description: `${reminder.transcript || ''}\n\nثبت‌شده در سامانه هوشمند املاک کلید`,
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
        overrides: [
          { method: 'popup', minutes: 15 },
          { method: 'popup', minutes: 0 },
        ],
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
      exportReminderAsIcs(reminder);
      return { status: 'ics_exported' };
    }
    const data = await resp.json();
    return { status: 'added', eventId: data.id };
  } catch {
    exportReminderAsIcs(reminder);
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
