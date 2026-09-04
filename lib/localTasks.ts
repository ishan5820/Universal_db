"use client";

import { addCalendarDays, compareTimes, isCalendarDate } from "@/lib/datetime";
import { expandSeries } from "@/lib/recurrence";
import {
  isTaskCategory,
  isTaskKind,
  isTaskShade,
  isTaskSource,
  isWeekday,
  type NewTask,
  type RecurrenceSpec,
  type Subtask,
  type Task,
  type TaskUpdate,
  type Weekday,
} from "@/types/task";

export type TaskActionResult =
  | { ok: true; task: Task; tasks?: Task[]; count?: number }
  | { ok: false; error: string };

export type TaskDraft = Partial<NewTask> & Pick<NewTask, "title">;

export type TaskListActionResult =
  | { ok: true; tasks: Task[]; count: number }
  | { ok: false; error: string };

export type TaskMergeActionResult =
  | { ok: true; tasks: Task[]; inserted: Task[]; updated: Task[]; unchanged: number; count: number }
  | { ok: false; error: string };

type StoredState = { version: 1; tasks: Task[]; updated_at?: string | null };

const DATABASE_NAME = "universal-dashboard-local";
const DATABASE_VERSION = 1;
const OBJECT_STORE = "calendar-state";
const STATE_KEY = "tasks";
const FALLBACK_KEY = "universal-dashboard-local-state-v1";
const CHANGE_EVENT = "universal-dashboard:tasks-changed";
const CHANGE_CHANNEL = "universal-dashboard-task-changes";
const STORAGE_LOCK = "universal-dashboard-storage-write";
const MAX_TASKS = 10_000;

let mutationQueue: Promise<unknown> = Promise.resolve();
let persistenceRequested = false;

function cleanText(value: unknown, nullable = true): string | null {
  if (typeof value !== "string") return nullable ? null : "";
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned || (nullable ? null : "");
}

function cleanDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && isCalendarDate(value) ? value : null;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function sanitizeSubtasks(value: unknown): Subtask[] | string {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return "Subtasks must be a list.";
  if (value.length > 50) return "A task can contain at most 50 subtasks.";
  const now = new Date().toISOString();
  const rows: Subtask[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return "A subtask is invalid.";
    const input = item as Record<string, unknown>;
    const title = cleanText(input.title, false);
    if (!title) return "Every subtask needs a title.";
    if (title.length > 180) return "Subtask titles must be 180 characters or fewer.";
    rows.push({
      id: typeof input.id === "string" && input.id.length > 0 ? input.id : newId(),
      title,
      is_completed: Boolean(input.is_completed),
      created_at: typeof input.created_at === "string" && !Number.isNaN(Date.parse(input.created_at))
        ? input.created_at
        : now,
    });
  }
  return rows;
}

function sanitizeNewTask(value: unknown): NewTask | string {
  if (!value || typeof value !== "object") return "Task data is required.";
  const input = value as Record<string, unknown>;
  const title = cleanText(input.title, false);
  if (!title) return "Title is required.";
  const category = input.category ?? "classes";
  const source = input.source ?? "manual";
  const kind = input.kind ?? "task";
  if (!isTaskCategory(category)) return "Choose a valid category.";
  if (!isTaskSource(source)) return "Choose a valid source.";
  if (!isTaskKind(kind)) return "Choose a valid task kind.";
  const dueDate = cleanDate(input.due_date);
  if (input.due_date && !dueDate) return "Due date must be YYYY-MM-DD.";
  const isCompleted = Boolean(input.is_completed);
  if (kind === "event" && isCompleted) return "Events cannot be completed.";
  const subtasks = sanitizeSubtasks(input.subtasks);
  if (typeof subtasks === "string") return subtasks;
  if (kind === "event" && subtasks.length) return "Events cannot contain subtasks.";
  return {
    canvas_uid: cleanText(input.canvas_uid),
    title,
    description: cleanText(input.description),
    due_date: dueDate,
    due_time: cleanText(input.due_time),
    location: cleanText(input.location),
    category,
    course_code: cleanText(input.course_code)?.toUpperCase() ?? null,
    is_pinned: Boolean(input.is_pinned),
    is_completed: isCompleted,
    source,
    kind,
    color_shade: isTaskShade(input.color_shade) ? input.color_shade : 3,
    end_time: kind === "event" ? cleanText(input.end_time) : null,
    series_id: cleanText(input.series_id),
    recurrence_rule: cleanText(input.recurrence_rule),
    series_until: cleanDate(input.series_until),
    import_batch_id: cleanText(input.import_batch_id),
    subtasks,
  };
}

