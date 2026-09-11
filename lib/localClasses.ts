"use client";

import { DEFAULT_UNASSIGNED_CLASS_COLOR, nextAvailableCalendarColor, normalizeCalendarColor } from "@/lib/calendarColors";
import { CATEGORY_BASE_COLORS, readLocalPreferences } from "@/lib/preferences";
import type { CalendarClass, CalendarClassDraft, ClassRegistrySnapshot } from "@/types/calendarClass";

export type ClassRegistryResult =
  | { ok: true; classes: CalendarClass[]; unassignedColor: string; count: number }
  | { ok: false; error: string };

export type CalendarClassActionResult =
  | { ok: true; calendarClass: CalendarClass; classes: CalendarClass[]; unassignedColor: string }
  | { ok: false; error: string };

const DATABASE_NAME = "universal-dashboard-local";
const DATABASE_VERSION = 1;
const OBJECT_STORE = "calendar-state";
const STATE_KEY = "classes";
const FALLBACK_KEY = "universal-dashboard-local-classes-v1";
const CHANGE_EVENT = "universal-dashboard:classes-changed";
const CHANGE_CHANNEL = "universal-dashboard-class-changes";
const STORAGE_LOCK = "universal-dashboard-class-storage-write";
const MAX_ACTIVE_CLASSES = 200;
const MAX_STORED_CLASSES = 1_000;
const MAX_ALIASES = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let mutationQueue: Promise<unknown> = Promise.resolve();

function reservedCategoryColors(): string[] {
  try {
    const preferences = readLocalPreferences();
    return [CATEGORY_BASE_COLORS[preferences.colors.orgs], CATEGORY_BASE_COLORS[preferences.colors.social]];
  } catch {
    return [CATEGORY_BASE_COLORS.orange, CATEGORY_BASE_COLORS.purple];
  }
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function cleanTimestamp(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function cleanAliases(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ALIASES) return null;
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const alias = cleanText(item, 120);
    if (!alias) return null;
    const identity = alias.toLocaleUpperCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    aliases.push(alias);
  }
  return aliases;
}

function sanitizeCalendarClass(value: unknown, fallbackColor?: string): CalendarClass | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" && UUID_PATTERN.test(input.id) ? input.id : null;
  const name = cleanText(input.name, 120);
  const aliases = cleanAliases(input.aliases);
  const color = normalizeCalendarColor(input.color) ?? normalizeCalendarColor(fallbackColor);
  if (!id || !name || aliases === null || !color) return null;
  const now = new Date().toISOString();
  return {
    id,
    name,
    course_code: input.course_code === null || input.course_code === undefined || input.course_code === ""
      ? null
      : cleanText(input.course_code, 100)?.toLocaleUpperCase() ?? null,
    aliases,
    color,
    deleted_at: cleanTimestamp(input.deleted_at),
    created_at: cleanTimestamp(input.created_at) ?? now,
    updated_at: cleanTimestamp(input.updated_at) ?? now,
  };
}

export function normalizeClassRegistry(value: unknown, reservedColors: Iterable<string> = []): ClassRegistrySnapshot {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const reserved = new Set([...reservedColors].map(normalizeCalendarColor).filter((color): color is string => Boolean(color)));
  const requestedUnassigned = normalizeCalendarColor(input.unassigned_color) ?? DEFAULT_UNASSIGNED_CLASS_COLOR;
  const unassignedColor = reserved.has(requestedUnassigned)
    ? nextAvailableCalendarColor(reserved)
    : requestedUnassigned;
  const rawClasses = Array.isArray(input.classes) ? input.classes.slice(0, MAX_STORED_CLASSES) : [];
  const classes: CalendarClass[] = [];
  const ids = new Set<string>();
  const activeNames = new Set<string>();
  const activeColors = new Set<string>([...reserved, unassignedColor]);

  for (const rawClass of rawClasses) {
    const calendarClass = sanitizeCalendarClass(rawClass, nextAvailableCalendarColor(activeColors, classes.length));
    if (!calendarClass) continue;
    const nameIdentity = calendarClass.name.toLocaleUpperCase();
    if (ids.has(calendarClass.id) || (!calendarClass.deleted_at && activeNames.has(nameIdentity))) continue;
    ids.add(calendarClass.id);
    if (!calendarClass.deleted_at) {
      activeNames.add(nameIdentity);
      if (activeColors.has(calendarClass.color)) calendarClass.color = nextAvailableCalendarColor(activeColors, classes.length);
      activeColors.add(calendarClass.color);
    }
    classes.push(calendarClass);
  }

  return {
    version: 1,
    classes,
    unassigned_color: unassignedColor,
    updated_at: cleanTimestamp(input.updated_at),
  };
}

