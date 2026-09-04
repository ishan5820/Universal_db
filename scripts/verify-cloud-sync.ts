import assert from "node:assert/strict";
import { cloudSyncInternals, parseCloudSyncCheckpoint } from "../lib/cloudSync";
import type { Task } from "../types/task";

const baseTask: Task = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

console.log("PASS cloud sync handles initial migration, two-device changes, deletion tombstones, conflicts, and invalid checkpoints.");