function sanitizePatch(value: unknown, existing: Task): TaskUpdate | string {
  if (!value || typeof value !== "object") return "Task changes are required.";
  const input = value as Record<string, unknown>;
  const merged = sanitizeNewTask({ ...existing, ...input });
  if (typeof merged === "string") return merged;
  const allowed = new Set<keyof NewTask>([
    "title", "description", "due_date", "due_time", "location", "category", "course_code", "is_pinned",
    "is_completed", "source", "kind", "end_time", "series_id", "recurrence_rule", "series_until",
    "import_batch_id", "subtasks", "canvas_uid", "color_shade",
  ]);
  return Object.fromEntries(
    Object.keys(input)
      .filter((key) => allowed.has(key as keyof NewTask))
      .map((key) => [key, merged[key as keyof NewTask]]),
  ) as TaskUpdate;
}

function normalizeTask(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const sanitized = sanitizeNewTask(input);
  if (typeof sanitized === "string") return null;
  const now = new Date().toISOString();
  return {
    ...sanitized,
    location: sanitized.location ?? null,
    subtasks: sanitized.subtasks ?? [],
    id: typeof input.id === "string" && input.id.length > 0 ? input.id : newId(),
    created_at: typeof input.created_at === "string" && !Number.isNaN(Date.parse(input.created_at))
      ? input.created_at
      : now,
    updated_at: typeof input.updated_at === "string" && !Number.isNaN(Date.parse(input.updated_at))
      ? input.updated_at
      : now,
  };
}

function normalizeState(value: unknown): StoredState {
  const rawTasks = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { tasks?: unknown }).tasks)
      ? (value as { tasks: unknown[] }).tasks
      : [];
  const tasks: Task[] = [];
  const ids = new Set<string>();
  const canvasUids = new Set<string>();
  for (const rawTask of rawTasks.slice(0, MAX_TASKS)) {
    const task = normalizeTask(rawTask);
    if (!task || ids.has(task.id) || (task.canvas_uid && canvasUids.has(task.canvas_uid))) continue;
    ids.add(task.id);
    if (task.canvas_uid) canvasUids.add(task.canvas_uid);
    tasks.push(task);
  }
  const updatedAt = value && typeof value === "object" && typeof (value as { updated_at?: unknown }).updated_at === "string"
    && !Number.isNaN(Date.parse((value as { updated_at: string }).updated_at))
    ? (value as { updated_at: string }).updated_at
    : null;
  return { version: 1, tasks, updated_at: updatedAt };
}

function freshestState(indexed: StoredState, fallback: StoredState): StoredState {
  if (indexed.updated_at && fallback.updated_at) {
    return indexed.updated_at >= fallback.updated_at ? indexed : fallback;
  }
  if (indexed.updated_at) return indexed;
  if (fallback.updated_at) return fallback;
  return indexed.tasks.length > 0 ? indexed : fallback;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    if (left.due_date === null && right.due_date !== null) return 1;
    if (left.due_date !== null && right.due_date === null) return -1;
    const dateOrder = (left.due_date ?? "").localeCompare(right.due_date ?? "");
    if (dateOrder !== 0) return dateOrder;
    const timeOrder = compareTimes(left.due_time, right.due_time);
    if (timeOrder !== 0) return timeOrder;
    return left.created_at.localeCompare(right.created_at);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local calendar storage."));
    request.onblocked = () => reject(new Error("Local calendar storage is blocked by another tab."));
  });
}

