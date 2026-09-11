import assert from "node:assert/strict";
import { countClassAssignments, removeManagedClass } from "../lib/classManagement";
import { createCalendarClass, getClassRegistry, replaceClassRegistry, setUnassignedClassColor, updateCalendarClass } from "../lib/localClasses";
import { getAllTasks, replaceTasksFromCloud } from "../lib/localTasks";
import { CATEGORY_BASE_COLORS } from "../lib/preferences";
import type { Task } from "../types/task";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    },
    dispatchEvent: () => true,
  },
});

const timestamp = "2026-09-10T17:00:00.000Z";

function calendarItem(idSuffix: number, classId: string | null, category: Task["category"] = "classes"): Task {
  return {
    id: `20000000-0000-4000-8000-${String(idSuffix).padStart(12, "0")}`,
    class_id: classId,
    canvas_uid: null,
    title: `Calendar item ${idSuffix}`,
    description: "Keep this note",
    due_date: "2026-09-10",
    due_time: "3:00 PM",
    location: null,
    category,
    course_code: null,
    is_pinned: false,
    is_completed: false,
    source: "manual",
    kind: "task",
    color_shade: 3,
    end_time: null,
    series_id: null,
    recurrence_rule: null,
    series_until: null,
    import_batch_id: null,
    subtasks: [{ id: `30000000-0000-4000-8000-${String(idSuffix).padStart(12, "0")}`, title: "Preserve me", is_completed: false, created_at: timestamp }],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

async function main() {
  assert.equal((await replaceClassRegistry(null)).ok, true);
  const first = await createCalendarClass({ name: "ECO 304K", course_code: "ECO 304K", color: "#059669" });
  if (!first.ok) throw new Error(first.error);
  const second = await createCalendarClass({ name: "PHI 317K", course_code: "PHI 317K", color: "#2563EB" });
  if (!second.ok) throw new Error(second.error);

  const reservedCategoryColor = await createCalendarClass({ name: "Reserved", color: CATEGORY_BASE_COLORS.orange });
  assert.equal(reservedCategoryColor.ok, false, "Classes cannot reuse the Orgs color.");

  const duplicateColor = await updateCalendarClass(second.calendarClass.id, { color: first.calendarClass.color });
  assert.equal(duplicateColor.ok, false, "A class cannot be changed to another active class color.");
  const conflictingUnassigned = await setUnassignedClassColor(second.calendarClass.color);
  assert.equal(conflictingUnassigned.ok, false, "Unassigned cannot use an active class color.");
  const reservedUnassigned = await setUnassignedClassColor(CATEGORY_BASE_COLORS.purple);
  assert.equal(reservedUnassigned.ok, false, "Unassigned cannot reuse the Social color.");

  const rows = [
    calendarItem(1, first.calendarClass.id),
    calendarItem(2, first.calendarClass.id),
    calendarItem(3, second.calendarClass.id),
    calendarItem(4, null, "orgs"),
  ];
  assert.equal((await replaceTasksFromCloud(rows)).ok, true);
  assert.equal(countClassAssignments(rows).get(first.calendarClass.id), 2);
  assert.equal(countClassAssignments(rows).get(second.calendarClass.id), 1);

  const removed = await removeManagedClass(first.calendarClass.id);
  assert.equal(removed.ok, true);
  assert.equal(removed.unassignedCount, 2);
  const savedTasks = await getAllTasks();
  if (!savedTasks.ok) throw new Error(savedTasks.error);
  assert.equal(savedTasks.tasks.filter((task) => task.id === rows[0].id || task.id === rows[1].id).every((task) => task.class_id === null), true);
  assert.equal(savedTasks.tasks.find((task) => task.id === rows[0].id)?.description, "Keep this note");
  assert.equal(savedTasks.tasks.find((task) => task.id === rows[0].id)?.subtasks[0]?.title, "Preserve me");
  assert.equal(savedTasks.tasks.find((task) => task.id === rows[2].id)?.class_id, second.calendarClass.id);

  const activeRegistry = await getClassRegistry();
  if (!activeRegistry.ok) throw new Error(activeRegistry.error);
  assert.deepEqual(activeRegistry.classes.map((calendarClass) => calendarClass.id), [second.calendarClass.id]);
  const fullRegistry = await getClassRegistry(true);
  if (!fullRegistry.ok) throw new Error(fullRegistry.error);
  assert.ok(fullRegistry.classes.find((calendarClass) => calendarClass.id === first.calendarClass.id)?.deleted_at, "Removed classes should be soft-deleted for safe future sync.");

  console.log("PASS Class assignment counts include only Classes items.");
  console.log("PASS Classes, Unassigned, Orgs, and Social remain color-distinct during edits.");
  console.log("PASS Removing a class preserves its items, notes, and subtasks while moving them to Unassigned.");
  console.log("PASS Removed classes are soft-deleted and unrelated class assignments remain intact.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