function activeClasses(state: ClassRegistrySnapshot): CalendarClass[] {
  return state.classes.filter((calendarClass) => !calendarClass.deleted_at)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local class storage."));
    request.onblocked = () => reject(new Error("Local class storage is blocked by another tab."));
  });
}

async function readIndexedState(): Promise<ClassRegistrySnapshot> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readonly");
      const request = transaction.objectStore(OBJECT_STORE).get(STATE_KEY);
      request.onsuccess = () => resolve(normalizeClassRegistry(request.result));
      request.onerror = () => reject(request.error ?? new Error("Could not read local class storage."));
    });
  } finally {
    database.close();
  }
}

function readFallbackState(): ClassRegistrySnapshot {
  const saved = window.localStorage.getItem(FALLBACK_KEY);
  if (!saved) return normalizeClassRegistry(null);
  try {
    return normalizeClassRegistry(JSON.parse(saved));
  } catch {
    return normalizeClassRegistry(null);
  }
}

function freshestState(indexed: ClassRegistrySnapshot, fallback: ClassRegistrySnapshot): ClassRegistrySnapshot {
  if (indexed.updated_at && fallback.updated_at) return indexed.updated_at >= fallback.updated_at ? indexed : fallback;
  if (indexed.updated_at) return indexed;
  if (fallback.updated_at) return fallback;
  return indexed.classes.length ? indexed : fallback;
}

async function readState(): Promise<ClassRegistrySnapshot> {
  if (typeof window === "undefined") throw new Error("Class storage is only available in your browser.");
  if (typeof indexedDB === "undefined") return readFallbackState();
  try {
    return freshestState(await readIndexedState(), readFallbackState());
  } catch {
    return readFallbackState();
  }
}

async function writeState(value: ClassRegistrySnapshot): Promise<ClassRegistrySnapshot> {
  const state = { ...normalizeClassRegistry(value), updated_at: new Date().toISOString() } satisfies ClassRegistrySnapshot;
  let indexedError: unknown = null;
  try {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE, "readwrite");
        transaction.objectStore(OBJECT_STORE).put(state, STATE_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not save local class storage."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Local class save was cancelled."));
      });
    } finally {
      database.close();
    }
  } catch (error) {
    indexedError = error;
  }
  try {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
  } catch (fallbackError) {
    if (indexedError) throw fallbackError;
  }
  if (indexedError && !window.localStorage.getItem(FALLBACK_KEY)) throw indexedError;
  return state;
}

function announceChange(state: ClassRegistrySnapshot): void {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: state }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANGE_CHANNEL);
    channel.postMessage({ changedAt: Date.now() });
    channel.close();
  }
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

export async function getClassRegistry(includeDeleted = false): Promise<ClassRegistryResult> {
  try {
    const state = await readState();
    const classes = includeDeleted ? [...state.classes] : activeClasses(state);
    return { ok: true, classes, unassignedColor: state.unassigned_color, count: classes.length };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load classes." };
  }
}

export async function getClassRegistrySnapshot(): Promise<ClassRegistrySnapshot> {
  return readState();
}