async function readIndexedState(): Promise<StoredState> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readonly");
      const request = transaction.objectStore(OBJECT_STORE).get(STATE_KEY);
      request.onsuccess = () => resolve(normalizeState(request.result));
      request.onerror = () => reject(request.error ?? new Error("Could not read local calendar storage."));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedState(state: StoredState): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      transaction.objectStore(OBJECT_STORE).put(state, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save local calendar storage."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local calendar save was cancelled."));
    });
  } finally {
    database.close();
  }
}

function readFallbackState(): StoredState {
  const saved = window.localStorage.getItem(FALLBACK_KEY);
  if (!saved) return { version: 1, tasks: [], updated_at: null };
  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    return { version: 1, tasks: [], updated_at: null };
  }
}

async function readState(): Promise<StoredState> {
  if (typeof window === "undefined") {
    throw new Error("Local calendar storage is only available in your browser.");
  }
  if (typeof indexedDB === "undefined") return readFallbackState();
  try {
    const indexed = await readIndexedState();
    const fallback = readFallbackState();
    return freshestState(indexed, fallback);
  } catch {
    return readFallbackState();
  }
}

async function writeState(state: StoredState): Promise<void> {
  const normalized = { ...normalizeState(state), updated_at: new Date().toISOString() } satisfies StoredState;
  let indexedError: unknown = null;
  try {
    await writeIndexedState(normalized);
  } catch (error) {
    indexedError = error;
  }
  try {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(normalized));
  } catch (fallbackError) {
    if (indexedError) throw fallbackError;
  }
  if (indexedError && !window.localStorage.getItem(FALLBACK_KEY)) throw indexedError;
}

function announceChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANGE_CHANNEL);
    channel.postMessage({ changedAt: Date.now() });
    channel.close();
  }
}

function requestPersistentStorage(): void {
  if (persistenceRequested) return;
  persistenceRequested = true;
  void navigator.storage?.persist?.().catch(() => false);
}

export function subscribeTaskChanges(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const localListener = () => listener();
  window.addEventListener(CHANGE_EVENT, localListener);
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANGE_CHANNEL) : null;
  if (channel) channel.onmessage = localListener;
  return () => {
    window.removeEventListener(CHANGE_EVENT, localListener);
    channel?.close();
  };
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const serializeInTab = () => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request<Promise<T>>(STORAGE_LOCK, serializeInTab) as unknown as Promise<T>;
  }
  return serializeInTab();
}

function createTaskRow(row: NewTask): Task {
  const now = new Date().toISOString();
  return { ...row, location: row.location ?? null, subtasks: row.subtasks ?? [], id: newId(), created_at: now, updated_at: now };
}

function duplicateCanvasUid(tasks: Task[], canvasUid: string | null, excludeId?: string): boolean {
  return Boolean(canvasUid && tasks.some((task) => task.id !== excludeId && task.canvas_uid === canvasUid));
}

export async function getAllTasks(): Promise<TaskListActionResult> {
  try {
    requestPersistentStorage();
    const state = await readState();
    const tasks = sortTasks(state.tasks);
    return { ok: true, tasks, count: tasks.length };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load organizer data." };
  }
}

export function validateBackupTasks(input: unknown[]): TaskListActionResult {
  if (!Array.isArray(input)) return { ok: false, error: "The backup calendar item list is invalid." };
  if (input.length > MAX_TASKS) {
    return { ok: false, error: `A backup can contain at most ${MAX_TASKS.toLocaleString()} calendar items.` };
  }
  const normalized = normalizeState({ version: 1, tasks: input });
  if (normalized.tasks.length !== input.length) {
    return { ok: false, error: "One or more backup rows are invalid or duplicated." };
  }
  const tasks = sortTasks(normalized.tasks);
  return { ok: true, tasks, count: tasks.length };
}

