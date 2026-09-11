import { normalizeLocalPreferences, type LocalPreferences } from "@/lib/preferences";
import type { ClassRegistrySnapshot } from "@/types/calendarClass";
import type { Task } from "@/types/task";

export const BACKUP_FORMAT = "universal-dashboard-backup";
export const BACKUP_VERSION = 3;
const PREVIOUS_BACKUP_VERSION = 2;

export interface UniversalDashboardBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exported_at: string;
  tasks: Task[];
  preferences: LocalPreferences;
  class_registry: ClassRegistrySnapshot;
}

export interface ParsedBackup {
  tasks: unknown[];
  preferences: LocalPreferences | null;
  classRegistry: ClassRegistrySnapshot | null;
  isLegacy: boolean;
}

export function createBackupDocument(
  tasks: Task[],
  preferences: LocalPreferences,
  classRegistry: ClassRegistrySnapshot,
  exportedAt = new Date().toISOString(),
): UniversalDashboardBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: exportedAt,
    tasks,
    preferences,
    class_registry: classRegistry,
  };
}

export function parseBackupDocument(value: unknown): ParsedBackup {
  if (Array.isArray(value)) {
    return { tasks: value, preferences: null, classRegistry: null, isLegacy: true };
  }
  if (!value || typeof value !== "object") {
    throw new Error("This file is not a Universal Dashboard backup.");
  }

  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.tasks)) {
    throw new Error("This backup does not contain a calendar item list.");
  }
  if (input.format === undefined) {
    return { tasks: input.tasks, preferences: null, classRegistry: null, isLegacy: true };
  }
  if (input.format !== BACKUP_FORMAT) {
    throw new Error("This backup was created by a different application.");
  }
  if (input.version !== BACKUP_VERSION && input.version !== PREVIOUS_BACKUP_VERSION) {
    throw new Error(`Backup version ${String(input.version)} is not supported by this version of Universal Dashboard.`);
  }
  const preferences = normalizeLocalPreferences(input.preferences);
  if (!preferences) {
    throw new Error("This backup is missing its dashboard preferences.");
  }
  if (input.version === PREVIOUS_BACKUP_VERSION) {
    return { tasks: input.tasks, preferences, classRegistry: null, isLegacy: true };
  }
  if (!input.class_registry || typeof input.class_registry !== "object") {
    throw new Error("This backup is missing its class settings.");
  }
  const classRegistry = input.class_registry as Partial<ClassRegistrySnapshot>;
  if (classRegistry.version !== 1 || !Array.isArray(classRegistry.classes) || typeof classRegistry.unassigned_color !== "string") {
    throw new Error("This backup contains invalid class settings.");
  }
  return { tasks: input.tasks, preferences, classRegistry: classRegistry as ClassRegistrySnapshot, isLegacy: false };
}

export function downloadBackupDocument(backup: UniversalDashboardBackup): void {
  const timestamp = backup.exported_at.replace(/[:.]/g, "-");
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `universal-dashboard-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
