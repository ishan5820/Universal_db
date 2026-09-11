import assert from "node:assert/strict";
import { buildClassDetectionPlan, extractCourseCode } from "../lib/classDetection";
import type { CalendarClass } from "../types/calendarClass";
import type { Task } from "../types/task";

const timestamp = "2026-09-10T17:00:00.000Z";
let taskSequence = 0;

function task(title: string, courseCode: string | null = null, overrides: Partial<Task> = {}): Task {
  taskSequence += 1;
  return {
    id: `20000000-0000-4000-8000-${String(taskSequence).padStart(12, "0")}`,
    class_id: null,
    canvas_uid: null,
    title,
    description: null,
    due_date: "2026-09-10",
    due_time: null,
    location: null,
    category: "classes",
    course_code: courseCode,
    is_pinned: false,
    is_completed: false,
    source: "manual",
    kind: "task",
    color_shade: 1,
    end_time: null,
    series_id: null,
    recurrence_rule: null,
    series_until: null,
    import_batch_id: null,
    subtasks: [],
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function calendarClass(idSuffix: number, name: string, courseCode: string | null, aliases: string[] = []): CalendarClass {
  return {
    id: `10000000-0000-4000-8000-${String(idSuffix).padStart(12, "0")}`,
    name,
    course_code: courseCode,
    aliases,
    color: "#059669",
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

assert.equal(extractCourseCode("ECO 304K InQuizitive"), "ECO 304K");
assert.equal(extractCourseCode("[B A 110G] Activity"), "B A 110G");
assert.equal(extractCourseCode("Week 304 review"), null);

const eco = calendarClass(1, "ECO 304K — Microeconomics", "ECO 304K", ["Microeconomics"]);
const phi = calendarClass(2, "PHI 317K — Aesthetics", "PHI 317K", ["Aesthetics Seminar"]);
const duplicatePhi = calendarClass(3, "PHI 317K Discussion", "PHI317K");
const assigned = task("Already organized", "STA 301", { class_id: eco.id });
const rows = [
  task("InQuizitive Chapter 2", "ECO 304K"),
  task("ECO304K Midterm"),
  task("Aesthetics Seminar reading"),
  task("PHI 317K Essay"),
  task("Week 304 review"),
  task("Student organization event", null, { category: "orgs" }),
  assigned,
];

const plan = buildClassDetectionPlan(rows, [eco, phi, duplicatePhi]);
const ecoCandidate = plan.candidates.find((candidate) => candidate.detectedCourseCode === "ECO 304K");
assert.ok(ecoCandidate);
assert.equal(ecoCandidate.existingClassId, eco.id);
assert.equal(ecoCandidate.taskIds.length, 2, "Repeated imports from one course must group into one review choice.");
assert.equal(ecoCandidate.confidence, "high", "Course metadata should raise a grouped match to high confidence.");

const aliasCandidate = plan.candidates.find((candidate) => candidate.source === "alias");
assert.equal(aliasCandidate?.existingClassId, phi.id);

const ambiguous = plan.candidates.find((candidate) => candidate.detectedCourseCode === "PHI 317K");
assert.equal(ambiguous?.existingClassId, null);
assert.deepEqual(new Set(ambiguous?.ambiguousClassIds), new Set([phi.id, duplicatePhi.id]));
assert.equal(plan.unmatchedTasks.some((row) => row.title === "Week 304 review"), true);
assert.equal(plan.alreadyAssignedCount, 1);
assert.equal(plan.eligibleCount, 5, "Non-Class items and already assigned rows must not be eligible.");

const changedPlan = buildClassDetectionPlan(rows.map((row) => row.id === rows[0].id ? { ...row, title: `${row.title} corrected`, updated_at: "2026-09-10T18:00:00.000Z" } : row), [eco, phi, duplicatePhi]);
assert.notEqual(plan.fingerprint, changedPlan.fingerprint, "A stale review must be detected before assignments are written.");

console.log("PASS Course codes are detected from metadata and titles without common false positives.");
console.log("PASS Existing, repeated, alias, and ambiguous matches remain explicit in the review plan.");
console.log("PASS Assigned and non-Class items are protected, and stale reviews are detected.");