function backupIdentity(task: Task): string {
  return [
    task.kind,
    task.category,
    task.title.trim().toLocaleLowerCase(),
    task.due_date ?? "",
    task.due_time ?? "",
    task.end_time ?? "",
    task.course_code?.trim().toLocaleUpperCase() ?? "",
    task.series_id ?? "",
  ].join("\u001f");
}

export function mergeTasksFromBackup(input: unknown[]): Promise<TaskMergeActionResult> {
  return enqueue(async () => {
    try {
      const checked = validateBackupTasks(input);
      if (!checked.ok) return checked;
      const state = await readState();
      const tasks = [...state.tasks];

      const byId = new Map<string, number>();
      const byCanvasUid = new Map<string, number>();
      const byIdentity = new Map<string, number>();
      const remember = (task: Task, index: number) => {
        byId.set(task.id, index);
        if (task.canvas_uid) byCanvasUid.set(task.canvas_uid, index);
        if (!byIdentity.has(backupIdentity(task))) byIdentity.set(backupIdentity(task), index);
      };
      const forget = (task: Task, index: number) => {
        if (byId.get(task.id) === index) byId.delete(task.id);
        if (task.canvas_uid && byCanvasUid.get(task.canvas_uid) === index) byCanvasUid.delete(task.canvas_uid);
        if (byIdentity.get(backupIdentity(task)) === index) byIdentity.delete(backupIdentity(task));
      };
      tasks.forEach(remember);

      const inserted: Task[] = [];
      const updated: Task[] = [];
      let unchanged = 0;
      for (const incoming of checked.tasks) {
        const idIndex = byId.get(incoming.id);
        const canvasIndex = incoming.canvas_uid ? byCanvasUid.get(incoming.canvas_uid) : undefined;
        if (idIndex !== undefined && canvasIndex !== undefined && idIndex !== canvasIndex) {
          return { ok: false, error: `The backup contains a conflicting calendar identifier for “${incoming.title}”.` };
        }
        const index = idIndex ?? canvasIndex ?? byIdentity.get(backupIdentity(incoming));
        if (index === undefined) {
          if (tasks.length >= MAX_TASKS) {
            return { ok: false, error: `This calendar has reached its ${MAX_TASKS.toLocaleString()}-item safety limit.` };
          }
          tasks.push(incoming);
          inserted.push(incoming);
          remember(incoming, tasks.length - 1);
          continue;
        }

        const existing = tasks[index];
        if (Date.parse(incoming.updated_at) <= Date.parse(existing.updated_at)) {
          unchanged += 1;
          continue;
        }
        const replacement = incoming.id === existing.id
          ? incoming
          : { ...incoming, id: existing.id, created_at: existing.created_at };
        forget(existing, index);
        tasks[index] = replacement;
        remember(replacement, index);
        updated.push(replacement);
      }

      await writeState({ version: 1, tasks });
      announceChange();
      return { ok: true, tasks: sortTasks(tasks), inserted, updated, unchanged, count: tasks.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not restore the calendar backup." };
    }
  });
}

export function replaceTasksFromCloud(input: Task[]): Promise<TaskListActionResult> {
  return enqueue(async () => {
    try {
      if (!Array.isArray(input) || input.length > MAX_TASKS) {
        return { ok: false, error: `Cloud calendar data exceeds the ${MAX_TASKS.toLocaleString()}-item safety limit.` };
      }
      const normalized = normalizeState({ version: 1, tasks: input });
      if (normalized.tasks.length !== input.length) {
        return { ok: false, error: "Cloud calendar data failed local validation." };
      }
      await writeState(normalized);
      announceChange();
      const tasks = sortTasks(normalized.tasks);
      return { ok: true, tasks, count: tasks.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not save cloud calendar data locally." };
    }
  });
}

export function createTask(input: TaskDraft): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      const row = sanitizeNewTask(input);
      if (typeof row === "string") return { ok: false, error: row };
      const state = await readState();
      if (duplicateCanvasUid(state.tasks, row.canvas_uid)) return { ok: false, error: "This calendar item already exists." };
      if (state.tasks.length >= MAX_TASKS) return { ok: false, error: `This calendar has reached its ${MAX_TASKS.toLocaleString()}-item safety limit.` };
      const task = createTaskRow(row);
      await writeState({ version: 1, tasks: [...state.tasks, task] });
      announceChange();
      return { ok: true, task };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not create the task." };
    }
  });
}

