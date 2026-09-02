import ical, { type DateWithTimeZone, type ParameterValue, type VEvent } from "node-ical";
import { addCalendarDays, toLocalDateString, toLocalTimeString } from "@/lib/datetime";
import type { IncomingTask, ParsedCalendar } from "@/lib/icalPlan";

export type { IncomingTask, ParsedCalendar } from "@/lib/icalPlan";

function text(value: ParameterValue | undefined): string {
  if (!value) return "";
  return (typeof value === "string" ? value : value.val).trim();
}

function normalizeCourseCode(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/^([A-Za-z]{2,4})\s*(\d{3}[A-Za-z]?)$/i, "$1 $2").toUpperCase();
}

function calendarDate(value: DateWithTimeZone | Date, dateOnly = false): string {
  if (dateOnly || ("dateOnly" in value && Boolean(value.dateOnly))) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return toLocalDateString(value);
}

export function extractCourseAndTitle(summary: string): { title: string; courseCode: string | null } {
  const original = summary.trim();
  const bracket = original.match(/\s*\[([^\]]+)\]\s*$/);
  if (bracket) {
    const token = bracket[1].match(/\b([A-Z]{2,4}\s?\d{3}[A-Z]?)\b/i)?.[1] ?? bracket[1].trim();
    const stripped = original.slice(0, bracket.index).trim();
    return { title: stripped || original, courseCode: normalizeCourseCode(token) };
  }
  const prefix = original.match(/^([A-Z]{2,4}\s?\d{3}[A-Z]?)\s*[-–—:]\s*/i);
  if (prefix) {
    const stripped = original.slice(prefix[0].length).trim();
    return { title: stripped || original, courseCode: normalizeCourseCode(prefix[1]) };
  }
  return { title: original, courseCode: null };
}

function toIncoming(event: VEvent, uid: string, start: DateWithTimeZone | undefined, end: DateWithTimeZone | undefined, recurringTimed: boolean): IncomingTask {
  const summary = text(event.summary);
  const { title, courseCode } = extractCourseAndTitle(summary);
  const isAllDay = Boolean(start?.dateOnly || event.datetype === "date");
  const dueDate = start ? calendarDate(start, isAllDay) : null;
  return {
    canvas_uid: uid,
    title,
    description: text(event.description) || null,
    due_date: dueDate,
    due_time: start && !isAllDay ? toLocalTimeString(start) : null,
    location: text(event.location) || null,
    category: "classes",
    course_code: courseCode,
    is_pinned: false,
    is_completed: false,
    source: "ical",
    kind: recurringTimed ? "event" : "task",
    end_time: recurringTimed && end ? toLocalTimeString(end) : null,
    series_id: null,
    recurrence_rule: event.rrule?.toString() ?? null,
    series_until: null,
    import_batch_id: null,
  };
}

function recurrenceOverride(event: VEvent, occurrence: Date): Omit<VEvent, "recurrences"> | undefined {
  const dateKey = calendarDate(occurrence, Boolean(event.start?.dateOnly || event.datetype === "date"));
  return event.recurrences?.[occurrence.toISOString()] ?? event.recurrences?.[dateKey];
}

export async function parseCalendar(textBody: string, now = new Date()): Promise<ParsedCalendar> {
  const parsed = await ical.async.parseICS(textBody);
  const items: IncomingTask[] = [];
  const skipped = { noUid: 0, noSummary: 0, cancelled: 0 };
  let expandedRecurrences = 0;
  let truncated = false;
  const lower = new Date(now.getTime() - 30 * 86400000);
  const upper = new Date(now.getTime() + 180 * 86400000);

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT") continue;
    const event = component as VEvent;
    if (!event.uid?.trim()) { skipped.noUid += 1; continue; }
    if (!text(event.summary)) { skipped.noSummary += 1; continue; }
    if (event.status === "CANCELLED") { skipped.cancelled += 1; continue; }
    if (!event.rrule) {
      items.push(toIncoming(event, event.uid, event.start, event.end, false));
      continue;
    }
    const duration = event.start && event.end ? event.end.getTime() - event.start.getTime() : null;
    const allDayRecurrence = Boolean(event.start?.dateOnly || event.datetype === "date");
    const excluded = new Set(Object.values(event.exdate ?? {}).map((date) => calendarDate(date as DateWithTimeZone, allDayRecurrence)));
    for (const occurrence of event.rrule.between(lower, upper, true)) {
      if (items.length >= 1000) { truncated = true; break; }
      const occurrenceDate = calendarDate(occurrence, allDayRecurrence);
      const override = recurrenceOverride(event, occurrence);
      if (excluded.has(occurrenceDate) && !override) continue;
      if (override?.status === "CANCELLED") { skipped.cancelled += 1; continue; }
      const instance = override ? ({ ...event, ...override } as VEvent) : event;
      const start: DateWithTimeZone = (override?.start as DateWithTimeZone | undefined) ?? (occurrence as DateWithTimeZone);
      const end: DateWithTimeZone | undefined = (override?.end as DateWithTimeZone | undefined)
        ?? (duration === null ? undefined : new Date(occurrence.getTime() + duration) as DateWithTimeZone);
      items.push(toIncoming(instance, `${event.uid}::${occurrenceDate}`, start, end, Boolean(start && end && !start.dateOnly)));
      expandedRecurrences += 1;
    }
    if (truncated) break;
  }
  return { items, expandedRecurrences, truncated, skipped };
}

export function syncWindow(now = new Date()): { from: string; to: string } {
  const today = toLocalDateString(now);
  return { from: addCalendarDays(today, -30), to: addCalendarDays(today, 180) };
}
