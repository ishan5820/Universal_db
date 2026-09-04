import type { SupabaseClient } from "@supabase/supabase-js";
import { applyLocalPreferences, readLocalPreferences, type LocalPreferences } from "@/lib/preferences";
import type { Subtask, Task } from "@/types/task";

type RemoteCalendarItem = Omit<Task, "subtasks"> & {
  user_id: string;
  revision: number;
  deleted_at: string | null;
};

type RemoteSubtask = Subtask & {
  user_id: string;
  calendar_item_id: string;
  revision: number;
  updated_at: string;
  deleted_at: string | null;
};

type RemoteSettings = {
  user_id: string;
  classes_color: LocalPreferences["colors"]["classes"];
  orgs_color: LocalPreferences["colors"]["orgs"];
  social_color: LocalPreferences["colors"]["social"];
  calendar_view: LocalPreferences["calendarView"];
  classes_workspace_view: LocalPreferences["workspaceViews"]["classes"];
  orgs_workspace_view: LocalPreferences["workspaceViews"]["orgs"];
  social_workspace_view: LocalPreferences["workspaceViews"]["social"];
  local_migration_completed_at: string | null;
  revision: number;
};

export interface CloudSyncCheckpoint {
  version: 1;
  taskHashes: Record<string, string>;
  taskRevisions: Record<string, number>;
  subtaskHashes: Record<string, string>;
  subtaskRevisions: Record<string, number>;
  settingsHash: string | null;
  settingsRevision: number | null;
  lastSuccessfulAt: string;
}

export interface CloudSyncResult {
  tasks: Task[];
  checkpoint: CloudSyncCheckpoint;
  uploaded: number;
  downloaded: number;
  preferences: LocalPreferences;
}

type MergeDecision = "upload" | "download" | "delete_remote" | "deleted";

const PAGE_SIZE = 500;
const WRITE_BATCH_SIZE = 200;
const UPDATE_CONCURRENCY = 20;

