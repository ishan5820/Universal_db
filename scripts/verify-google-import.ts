import assert from "node:assert/strict";
import { parseIcsInBrowser } from "../lib/parseIcsBrowser";

const calendar = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Universal Dashboard//Google Import Test//EN",
  "BEGIN:VEVENT",
  "UID:all-day-google",
  "DTSTART;VALUE=DATE:20260908",
  "DTEND;VALUE=DATE:20260909",
  "SUMMARY:All-day event",
  "LOCATION:Campus",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:timed-google",
  "DTSTART:20260909T180000Z",
  "DTEND:20260909T190000Z",
  "SUMMARY:Timed event",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:recurring-google",
  "DTSTART;VALUE=DATE:20260910",
  "DTEND;VALUE=DATE:20260911",
  "RRULE:FREQ=WEEKLY;COUNT=2",
  "SUMMARY:Recurring event",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:recurring-google",
  "RECURRENCE-ID;VALUE=DATE:20260917",
  "DTSTART;VALUE=DATE:20260919",
  "DTEND;VALUE=DATE:20260920",
  "SUMMARY:Recurring event moved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:second-recurring-google",
  "DTSTART;VALUE=DATE:20260910",
  "DTEND;VALUE=DATE:20260911",
  "RRULE:FREQ=WEEKLY;COUNT=2",
  "SUMMARY:Second recurring event",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:second-recurring-google",
  "RECURRENCE-ID;VALUE=DATE:20260917",
  "DTSTART;VALUE=DATE:20260917",
  "SUMMARY:Second recurring event",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:cancelled-google",
  "DTSTART;VALUE=DATE:20260912",
  "SUMMARY:Cancelled event",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const parsed = parseIcsInBrowser(calendar, "Test calendar", new Date("2026-09-01T17:00:00Z"));
const byUid = new Map(parsed.events.map((event) => [event.uid, event]));

assert.equal(byUid.get("google-calendar:all-day-google")?.dueDate, "2026-09-08");
assert.equal(byUid.get("google-calendar:all-day-google")?.dueTime, null);
assert.equal(byUid.get("google-calendar:timed-google")?.dueDate, "2026-09-09");
assert.equal(byUid.get("google-calendar:timed-google")?.dueTime, "1:00 PM");
assert.equal(byUid.get("google-calendar:timed-google")?.endTime, "2:00 PM");
assert.equal(parsed.events.filter((event) => event.uid.startsWith("google-calendar:recurring-google::")).length, 2);
assert.equal(parsed.events.find((event) => event.title === "Recurring event moved")?.dueDate, "2026-09-19");
assert.equal(parsed.events.filter((event) => event.uid.startsWith("google-calendar:second-recurring-google::")).length, 1);
assert.equal(parsed.events.some((event) => event.uid.includes("cancelled-google")), false);
assert.equal(parsed.truncated, false);

console.log("PASS Google Calendar ICS dates, times, recurrence, and cancellation parsing.");