export function updateTask(id: string, input: TaskUpdate): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      if (!id) return { ok: false, error: "Task id is required." };
      const state = await readState();
      const index = state.tasks.findIndex((task) => task.id === id);
      if (index < 0) return { ok: false, error: "Task not found." };
      const existing = state.tasks[index];
      const patch = sanitizePatch(input, existing);
      if (typeof patch === "string") return { ok: false, error: patch };
      const nextTask: Task = { ...existing, ...patch, updated_at: new Date().toISOString() };
      if (duplicateCanvasUid(state.tasks, nextTask.canvas_uid, id)) return { ok: false, error: "This calendar item already exists." };
      const tasks = [...state.tasks];
      tasks[index] = nextTask;
      await writeState({ version: 1, tasks });
      announceChange();
      return { ok: true, task: nextTask };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not update the task." };
    }
  });
}

export async function toggleComplete(id: string, completed: boolean): Promise<TaskActionResult> {
  const result = await getAllTasks();
  const existing = result.ok ? result.tasks.find((task) => task.id === id) : null;
  if (!existing) return { ok: false, error: "Task not found." };
  if (existing.kind === "event") return { ok: false, error: "Events cannot be completed." };
  return updateTask(id, { is_completed: Boolean(completed) });
}

export function togglePin(id: string, pinned: boolean): Promise<TaskActionResult> {
  return updateTask(id, { is_pinned: Boolean(pinned) });
}

export function addSubtask(taskId: string, titleInput: string): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      const state = await readState();
      const index = state.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) return { ok: false, error: "Task not found." };
      const existing = state.tasks[index];
      if (existing.kind !== "task") return { ok: false, error: "Only tasks can contain subtasks." };
      const title = cleanText(titleInput, false);
      if (!title) return { ok: false, error: "Enter a subtask title." };
      if (title.length > 180) return { ok: false, error: "Subtask titles must be 180 characters or fewer." };
      if (existing.subtasks.length >= 50) return { ok: false, error: "This task already has 50 subtasks." };
      const task = { ...existing, subtasks: [...existing.subtasks, { id: newId(), title, is_completed: false, created_at: new Date().toISOString() }], updated_at: new Date().toISOString() };
      const tasks = [...state.tasks]; tasks[index] = task;
      await writeState({ version: 1, tasks }); announceChange();
      return { ok: true, task };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not add the subtask." };
    }
  });
}

export function toggleSubtask(taskId: string, subtaskId: string, completed: boolean): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      const state = await readState();
      const index = state.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) return { ok: false, error: "Task not found." };
      const existing = state.tasks[index];
      if (!existing.subtasks.some((subtask) => subtask.id === subtaskId)) return { ok: false, error: "Subtask not found." };
      const task = { ...existing, subtasks: existing.subtasks.map((subtask) => subtask.id === subtaskId ? { ...subtask, is_completed: Boolean(completed) } : subtask), updated_at: new Date().toISOString() };
      const tasks = [...state.tasks]; tasks[index] = task;
      await writeState({ version: 1, tasks }); announceChange();
      return { ok: true, task };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not update the subtask." };
    }
  });
}

export function deleteSubtask(taskId: string, subtaskId: string): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      const state = await readState();
      const index = state.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) return { ok: false, error: "Task not found." };
      const existing = state.tasks[index];
      if (!existing.subtasks.some((subtask) => subtask.id === subtaskId)) return { ok: false, error: "Subtask not found." };
      const task = { ...existing, subtasks: existing.subtasks.filter((subtask) => subtask.id !== subtaskId), updated_at: new Date().toISOString() };
      const tasks = [...state.tasks]; tasks[index] = task;
      await writeState({ version: 1, tasks }); announceChange();
      return { ok: true, task };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not delete the subtask." };
    }
  });
}

