import assert from "node:assert/strict";
import { cloudSyncInternals, parseCloudSyncCheckpoint } from "../lib/cloudSync";
import type { Task } from "../types/task";

const baseTask: Task = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  class_id: null,
  canvas_uid: null,
  title: "Reading",
  description: null,
  due_date: "2026-09-04",
  due_time: "18:00:00",
  location: null,
  category: "classes",
  course_code: "PHI 317K",
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
  subtasks: [],
  created_at: "2026-09-01T12:00:00.000Z",
  updated_at: "2026-09-01T12:00:00.000Z",
};

const localHash = cloudSyncInternals.taskHash(baseTask);
const assignedHash = cloudSyncInternals.taskHash({ ...baseTask, class_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
assert.notEqual(localHash, assignedHash, "Changing a class assignment must be detected by cloud sync.");
const calendarClass = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "PHI 317K",
  course_code: "PHI 317K",
  aliases: ["PHI317K"],
  color: "#2563EB",
  deleted_at: null,
  created_at: "2026-09-01T12:00:00.000Z",
  updated_at: "2026-09-01T12:00:00.000Z",
};
assert.notEqual(cloudSyncInternals.classHash(calendarClass), cloudSyncInternals.classHash({ ...calendarClass, color: "#DC2626" }));
const taskPayload = cloudSyncInternals.taskUpdatePayload({ ...baseTask, class_id: calendarClass.id });
assert.equal(taskPayload.class_id, calendarClass.id, "Calendar-item uploads must retain their class assignment.");
const insertedClassPayload = cloudSyncInternals.classInsertPayload(calendarClass, "user-a");
assert.equal(insertedClassPayload.user_id, "user-a", "New classes must be scoped to the signed-in user.");
assert.equal(insertedClassPayload.id, calendarClass.id, "New classes must retain their stable local ID.");
const updatedClassPayload = cloudSyncInternals.classUpdatePayload(calendarClass);
assert.equal("user_id" in updatedClassPayload, false, "Class updates must never attempt to change ownership.");
assert.equal(updatedClassPayload.color, calendarClass.color, "Class color changes must be uploaded.");
const remoteClass = cloudSyncInternals.remoteClassToLocal({ ...calendarClass, user_id: "user-a", revision: 3 });
assert.deepEqual(remoteClass, calendarClass, "Class downloads must preserve IDs, aliases, colors, and timestamps.");
const preferences = { colors: { classes: "green", orgs: "orange", social: "purple" } as const, calendarView: "month" as const, workspaceViews: { classes: "list", orgs: "list", social: "list" } as const };
assert.notEqual(cloudSyncInternals.preferencesHash(preferences, "#64748B"), cloudSyncInternals.preferencesHash(preferences, "#2563EB"));
const remote = { revision: 4, updated_at: "2026-09-01T12:00:00.000Z", deleted_at: null };

assert.equal(cloudSyncInternals.chooseVersion({ localHash, localUpdatedAt: baseTask.updated_at, remote: null }), "upload");
assert.equal(cloudSyncInternals.chooseVersion({ localHash: null, localUpdatedAt: null, remote }), "download");
assert.equal(cloudSyncInternals.chooseVersion({ localHash, localUpdatedAt: baseTask.updated_at, remote, checkpointHash: localHash, checkpointRevision: 4 }), "download");
assert.equal(cloudSyncInternals.chooseVersion({ localHash: `${localHash}-changed`, localUpdatedAt: "2026-09-02T12:00:00.000Z", remote, checkpointHash: localHash, checkpointRevision: 4 }), "upload");
assert.equal(cloudSyncInternals.chooseVersion({ localHash, localUpdatedAt: baseTask.updated_at, remote: { ...remote, revision: 5 }, checkpointHash: localHash, checkpointRevision: 4 }), "download");
assert.equal(cloudSyncInternals.chooseVersion({ localHash: null, localUpdatedAt: null, remote, checkpointHash: localHash, checkpointRevision: 4 }), "delete_remote");
assert.equal(cloudSyncInternals.chooseVersion({ localHash: null, localUpdatedAt: null, remote: { ...remote, revision: 5 }, checkpointHash: localHash, checkpointRevision: 4 }), "download");
assert.equal(cloudSyncInternals.chooseVersion({ localHash, localUpdatedAt: baseTask.updated_at, remote: { revision: 5, updated_at: "2026-09-02T12:00:00.000Z", deleted_at: "2026-09-02T12:00:00.000Z" }, checkpointHash: localHash, checkpointRevision: 4 }), "deleted");
assert.equal(cloudSyncInternals.chooseVersion({ localHash: `${localHash}-changed`, localUpdatedAt: "2026-09-03T12:00:00.000Z", remote: { revision: 5, updated_at: "2026-09-02T12:00:00.000Z", deleted_at: "2026-09-02T12:00:00.000Z" }, checkpointHash: localHash, checkpointRevision: 4 }), "upload");
assert.equal(parseCloudSyncCheckpoint("not-json"), null);
assert.equal(parseCloudSyncCheckpoint(JSON.stringify({ version: 99 })), null);
const legacyCheckpoint = parseCloudSyncCheckpoint(JSON.stringify({ version: 1, lastSuccessfulAt: "2026-09-10T12:00:00.000Z" }));
assert.deepEqual(legacyCheckpoint?.classHashes, {});
assert.deepEqual(legacyCheckpoint?.classRevisions, {});

console.log("PASS cloud sync tracks class assignments, class edits, Unassigned color, tombstones, conflicts, and legacy checkpoints.");
