import { findMatch } from "@/lib/matchTasks";
import type { NewTask, Task } from "@/types/task";

export interface SyncDiff {
  field: "title" | "description" | "due_date" | "due_time" | "location" | "canvas_uid" | "source";
  from: string | null;
  to: string | null;
}

export type IncomingTask = NewTask & { canvas_uid: string };

export interface SyncAction {
  actionId: string;
  keepBothActionId?: string;
  type: "create" | "update" | "adopt";
  defaultApproved: boolean;
  incoming: IncomingTask;
  existing?: Task;
  diff: SyncDiff[];
  score?: number;
  confidence?: "high" | "low";
}

export interface SyncPlan {
  planId: string;
  planHash: string;
  expandedRecurrences: number;
  truncated: boolean;
  counts: { create: number; update: number; adopt: number; unchanged: number };
  actions: SyncAction[];
  skipped: { noUid: number; noSummary: number; cancelled: number };
}

export interface ParsedCalendar {
  items: IncomingTask[];
  expandedRecurrences: number;
  truncated: boolean;
  skipped: SyncPlan["skipped"];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Deterministic, non-cryptographic identifier used only to recognize a changed preview. */
export function digest(value: unknown): string {
  const input = stable(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

const canvasFields = ["title", "description", "due_date", "due_time", "location"] as const;

function canvasDiff(existing: Task, incoming: IncomingTask): SyncDiff[] {
  return canvasFields.flatMap((field) => {
    if (field === "description" && !incoming.description) return [];
    const incomingValue = incoming[field] ?? null;
    return existing[field] === incomingValue ? [] : [{ field, from: existing[field], to: incomingValue }];
  });
}

export function buildSyncPlan(parsed: ParsedCalendar, linked: Task[], unlinked: Task[]): SyncPlan {
  const linkedByUid = new Map(linked.filter((row) => row.canvas_uid).map((row) => [row.canvas_uid, row]));
  const consumed = new Set<string>();
  const actions: SyncAction[] = [];
  let unchanged = 0;

  for (const incoming of parsed.items) {
    const existing = linkedByUid.get(incoming.canvas_uid);
    let action: Omit<SyncAction, "actionId">;
    if (existing) {
      const diff = canvasDiff(existing, incoming);
      if (!diff.length) {
        unchanged += 1;
        continue;
      }
      action = { type: "update", defaultApproved: true, incoming, existing, diff };
    } else {
      const match = findMatch(incoming, unlinked.filter((row) => !consumed.has(row.id)));
      if (match) {
        consumed.add(match.row.id);
        const diff: SyncDiff[] = [
          ...canvasDiff(match.row, incoming),
          { field: "canvas_uid", from: null, to: incoming.canvas_uid },
          ...(match.row.source === "ical" ? [] : [{ field: "source" as const, from: match.row.source, to: "ical" }]),
        ];
        action = {
          type: "adopt",
          defaultApproved: match.confidence === "high",
          incoming,
          existing: match.row,
          diff,
          score: match.score,
          confidence: match.confidence,
        };
      } else {
        action = { type: "create", defaultApproved: true, incoming, diff: [] };
      }
    }
    const actionId = digest({ type: action.type, uid: incoming.canvas_uid, existingId: action.existing?.id ?? null, incoming });
    actions.push({
      ...action,
      actionId,
      ...(action.type === "adopt" ? { keepBothActionId: digest({ actionId, alternative: "keep-both" }) } : {}),
    });
  }

  const counts = {
    create: actions.filter((action) => action.type === "create").length,
    update: actions.filter((action) => action.type === "update").length,
    adopt: actions.filter((action) => action.type === "adopt").length,
    unchanged,
  };
  const affected = [...linked, ...unlinked.filter((row) => consumed.has(row.id))]
    .map(({ id, updated_at }) => ({ id, updated_at }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    planId: digest(parsed.items),
    planHash: digest(affected),
    expandedRecurrences: parsed.expandedRecurrences,
    truncated: parsed.truncated,
    counts,
    actions,
    skipped: parsed.skipped,
  };
}

export function applyActionToRow(action: SyncAction): NewTask | (NewTask & { id: string }) {
  if (action.type === "create") return action.incoming;
  const existing = action.existing;
  if (!existing) throw new Error(`Action ${action.actionId} is missing its existing row.`);
  return {
    ...existing,
    title: action.incoming.title,
    description: action.incoming.description || existing.description,
    due_date: action.incoming.due_date,
    due_time: action.incoming.due_time,
    location: action.incoming.location,
    canvas_uid: action.type === "adopt" ? action.incoming.canvas_uid : existing.canvas_uid,
    source: action.type === "adopt" ? "ical" : existing.source,
  };
}
