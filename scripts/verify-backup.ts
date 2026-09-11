import assert from "node:assert/strict";
import { BACKUP_FORMAT, BACKUP_VERSION, createBackupDocument, parseBackupDocument } from "../lib/backup";
import { getAllTasks, mergeTasksFromBackup, replaceTasksFromCloud, validateBackupTasks } from "../lib/localTasks";
import { getClassRegistrySnapshot, replaceClassRegistry } from "../lib/localClasses";
import type { LocalPreferences } from "../lib/preferences";
import type { ClassRegistrySnapshot } from "../types/calendarClass";
import type { Task } from "../types/task";

const classRegistry: ClassRegistrySnapshot = {
  version: 1,
  classes: [{
    id: "30000000-0000-4000-8000-000000000001",
    name: "PHI 317K",
    course_code: "PHI 317K",
    aliases: ["PHI317K"],
    color: "#2563EB",
    deleted_at: null,
    created_at: "2026-09-04T11:00:00.000Z",
    updated_at: "2026-09-04T11:00:00.000Z",
  }],
  unassigned_color: "#64748B",
  updated_at: "2026-09-04T11:00:00.000Z",
};

const task: Task = {
  id: "10000000-0000-4000-8000-000000000001",
  class_id: classRegistry.classes[0].id,
  canvas_uid: null,
  title: "Backup integrity check",
  description: "Includes every task field and its subtasks.",
  due_date: "2026-09-04",
  due_time: "18:00:00",
  location: "UTC 1.102",
  category: "classes",
  course_code: null,
  is_pinned: true,
  is_completed: false,
  source: "manual",
  kind: "task",
  color_shade: 4,
  end_time: null,
  series_id: null,
  recurrence_rule: null,
  series_until: null,
  import_batch_id: null,
  subtasks: [{ id: "20000000-0000-4000-8000-000000000001", title: "Verify subtask", is_completed: true, created_at: "2026-09-04T12:00:00.000Z" }],
  created_at: "2026-09-04T12:00:00.000Z",
  updated_at: "2026-09-04T13:00:00.000Z",
};

const preferences: LocalPreferences = {
  colors: { classes: "blue", orgs: "red", social: "yellow" },
  calendarView: "week",
  workspaceViews: { classes: "calendar", orgs: "list", social: "calendar" },
};

const backup = createBackupDocument([task], preferences, classRegistry, "2026-09-04T14:00:00.000Z");
assert.equal(backup.format, BACKUP_FORMAT);
assert.equal(backup.version, BACKUP_VERSION);
assert.deepEqual(backup.tasks, [task]);
assert.deepEqual(backup.preferences, preferences);
assert.deepEqual(backup.class_registry, classRegistry);

const parsed = parseBackupDocument(JSON.parse(JSON.stringify(backup)));
assert.equal(parsed.isLegacy, false);
assert.deepEqual(parsed.preferences, preferences);
assert.deepEqual(parsed.classRegistry, classRegistry);
const checked = validateBackupTasks(parsed.tasks);
assert.equal(checked.ok, true);
if (checked.ok) {
  assert.equal(checked.tasks[0].id, task.id, "Restore must preserve stable item IDs.");
  assert.deepEqual(checked.tasks[0].subtasks, task.subtasks, "Restore must preserve subtasks.");
}

assert.deepEqual(parseBackupDocument([task]), { tasks: [task], preferences: null, classRegistry: null, isLegacy: true });
assert.deepEqual(parseBackupDocument({ tasks: [task] }), { tasks: [task], preferences: null, classRegistry: null, isLegacy: true });
const previousBackup = parseBackupDocument({ ...backup, version: 2, class_registry: undefined });
assert.equal(previousBackup.isLegacy, true);
assert.equal(previousBackup.classRegistry, null);
assert.throws(() => parseBackupDocument({ ...backup, version: 999 }), /not supported/);
assert.throws(() => parseBackupDocument({ ...backup, format: "different-app" }), /different application/);

const empty = parseBackupDocument(createBackupDocument([], preferences, classRegistry));
const emptyChecked = validateBackupTasks(empty.tasks);
assert.equal(emptyChecked.ok, true, "A settings-only backup should remain restorable.");

console.log("PASS Versioned backups include all calendar rows, classes, and preferences.");
console.log("PASS Restore validation preserves item IDs and subtasks.");
console.log("PASS Legacy array and object backups remain compatible.");
console.log("PASS Version 2 backups remain compatible without inventing class settings.");
console.log("PASS Foreign and unsupported backup formats are rejected.");

async function verifySafeMerge() {
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

  const seeded = await replaceTasksFromCloud([task]);
  assert.equal(seeded.ok, true);
  const restoredClasses = await replaceClassRegistry(parsed.classRegistry);
  assert.equal(restoredClasses.ok, true);
  const savedRegistry = await getClassRegistrySnapshot();
  assert.equal(savedRegistry.classes[0]?.id, classRegistry.classes[0].id);
  assert.equal(savedRegistry.unassigned_color, classRegistry.unassigned_color);
  assert.equal((await getAllTasks()).ok, true);
  const repeated = await mergeTasksFromBackup([task]);
  assert.equal(repeated.ok, true);
  if (repeated.ok) {
    assert.equal(repeated.count, 1);
    assert.equal(repeated.unchanged, 1);
  }

  const newerCopy = { ...task, id: "10000000-0000-4000-8000-000000000099", description: "Newer backup copy", updated_at: "2026-09-04T15:00:00.000Z" };
  const merged = await mergeTasksFromBackup([newerCopy]);
  assert.equal(merged.ok, true);
  if (merged.ok) {
    assert.equal(merged.count, 1, "A repeated backup must not duplicate a matching item.");
    assert.equal(merged.updated.length, 1);
    assert.equal(merged.tasks[0].id, task.id, "A semantic match must preserve the local stable ID.");
    assert.equal(merged.tasks[0].description, "Newer backup copy");
  }

  const olderCopy = { ...newerCopy, description: "Stale backup copy", updated_at: "2026-09-04T12:30:00.000Z" };
  const stale = await mergeTasksFromBackup([olderCopy]);
  assert.equal(stale.ok, true);
  if (stale.ok) {
    assert.equal(stale.tasks[0].description, "Newer backup copy", "An older backup must not overwrite newer local data.");
  }
  console.log("PASS Restore preserves class IDs and merges repeated backups without duplicating or overwriting newer data.");
}

void verifySafeMerge().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