function asTimestamp(value: string | null | undefined): number {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compactHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function taskHash(task: Task): string {
  return compactHash(JSON.stringify([
    task.canvas_uid, task.title, task.description, task.due_date, task.due_time, task.location,
    task.category, task.course_code, task.is_pinned, task.is_completed, task.source, task.kind,
    task.color_shade, task.end_time, task.series_id, task.recurrence_rule, task.series_until,
    task.import_batch_id,
  ]));
}

function subtaskHash(subtask: Subtask, parentId: string): string {
  return compactHash(JSON.stringify([parentId, subtask.title, subtask.is_completed]));
}

function preferencesHash(preferences: LocalPreferences): string {
  return compactHash(JSON.stringify([
    preferences.colors.classes,
    preferences.colors.orgs,
    preferences.colors.social,
    preferences.calendarView,
    preferences.workspaceViews.classes,
    preferences.workspaceViews.orgs,
    preferences.workspaceViews.social,
  ]));
}

function chooseVersion({
  localHash,
  localUpdatedAt,
  remote,
  checkpointHash,
  checkpointRevision,
}: {
  localHash: string | null;
  localUpdatedAt: string | null;
  remote: { revision: number; updated_at: string; deleted_at: string | null } | null;
  checkpointHash?: string;
  checkpointRevision?: number;
}): MergeDecision {
  if (!remote) return localHash ? "upload" : "deleted";

  const remoteChanged = checkpointRevision === undefined || checkpointRevision !== remote.revision;
  const localWasKnown = checkpointHash !== undefined;
  const localChanged = localHash !== null && (!localWasKnown || checkpointHash !== localHash);

  if (localHash === null) {
    if (remote.deleted_at) return "deleted";
    if (localWasKnown && !remoteChanged) return "delete_remote";
    return "download";
  }

  if (remote.deleted_at) {
    if (localWasKnown && !localChanged) return "deleted";
    if (localChanged && !remoteChanged) return "upload";
    return asTimestamp(localUpdatedAt) > asTimestamp(remote.deleted_at) ? "upload" : "deleted";
  }

  if (localWasKnown) {
    if (localChanged && !remoteChanged) return "upload";
    if (!localChanged && remoteChanged) return "download";
    if (!localChanged && !remoteChanged) return "download";
  }

  return asTimestamp(localUpdatedAt) >= asTimestamp(remote.updated_at) ? "upload" : "download";
}

async function fetchAllRows<T>(supabase: SupabaseClient, table: "calendar_items" | "subtasks"): Promise<T[]> {
  const rows: T[] = [];
  let afterId: string | null = null;
  for (;;) {
    let query = supabase.from(table).select("*").order("id", { ascending: true }).limit(PAGE_SIZE);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new Error(`Cloud ${table.replace("_", " ")} could not be read: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    afterId = String((page.at(-1) as { id?: unknown } | undefined)?.id ?? "");
    if (!afterId) throw new Error(`Cloud ${table.replace("_", " ")} pagination failed.`);
  }
  return rows;
}

function taskInsertPayload(task: Task, userId: string) {
  return { id: task.id, user_id: userId, ...taskUpdatePayload(task) };
}

function taskUpdatePayload(task: Task) {
  return {
    canvas_uid: task.canvas_uid,
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    due_time: task.due_time,
    location: task.location,
    category: task.category,
    course_code: task.course_code,
    is_pinned: task.is_pinned,
    is_completed: task.is_completed,
    source: task.source,
    kind: task.kind,
    color_shade: task.color_shade,
    end_time: task.end_time,
    series_id: task.series_id,
    recurrence_rule: task.recurrence_rule,
    series_until: task.series_until,
    import_batch_id: task.import_batch_id,
    deleted_at: null,
  };
}

function subtaskInsertPayload(subtask: Subtask, userId: string, parentId: string) {
  return { id: subtask.id, user_id: userId, ...subtaskUpdatePayload(subtask, parentId) };
}

function subtaskUpdatePayload(subtask: Subtask, parentId: string) {
  return {
    calendar_item_id: parentId,
    title: subtask.title,
    is_completed: subtask.is_completed,
    deleted_at: null,
  };
}

function remoteTaskToLocal(row: RemoteCalendarItem): Task {
  return {
    id: row.id,
    canvas_uid: row.canvas_uid,
    title: row.title,
    description: row.description,
    due_date: row.due_date,
    due_time: row.due_time,
    location: row.location,
    category: row.category,
    course_code: row.course_code,
    is_pinned: row.is_pinned,
    is_completed: row.is_completed,
    source: row.source,
    kind: row.kind,
    color_shade: row.color_shade,
    end_time: row.end_time,
    series_id: row.series_id,
    recurrence_rule: row.recurrence_rule,
    series_until: row.series_until,
    import_batch_id: row.import_batch_id,
    subtasks: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function remotePreferences(row: RemoteSettings): LocalPreferences {
  return {
    colors: { classes: row.classes_color, orgs: row.orgs_color, social: row.social_color },
    calendarView: row.calendar_view,
    workspaceViews: {
      classes: row.classes_workspace_view,
      orgs: row.orgs_workspace_view,
      social: row.social_workspace_view,
    },
  };
}

function settingsPayload(preferences: LocalPreferences) {
  return {
    classes_color: preferences.colors.classes,
    orgs_color: preferences.colors.orgs,
    social_color: preferences.colors.social,
    calendar_view: preferences.calendarView,
    classes_workspace_view: preferences.workspaceViews.classes,
    orgs_workspace_view: preferences.workspaceViews.orgs,
    social_workspace_view: preferences.workspaceViews.social,
    local_migration_completed_at: new Date().toISOString(),
  };
}

async function insertInBatches(supabase: SupabaseClient, table: "calendar_items" | "subtasks", rows: Record<string, unknown>[]) {
  for (let index = 0; index < rows.length; index += WRITE_BATCH_SIZE) {
    const { error } = await supabase.from(table).insert(rows.slice(index, index + WRITE_BATCH_SIZE));
    if (error) throw new Error(`Cloud ${table.replace("_", " ")} could not be created: ${error.message}`);
  }
}

async function updateRows(
  supabase: SupabaseClient,
  table: "calendar_items" | "subtasks",
  rows: Array<{ id: string; payload: Record<string, unknown> }>,
) {
  for (let index = 0; index < rows.length; index += UPDATE_CONCURRENCY) {
    await Promise.all(rows.slice(index, index + UPDATE_CONCURRENCY).map(async ({ id, payload }) => {
      const { error } = await supabase.from(table).update(payload).eq("id", id);
      if (error) throw new Error(`Cloud ${table.replace("_", " ")} could not be updated: ${error.message}`);
    }));
  }
}

async function softDeleteRows(supabase: SupabaseClient, table: "calendar_items" | "subtasks", ids: string[]) {
  const deletedAt = new Date().toISOString();
  for (let index = 0; index < ids.length; index += WRITE_BATCH_SIZE) {
    const { error } = await supabase.from(table).update({ deleted_at: deletedAt }).in("id", ids.slice(index, index + WRITE_BATCH_SIZE));
    if (error) throw new Error(`Cloud ${table.replace("_", " ")} could not be removed: ${error.message}`);
  }
}

async function syncPreferences(
  supabase: SupabaseClient,
  userId: string,
  checkpoint: CloudSyncCheckpoint | null,
): Promise<{ preferences: LocalPreferences; revision: number }> {
  const local = readLocalPreferences();
  const { data, error } = await supabase.from("user_settings").select("*").maybeSingle();
  if (error) throw new Error(`Cloud preferences could not be read: ${error.message}`);
  const remote = data as RemoteSettings | null;

  if (!remote) {
    const { data: inserted, error: insertError } = await supabase
      .from("user_settings")
      .insert({ user_id: userId, ...settingsPayload(local) })
      .select("*")
      .single();
    if (insertError) throw new Error(`Cloud preferences could not be created: ${insertError.message}`);
    return { preferences: local, revision: (inserted as RemoteSettings).revision };
  }

  const localChanged = checkpoint?.settingsHash !== undefined && checkpoint.settingsHash !== null
    ? checkpoint.settingsHash !== preferencesHash(local)
    : false;
  const remoteChanged = checkpoint?.settingsRevision !== undefined && checkpoint.settingsRevision !== null
    ? checkpoint.settingsRevision !== remote.revision
    : true;

  if (localChanged) {
    const { data: updated, error: updateError } = await supabase
      .from("user_settings")
      .update(settingsPayload(local))
      .eq("user_id", userId)
      .select("*")
      .single();
    if (updateError) throw new Error(`Cloud preferences could not be updated: ${updateError.message}`);
    return { preferences: local, revision: (updated as RemoteSettings).revision };
  }

  const selected = remoteChanged || !checkpoint ? remotePreferences(remote) : local;
  if (preferencesHash(selected) !== preferencesHash(local)) applyLocalPreferences(selected);
  return { preferences: selected, revision: remote.revision };
}

export async function synchronizeCloudCalendar({
  supabase,
  userId,
  localTasks,
  checkpoint,
}: {
  supabase: SupabaseClient;
  userId: string;
  localTasks: Task[];
  checkpoint: CloudSyncCheckpoint | null;
}): Promise<CloudSyncResult> {
  const [remoteTasksRaw, remoteSubtasksRaw] = await Promise.all([
    fetchAllRows<RemoteCalendarItem>(supabase, "calendar_items"),
    fetchAllRows<RemoteSubtask>(supabase, "subtasks"),
  ]);
  const remoteTasks = remoteTasksRaw.filter((row) => row.user_id === userId);
  const remoteSubtasks = remoteSubtasksRaw.filter((row) => row.user_id === userId);
  if (remoteTasks.length !== remoteTasksRaw.length || remoteSubtasks.length !== remoteSubtasksRaw.length) {
    throw new Error("Cloud ownership verification failed.");
  }

  const localTaskMap = new Map(localTasks.map((task) => [task.id, task]));
  const remoteTaskMap = new Map(remoteTasks.map((task) => [task.id, task]));
  const taskIds = new Set([...localTaskMap.keys(), ...remoteTaskMap.keys()]);
  const taskInserts: Record<string, unknown>[] = [];
  const taskUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const taskDeletes: string[] = [];
  const survivingTaskIds = new Set<string>();
  let uploaded = 0;
  let downloaded = 0;

  for (const id of taskIds) {
    const local = localTaskMap.get(id) ?? null;
    const remote = remoteTaskMap.get(id) ?? null;
    const decision = chooseVersion({
      localHash: local ? taskHash(local) : null,
      localUpdatedAt: local?.updated_at ?? null,
      remote,
      checkpointHash: checkpoint?.taskHashes[id],
      checkpointRevision: checkpoint?.taskRevisions[id],
    });
    if (decision === "upload" && local) {
      if (remote) taskUpdates.push({ id, payload: taskUpdatePayload(local) });
      else taskInserts.push(taskInsertPayload(local, userId));
      survivingTaskIds.add(id);
      uploaded += 1;
    } else if (decision === "download" && remote && !remote.deleted_at) {
      survivingTaskIds.add(id);
      downloaded += 1;
    } else if (decision === "delete_remote" && remote && !remote.deleted_at) {
      taskDeletes.push(id);
      uploaded += 1;
    }
  }

  const localSubtasks = new Map<string, { row: Subtask; parentId: string; parentUpdatedAt: string }>();
  for (const task of localTasks) {
    for (const subtask of task.subtasks) localSubtasks.set(subtask.id, { row: subtask, parentId: task.id, parentUpdatedAt: task.updated_at });
  }
  const remoteSubtaskMap = new Map(remoteSubtasks.map((subtask) => [subtask.id, subtask]));
  const subtaskIds = new Set([...localSubtasks.keys(), ...remoteSubtaskMap.keys()]);
  const subtaskInserts: Record<string, unknown>[] = [];
  const subtaskUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const subtaskDeletes: string[] = [];

  for (const id of subtaskIds) {
    const local = localSubtasks.get(id) ?? null;
    const remote = remoteSubtaskMap.get(id) ?? null;
    const parentId = local?.parentId ?? remote?.calendar_item_id ?? null;
    if (!parentId || !survivingTaskIds.has(parentId)) {
      if (remote && !remote.deleted_at) subtaskDeletes.push(id);
      continue;
    }
    const decision = chooseVersion({
      localHash: local ? subtaskHash(local.row, local.parentId) : null,
      localUpdatedAt: local?.parentUpdatedAt ?? null,
      remote,
      checkpointHash: checkpoint?.subtaskHashes[id],
      checkpointRevision: checkpoint?.subtaskRevisions[id],
    });
    if (decision === "upload" && local) {
      if (remote) subtaskUpdates.push({ id, payload: subtaskUpdatePayload(local.row, local.parentId) });
      else subtaskInserts.push(subtaskInsertPayload(local.row, userId, local.parentId));
      uploaded += 1;
    } else if (decision === "download" && remote && !remote.deleted_at) {
      downloaded += 1;
    } else if (decision === "delete_remote" && remote && !remote.deleted_at) {
      subtaskDeletes.push(id);
      uploaded += 1;
    }
  }

  await insertInBatches(supabase, "calendar_items", taskInserts);
  await updateRows(supabase, "calendar_items", taskUpdates);
  await insertInBatches(supabase, "subtasks", subtaskInserts);
  await updateRows(supabase, "subtasks", subtaskUpdates);
  await softDeleteRows(supabase, "subtasks", [...new Set(subtaskDeletes)]);
  await softDeleteRows(supabase, "calendar_items", [...new Set(taskDeletes)]);

  const preferenceResult = await syncPreferences(supabase, userId, checkpoint);
  const [finalRemoteTasksRaw, finalRemoteSubtasksRaw] = await Promise.all([
    fetchAllRows<RemoteCalendarItem>(supabase, "calendar_items"),
    fetchAllRows<RemoteSubtask>(supabase, "subtasks"),
  ]);
  const finalRemoteTasks = finalRemoteTasksRaw.filter((row) => row.user_id === userId);
  const finalRemoteSubtasks = finalRemoteSubtasksRaw.filter((row) => row.user_id === userId);
  if (finalRemoteTasks.length !== finalRemoteTasksRaw.length || finalRemoteSubtasks.length !== finalRemoteSubtasksRaw.length) {
    throw new Error("Cloud ownership verification failed after synchronization.");
  }

  const subtasksByParent = new Map<string, Subtask[]>();
  for (const row of finalRemoteSubtasks) {
    if (row.deleted_at) continue;
    const rows = subtasksByParent.get(row.calendar_item_id) ?? [];
    rows.push({ id: row.id, title: row.title, is_completed: row.is_completed, created_at: row.created_at });
    subtasksByParent.set(row.calendar_item_id, rows);
  }
  const tasks = finalRemoteTasks
    .filter((row) => !row.deleted_at)
    .map((row) => ({ ...remoteTaskToLocal(row), subtasks: subtasksByParent.get(row.id) ?? [] }));

  const taskHashes: Record<string, string> = {};
  const taskRevisions: Record<string, number> = {};
  const subtaskHashes: Record<string, string> = {};
  const subtaskRevisions: Record<string, number> = {};
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  for (const row of finalRemoteTasks) {
    taskRevisions[row.id] = row.revision;
    const task = taskById.get(row.id);
    if (task) taskHashes[row.id] = taskHash(task);
  }
  for (const row of finalRemoteSubtasks) {
    subtaskRevisions[row.id] = row.revision;
    if (!row.deleted_at && taskById.has(row.calendar_item_id)) {
      subtaskHashes[row.id] = subtaskHash(row, row.calendar_item_id);
    }
  }

  const nextCheckpoint: CloudSyncCheckpoint = {
    version: 1,
    taskHashes,
    taskRevisions,
    subtaskHashes,
    subtaskRevisions,
    settingsHash: preferencesHash(preferenceResult.preferences),
    settingsRevision: preferenceResult.revision,
    lastSuccessfulAt: new Date().toISOString(),
  };
  return { tasks, checkpoint: nextCheckpoint, uploaded, downloaded, preferences: preferenceResult.preferences };
}

export function parseCloudSyncCheckpoint(value: string | null): CloudSyncCheckpoint | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CloudSyncCheckpoint>;
    if (parsed.version !== 1 || typeof parsed.lastSuccessfulAt !== "string") return null;
    return {
      version: 1,
      taskHashes: parsed.taskHashes && typeof parsed.taskHashes === "object" ? parsed.taskHashes : {},
      taskRevisions: parsed.taskRevisions && typeof parsed.taskRevisions === "object" ? parsed.taskRevisions : {},
      subtaskHashes: parsed.subtaskHashes && typeof parsed.subtaskHashes === "object" ? parsed.subtaskHashes : {},
      subtaskRevisions: parsed.subtaskRevisions && typeof parsed.subtaskRevisions === "object" ? parsed.subtaskRevisions : {},
      settingsHash: typeof parsed.settingsHash === "string" ? parsed.settingsHash : null,
      settingsRevision: typeof parsed.settingsRevision === "number" ? parsed.settingsRevision : null,
      lastSuccessfulAt: parsed.lastSuccessfulAt,
    };
  } catch {
    return null;
  }
}

export const cloudSyncInternals = { chooseVersion, taskHash, subtaskHash, preferencesHash };