export function deleteTask(id: string): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      const state = await readState();
      const existing = state.tasks.find((task) => task.id === id);
      if (!existing) return { ok: false, error: "Task not found." };
      await writeState({ version: 1, tasks: state.tasks.filter((task) => task.id !== id) });
      announceChange();
      return { ok: true, task: existing };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not delete the task." };
    }
  });
}

export function deleteTasks(ids: string[]): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      const uniqueIds = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
      if (!uniqueIds.length || uniqueIds.length > 500) return { ok: false, error: "Choose between 1 and 500 tasks to delete." };
      const state = await readState();
      const selected = new Set(uniqueIds);
      const deleted = state.tasks.filter((task) => selected.has(task.id));
      if (!deleted.length) return { ok: false, error: "No tasks were deleted." };
      await writeState({ version: 1, tasks: state.tasks.filter((task) => !selected.has(task.id)) });
      announceChange();
      return { ok: true, task: deleted[0], tasks: deleted, count: deleted.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not delete the selected tasks." };
    }
  });
}

export function deleteImportBatch(batchId: string): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
        return { ok: false, error: "Import batch id is invalid." };
      }
      const state = await readState();
      const deleted = state.tasks.filter((task) => task.import_batch_id === batchId);
      if (!deleted.length) return { ok: false, error: "No rows from this import remain." };
      await writeState({ version: 1, tasks: state.tasks.filter((task) => task.import_batch_id !== batchId) });
      announceChange();
      return { ok: true, task: deleted[0], tasks: deleted, count: deleted.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not undo this import." };
    }
  });
}

export function bulkCreateTasks(input: TaskDraft[]): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      if (!Array.isArray(input) || input.length === 0 || input.length > 500) return { ok: false, error: "Provide between 1 and 500 tasks." };
      const rows: NewTask[] = [];
      for (const item of input) {
        const row = sanitizeNewTask(item);
        if (typeof row === "string") return { ok: false, error: row };
        rows.push(row);
      }
      const state = await readState();
      if (state.tasks.length + rows.length > MAX_TASKS) return { ok: false, error: `This calendar has reached its ${MAX_TASKS.toLocaleString()}-item safety limit.` };
      const existingUids = new Set(state.tasks.map((task) => task.canvas_uid).filter(Boolean));
      const batchUids = new Set<string>();
      for (const row of rows) {
        if (!row.canvas_uid) continue;
        if (existingUids.has(row.canvas_uid) || batchUids.has(row.canvas_uid)) return { ok: false, error: "One or more calendar items already exist." };
        batchUids.add(row.canvas_uid);
      }
      const created = rows.map(createTaskRow);
      await writeState({ version: 1, tasks: [...state.tasks, ...created] });
      announceChange();
      return { ok: true, task: created[0], tasks: created, count: created.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not create the tasks." };
    }
  });
}

function validateRecurrenceSpec(value: RecurrenceSpec): string | null {
  if (!value.title.trim()) return "Title is required.";
  if (!isTaskCategory(value.category) || !isTaskKind(value.kind)) return "Recurring item settings are invalid.";
  if (!isCalendarDate(value.startDate) || !isCalendarDate(value.untilDate)) return "Start and end dates are required.";
  if (!Array.isArray(value.byDay) || !value.byDay.every(isWeekday)) return "Choose valid weekdays.";
  if (!isTaskShade(value.colorShade)) return "Choose a valid color shade.";
  return null;
}

export async function createSeries(spec: RecurrenceSpec): Promise<TaskActionResult> {
  try {
    const validation = validateRecurrenceSpec(spec);
    if (validation) return { ok: false, error: validation };
    const rows = expandSeries(spec, newId());
    if (!rows.length) return { ok: false, error: "The recurrence does not produce any dates." };
    return bulkCreateTasks(rows);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not create the series." };
  }
}

