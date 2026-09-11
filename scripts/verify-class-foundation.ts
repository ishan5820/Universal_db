import assert from "node:assert/strict";
import { BASE_CALENDAR_COLORS, DEFAULT_UNASSIGNED_CLASS_COLOR, calendarColorText, nextAvailableCalendarColor, normalizeCalendarColor } from "../lib/calendarColors";
import { archiveCalendarClass, createCalendarClass, getClassRegistry, normalizeClassRegistry, replaceClassRegistry, setUnassignedClassColor, updateCalendarClass } from "../lib/localClasses";
import { assignTaskClasses, getAllTasks, replaceTasksFromCloud, validateBackupTasks } from "../lib/localTasks";

const now = "2026-09-10T17:00:00.000Z";
const firstId = "10000000-0000-4000-8000-000000000001";
const secondId = "10000000-0000-4000-8000-000000000002";

assert.equal(normalizeCalendarColor("#059669"), "#059669");
assert.equal(normalizeCalendarColor(" #ea580c "), "#EA580C");
assert.equal(normalizeCalendarColor("green"), null);
assert.equal(calendarColorText("#FEF08A"), "#0F172A");
assert.equal(calendarColorText("#1E293B"), "#FFFFFF");

const generated = new Set<string>([DEFAULT_UNASSIGNED_CLASS_COLOR]);
for (let index = 0; index < 40; index += 1) generated.add(nextAvailableCalendarColor(generated, index));
assert.equal(generated.size, 41, "Generated class colors must stay unique beyond the preset palette.");
assert.equal(new Set(BASE_CALENDAR_COLORS).size, BASE_CALENDAR_COLORS.length);

const registry = normalizeClassRegistry({
  version: 1,
  unassigned_color: DEFAULT_UNASSIGNED_CLASS_COLOR,
  classes: [
    { id: firstId, name: "ECO 304K", course_code: "eco 304k", aliases: ["ECO304K", "eco304k"], color: "#059669", deleted_at: null, created_at: now, updated_at: now },
    { id: secondId, name: "PHI 317K", course_code: "PHI 317K", aliases: [], color: "#059669", deleted_at: null, created_at: now, updated_at: now },
  ],
});
assert.equal(registry.classes.length, 2);
assert.equal(registry.classes[0].course_code, "ECO 304K");
assert.deepEqual(registry.classes[0].aliases, ["ECO304K"]);
assert.notEqual(registry.classes[0].color, registry.classes[1].color, "Stored duplicate colors must be repaired safely.");
assert.notEqual(registry.classes[0].color, registry.unassigned_color);
const reservedRegistry = normalizeClassRegistry({
  version: 1,
  unassigned_color: "#D97706",
  classes: [{ id: firstId, name: "Reserved collision", color: "#7C3AED", aliases: [], created_at: now, updated_at: now }],
}, ["#D97706", "#7C3AED"]);
assert.notEqual(reservedRegistry.unassigned_color, "#D97706");
assert.notEqual(reservedRegistry.classes[0].color, "#7C3AED");

const legacyTask = {
  id: "20000000-0000-4000-8000-000000000001",
  canvas_uid: null,
  title: "Legacy assignment",
  description: null,
  due_date: "2026-09-10",
  due_time: null,
  location: null,
  category: "classes",
  course_code: "ECO 304K",
  is_pinned: false,
  is_completed: false,
  source: "manual",
  kind: "task",
  color_shade: 2,
  end_time: null,
  series_id: null,
  recurrence_rule: null,
  series_until: null,
  import_batch_id: null,
  subtasks: [],
  created_at: now,
  updated_at: now,
};
const checked = validateBackupTasks([legacyTask]);
assert.equal(checked.ok, true, "Existing rows without class_id must remain valid.");
if (checked.ok) assert.equal(checked.tasks[0].class_id, null);
const legacyTasks = checked.ok ? checked.tasks : [];

console.log("PASS Class colors are valid, accessible, and unique beyond the preset palette.");
console.log("PASS Class registry normalization repairs duplicate colors and aliases safely.");
console.log("PASS Existing calendar rows load with an unassigned class without data loss.");

async function verifyStoredOperations() {
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

  const emptyRegistry = await replaceClassRegistry(null);
  assert.equal(emptyRegistry.ok, true);
  const eco = await createCalendarClass({ name: "ECO 304K", course_code: "eco 304k", aliases: ["ECO304K"] });
  assert.equal(eco.ok, true);
  const duplicateColor = await createCalendarClass({ name: "PHI 317K", color: eco.calendarClass.color });
  assert.equal(duplicateColor.ok, false, "Two active classes cannot use the same color.");
  const phi = await createCalendarClass({ name: "PHI 317K" });
  assert.equal(phi.ok, true);
  const renamed = await updateCalendarClass(phi.calendarClass.id, { name: "PHI 317K — Aesthetics", aliases: ["PHI317K"] });
  assert.equal(renamed.ok, true);
  const conflictingUnassigned = await setUnassignedClassColor(eco.calendarClass.color);
  assert.equal(conflictingUnassigned.ok, false);

  assert.equal((await replaceTasksFromCloud(legacyTasks)).ok, true);
  const assigned = await assignTaskClasses([{ taskId: legacyTasks[0].id, classId: eco.calendarClass.id }]);
  assert.equal(assigned.ok, true);
  assert.equal(assigned.ok && assigned.count, 1);
  const savedTasks = await getAllTasks();
  if (!savedTasks.ok) throw new Error(savedTasks.error);
  assert.equal(savedTasks.tasks[0].class_id, eco.calendarClass.id);
  assert.equal((await assignTaskClasses([{ taskId: legacyTasks[0].id, classId: null }])).ok, true);
  assert.equal((await archiveCalendarClass(eco.calendarClass.id)).ok, true);
  const finalRegistry = await getClassRegistry();
  assert.equal(finalRegistry.ok && finalRegistry.count, 1);

  console.log("PASS Class create, edit, unique-color, assignment, unassignment, and soft-removal safeguards work.");
}

void verifyStoredOperations().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
