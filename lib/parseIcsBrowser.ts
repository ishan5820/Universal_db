import ICAL from "ical.js";
import { addCalendarDays, toLocalDateString, toLocalTimeString } from "@/lib/datetime";
import type { TaskCategory } from "@/types/task";

export interface BrowserCalendarEvent {
  uid: string;
  title: string;
  description: string | null;
  dueDate: string;
  dueTime: string | null;
  endTime: string | null;
  location: string | null;
  recurrenceRule: string | null;
  sourceName: string;
}

export interface BrowserCalendarParseResult {
  events: BrowserCalendarEvent[];
  skipped: number;
  truncated: boolean;
  recurrenceFrom: string;
  recurrenceTo: string;
}

export interface CalendarImportRow extends BrowserCalendarEvent {
  key: string;
  category: TaskCategory;
  include: boolean;
  duplicate: boolean;
}

const MAX_EVENTS_PER_IMPORT = 5_000;

function calendarDate(value: InstanceType<typeof ICAL.Time>): string {
  if (value.isDate) {
    return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
  }
  return toLocalDateString(value.toJSDate());
}

function calendarTime(value: InstanceType<typeof ICAL.Time>): string | null {
  return value.isDate ? null : toLocalTimeString(value.toJSDate());
}

function propertyText(component: InstanceType<typeof ICAL.Component>, name: string): string | null {
  const value = component.getFirstPropertyValue(name);
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function isCancelled(component: InstanceType<typeof ICAL.Component>): boolean {
  return propertyText(component, "status")?.toUpperCase() === "CANCELLED";
}

function eventRow(
  event: InstanceType<typeof ICAL.Event>,
  start: InstanceType<typeof ICAL.Time>,
  end: InstanceType<typeof ICAL.Time>,
  uid: string,
  sourceName: string,
): BrowserCalendarEvent | null {
  const title = event.summary?.trim();
  if (!title || !start) return null;
  const recurrence = event.component.getFirstPropertyValue("rrule");
  return {
    uid: `google-calendar:${uid}`,
    title,
    description: event.description?.trim() || null,
    dueDate: calendarDate(start),
    dueTime: calendarTime(start),
    endTime: calendarTime(end),
    location: event.location?.trim() || null,
    recurrenceRule: recurrence ? String(recurrence) : null,
    sourceName,
  };
}

export function parseIcsInBrowser(text: string, sourceName: string, now = new Date()): BrowserCalendarParseResult {
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error(`${sourceName} is not a valid iCalendar file.`);
  const root = new ICAL.Component(ICAL.parse(text));
  const components = root.getAllSubcomponents("vevent");
  const exceptionsByUid = new Map<string, Array<InstanceType<typeof ICAL.Component>>>();
  for (const component of components) {
    if (!component.hasProperty("recurrence-id")) continue;
    const uid = propertyText(component, "uid");
    if (!uid) continue;
    const current = exceptionsByUid.get(uid) ?? [];
    current.push(component);
    exceptionsByUid.set(uid, current);
  }
  const events: BrowserCalendarEvent[] = [];
  let skipped = 0;
  let truncated = false;
  const recurrenceFrom = addCalendarDays(toLocalDateString(now), -366);
  const recurrenceTo = addCalendarDays(toLocalDateString(now), 731);

  for (const component of components) {
    if (events.length >= MAX_EVENTS_PER_IMPORT) {
      truncated = true;
      break;
    }
    if (component.hasProperty("recurrence-id") || isCancelled(component)) continue;
    try {
      const componentUid = propertyText(component, "uid") ?? "";
      const event = new ICAL.Event(component, { exceptions: exceptionsByUid.get(componentUid) ?? [], strictExceptions: true });
      if (!event.uid?.trim() || !event.summary?.trim()) {
        skipped += 1;
        continue;
      }
      if (!event.isRecurring()) {
        const row = eventRow(event, event.startDate, event.endDate, event.uid, sourceName);
        if (row) events.push(row);
        else skipped += 1;
        continue;
      }

      const iterator = event.iterator();
      let occurrence: InstanceType<typeof ICAL.Time> | null;
      while ((occurrence = iterator.next())) {
        const occurrenceDate = calendarDate(occurrence);
        if (occurrenceDate > recurrenceTo) break;
        if (occurrenceDate < recurrenceFrom) continue;
        if (events.length >= MAX_EVENTS_PER_IMPORT) {
          truncated = true;
          break;
        }
        const details = event.getOccurrenceDetails(occurrence);
        if (isCancelled(details.item.component)) continue;
        const recurrenceKey = details.recurrenceId.toString();
        const row = eventRow(details.item, details.startDate, details.endDate, `${event.uid}::${recurrenceKey}`, sourceName);
        if (row) events.push(row);
        else skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }

  return { events, skipped, truncated, recurrenceFrom, recurrenceTo };
}
