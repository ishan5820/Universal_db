"use client";

import { archiveCalendarClass } from "@/lib/localClasses";
import { assignTaskClasses, getAllTasks } from "@/lib/localTasks";
import type { Task } from "@/types/task";

export type RemoveManagedClassResult =
  | { ok: true; unassignedCount: number }
  | { ok: false; error: string; unassignedCount: number };

export function countClassAssignments(tasks: readonly Pick<Task, "category" | "class_id">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.category !== "classes" || !task.class_id) continue;
    counts.set(task.class_id, (counts.get(task.class_id) ?? 0) + 1);
  }
  return counts;
}

export async function removeManagedClass(classId: string): Promise<RemoveManagedClassResult> {
  const before = await getAllTasks();
  if (!before.ok) return { ok: false, error: before.error, unassignedCount: 0 };
  const attached = before.tasks.filter((task) => task.category === "classes" && task.class_id === classId);
  if (attached.length) {
    const unassigned = await assignTaskClasses(attached.map((task) => ({ taskId: task.id, classId: null })));
    if (!unassigned.ok) return { ok: false, error: unassigned.error, unassignedCount: 0 };
  }

  const archived = await archiveCalendarClass(classId);
  if (!archived.ok) {
    return {
      ok: false,
      error: `${archived.error}${attached.length ? " Its calendar items were safely moved to Unassigned, but the class itself remains available." : ""}`,
      unassignedCount: attached.length,
    };
  }

  // Catch an assignment made in another tab between the first read and the archive.
  const after = await getAllTasks();
  if (!after.ok) return { ok: false, error: after.error, unassignedCount: attached.length };
  const lateAttachments = after.tasks.filter((task) => task.category === "classes" && task.class_id === classId);
  if (lateAttachments.length) {
    const unassigned = await assignTaskClasses(lateAttachments.map((task) => ({ taskId: task.id, classId: null })));
    if (!unassigned.ok) return { ok: false, error: unassigned.error, unassignedCount: attached.length };
  }
  return { ok: true, unassignedCount: attached.length + lateAttachments.length };
}