export function updateSeries(seriesId: string, occurrenceId: string, input: TaskUpdate, scope: "one" | "all"): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      if (!seriesId || !occurrenceId || !["one", "all"].includes(scope)) return { ok: false, error: "Series update request is invalid." };
      const state = await readState();
      const existing = state.tasks.find((task) => task.id === occurrenceId);
      if (!existing || existing.series_id !== seriesId) return { ok: false, error: "Series occurrence not found." };
      const patch = sanitizePatch(input, existing);
      if (typeof patch === "string") return { ok: false, error: patch };
      const { due_date: _occurrenceDate, ...seriesPatch } = patch;
      void _occurrenceDate;
      const now = new Date().toISOString();
      const updated = state.tasks.map((task) => {
        if (scope === "one" && task.id === occurrenceId) {
          return { ...task, ...patch, series_id: null, recurrence_rule: null, series_until: null, updated_at: now };
        }
        if (scope === "all" && task.series_id === seriesId) return { ...task, ...seriesPatch, updated_at: now };
        return task;
      });
      const changed = updated.filter((task, index) => task !== state.tasks[index]);
      if (!changed.length) return { ok: false, error: "Series was not updated." };
      await writeState({ version: 1, tasks: updated });
      announceChange();
      return { ok: true, task: changed[0], tasks: changed, count: changed.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not update the series." };
    }
  });
}

export async function deleteSeries(seriesId: string, occurrenceId: string, scope: "one" | "all"): Promise<TaskActionResult> {
  if (scope === "one") return deleteTask(occurrenceId);
  return enqueue(async () => {
    try {
      const state = await readState();
      const existing = state.tasks.find((task) => task.id === occurrenceId);
      if (!existing || existing.series_id !== seriesId) return { ok: false, error: "Series occurrence not found." };
      const deleted = state.tasks.filter((task) => task.series_id === seriesId);
      await writeState({ version: 1, tasks: state.tasks.filter((task) => task.series_id !== seriesId) });
      announceChange();
      return { ok: true, task: deleted[0], tasks: deleted, count: deleted.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not delete the series." };
    }
  });
}

export function extendSeries(seriesId: string, newUntil: string): Promise<TaskActionResult> {
  return enqueue(async () => {
    try {
      if (!seriesId || !isCalendarDate(newUntil)) return { ok: false, error: "Choose a valid new end date." };
      const state = await readState();
      const rows = state.tasks.filter((task) => task.series_id === seriesId)
        .sort((left, right) => (right.due_date ?? "").localeCompare(left.due_date ?? ""));
      if (!rows.length) return { ok: false, error: "Series not found." };
      const sample = rows[0];
      const previousUntil = sample.series_until ?? sample.due_date;
      if (!previousUntil || newUntil <= previousUntil) return { ok: false, error: "The new end date must be after the current end date." };
      const byDay = (sample.recurrence_rule?.match(/BYDAY=([^;]+)/)?.[1]?.split(",") ?? []).filter(isWeekday) as Weekday[];
      const generated = expandSeries({
        title: sample.title,
        description: sample.description,
        location: sample.location,
        category: sample.category,
        courseCode: sample.course_code,
        kind: sample.kind,
        colorShade: sample.color_shade,
        byDay,
        startDate: addCalendarDays(previousUntil, 1),
        untilDate: newUntil,
        startTime: sample.due_time,
        endTime: sample.end_time,
      }, seriesId);
      if (!generated.length) return { ok: false, error: "The extension does not produce any dates." };
      if (state.tasks.length + generated.length > MAX_TASKS) return { ok: false, error: `This calendar has reached its ${MAX_TASKS.toLocaleString()}-item safety limit.` };
      const created = generated.map(createTaskRow);
      const now = new Date().toISOString();
      const tasks = state.tasks.map((task) => task.series_id === seriesId ? { ...task, series_until: newUntil, updated_at: now } : task);
      await writeState({ version: 1, tasks: [...tasks, ...created] });
      announceChange();
      return { ok: true, task: created[0], tasks: created, count: created.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not extend the series." };
    }
  });
}