export function createCalendarClass(input: CalendarClassDraft): Promise<CalendarClassActionResult> {
  return enqueue(async () => {
    try {
      const state = await readState();
      if (activeClasses(state).length >= MAX_ACTIVE_CLASSES) return { ok: false, error: `This calendar has reached its ${MAX_ACTIVE_CLASSES}-class safety limit.` };
      const name = cleanText(input.name, 120);
      if (!name) return { ok: false, error: "Enter a class name of 120 characters or fewer." };
      if (activeClasses(state).some((row) => row.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
        return { ok: false, error: "A class with this name already exists." };
      }
      const usedColors = [state.unassigned_color, ...reservedCategoryColors(), ...activeClasses(state).map((row) => row.color)];
      const requestedColor = input.color ? normalizeCalendarColor(input.color) : null;
      if (input.color && !requestedColor) return { ok: false, error: "Choose a valid class color." };
      if (requestedColor && usedColors.includes(requestedColor)) return { ok: false, error: "Each class needs a different color." };
      const now = new Date().toISOString();
      const calendarClass = sanitizeCalendarClass({
        id: crypto.randomUUID(),
        name,
        course_code: input.course_code ?? null,
        aliases: input.aliases ?? [],
        color: requestedColor ?? nextAvailableCalendarColor(usedColors, state.classes.length),
        deleted_at: null,
        created_at: now,
        updated_at: now,
      });
      if (!calendarClass) return { ok: false, error: "Class details are invalid." };
      const saved = await writeState({ ...state, classes: [...state.classes, calendarClass] });
      announceChange(saved);
      return { ok: true, calendarClass, classes: activeClasses(saved), unassignedColor: saved.unassigned_color };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not create the class." };
    }
  });
}

export function updateCalendarClass(id: string, input: Partial<CalendarClassDraft>): Promise<CalendarClassActionResult> {
  return enqueue(async () => {
    try {
      if (!UUID_PATTERN.test(id)) return { ok: false, error: "Class id is invalid." };
      const state = await readState();
      const index = state.classes.findIndex((row) => row.id === id && !row.deleted_at);
      if (index < 0) return { ok: false, error: "Class not found." };
      const existing = state.classes[index];
      const name = input.name === undefined ? existing.name : cleanText(input.name, 120);
      if (!name) return { ok: false, error: "Enter a class name of 120 characters or fewer." };
      if (activeClasses(state).some((row) => row.id !== id && row.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
        return { ok: false, error: "A class with this name already exists." };
      }
      const aliases = input.aliases === undefined ? existing.aliases : cleanAliases(input.aliases);
      if (aliases === null) return { ok: false, error: `Use no more than ${MAX_ALIASES} valid class aliases.` };
      const courseCode = input.course_code === undefined
        ? existing.course_code
        : input.course_code === null || input.course_code.trim() === ""
          ? null
          : cleanText(input.course_code, 100)?.toLocaleUpperCase();
      if (courseCode === undefined || (input.course_code && !courseCode)) return { ok: false, error: "Course codes must be 100 characters or fewer." };
      const color = input.color === undefined ? existing.color : normalizeCalendarColor(input.color);
      if (!color) return { ok: false, error: "Choose a valid class color." };
      const colorInUse = state.unassigned_color === color || reservedCategoryColors().includes(color) || activeClasses(state).some((row) => row.id !== id && row.color === color);
      if (colorInUse) return { ok: false, error: "Each class needs a different color." };
      const updated = sanitizeCalendarClass({
        ...existing,
        name,
        course_code: courseCode,
        aliases,
        color,
        updated_at: new Date().toISOString(),
      });
      if (!updated) return { ok: false, error: "Class details are invalid." };
      const classes = [...state.classes];
      classes[index] = updated;
      const saved = await writeState({ ...state, classes });
      announceChange(saved);
      return { ok: true, calendarClass: updated, classes: activeClasses(saved), unassignedColor: saved.unassigned_color };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not update the class." };
    }
  });
}

export function archiveCalendarClass(id: string): Promise<CalendarClassActionResult> {
  return enqueue(async () => {
    try {
      if (!UUID_PATTERN.test(id)) return { ok: false, error: "Class id is invalid." };
      const state = await readState();
      const index = state.classes.findIndex((row) => row.id === id && !row.deleted_at);
      if (index < 0) return { ok: false, error: "Class not found." };
      const now = new Date().toISOString();
      const archived = { ...state.classes[index], deleted_at: now, updated_at: now };
      const classes = [...state.classes];
      classes[index] = archived;
      const saved = await writeState({ ...state, classes });
      announceChange(saved);
      return { ok: true, calendarClass: archived, classes: activeClasses(saved), unassignedColor: saved.unassigned_color };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not remove the class." };
    }
  });
}

export function setUnassignedClassColor(value: string): Promise<ClassRegistryResult> {
  return enqueue(async () => {
    try {
      const color = normalizeCalendarColor(value);
      if (!color) return { ok: false, error: "Choose a valid Unassigned color." };
      const state = await readState();
      if (reservedCategoryColors().includes(color) || activeClasses(state).some((row) => row.color === color)) return { ok: false, error: "Unassigned needs a different color from every class and category." };
      const saved = await writeState({ ...state, unassigned_color: color });
      announceChange(saved);
      const classes = activeClasses(saved);
      return { ok: true, classes, unassignedColor: saved.unassigned_color, count: classes.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not update the Unassigned color." };
    }
  });
}

export function replaceClassRegistry(value: unknown): Promise<ClassRegistryResult> {
  return enqueue(async () => {
    try {
      const saved = await writeState(normalizeClassRegistry(value, reservedCategoryColors()));
      announceChange(saved);
      const classes = activeClasses(saved);
      return { ok: true, classes, unassignedColor: saved.unassigned_color, count: classes.length };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not save classes." };
    }
  });
}

export function subscribeClassChanges(listener: () => void): () => void {
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

export const classRegistryInternals = { sanitizeCalendarClass };
