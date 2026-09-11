"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle, Sparkles, X } from "lucide-react";
import { buildClassDetectionPlan, type ClassDetectionPlan } from "@/lib/classDetection";
import { createCalendarClass, getClassRegistry } from "@/lib/localClasses";
import { assignTaskClasses, getAllTasks } from "@/lib/localTasks";
import type { CalendarClass } from "@/types/calendarClass";

interface ClassDetectionReviewProps {
  open: boolean;
  onClose: () => void;
}

type ReviewState = {
  plan: ClassDetectionPlan;
  classes: CalendarClass[];
};

type ApplySummary = {
  createdClasses: number;
  assignedItems: number;
  leftUnassigned: number;
};

const SKIP_TARGET = "unassigned";
const NEW_TARGET = "new";

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase();
}

export function ClassDetectionReview({ open, onClose }: ClassDetectionReviewProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<ApplySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    setReview(null);
    setTargets({});
    setNames({});
    setExpanded(new Set());
    setSummary(null);
    setError(null);
    onClose();
  }, [busy, onClose]);

  const loadReview = useCallback(async (message?: string) => {
    setBusy(true);
    setError(message ?? null);
    setSummary(null);
    const [taskResult, classResult] = await Promise.all([getAllTasks(), getClassRegistry(true)]);
    if (!taskResult.ok || !classResult.ok) {
      setError(!taskResult.ok ? taskResult.error : classResult.ok ? "Could not load classes." : classResult.error);
      setBusy(false);
      return;
    }
    const activeClasses = classResult.classes.filter((calendarClass) => !calendarClass.deleted_at);
    const plan = buildClassDetectionPlan(taskResult.tasks, classResult.classes);
    setReview({ plan, classes: activeClasses });
    setTargets(Object.fromEntries(plan.candidates.map((candidate) => [
      candidate.key,
      candidate.ambiguousClassIds.length ? SKIP_TARGET : candidate.existingClassId ?? NEW_TARGET,
    ])));
    setNames(Object.fromEntries(plan.candidates.map((candidate) => [candidate.key, candidate.suggestedName])));
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadReview(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReview, open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    requestAnimationFrame(() => dialog?.querySelector<HTMLElement>("button,select,input")?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, [close, open]);

  const selectedItemCount = useMemo(() => review?.plan.candidates.reduce((count, candidate) => (
    targets[candidate.key] && targets[candidate.key] !== SKIP_TARGET ? count + candidate.taskIds.length : count
  ), 0) ?? 0, [review, targets]);

  const applyReview = async () => {
    if (!review || selectedItemCount === 0) return;
    setBusy(true);
    setError(null);

    const [freshTasks, freshClasses] = await Promise.all([getAllTasks(), getClassRegistry(true)]);
    if (!freshTasks.ok || !freshClasses.ok) {
      setError(!freshTasks.ok ? freshTasks.error : freshClasses.ok ? "Could not load classes." : freshClasses.error);
      setBusy(false);
      return;
    }
    const freshPlan = buildClassDetectionPlan(freshTasks.tasks, freshClasses.classes);
    if (freshPlan.fingerprint !== review.plan.fingerprint) {
      setBusy(false);
      await loadReview("Your calendar changed while you were reviewing it. Please check this refreshed preview before confirming.");
      return;
    }

    const activeClasses = freshClasses.classes.filter((calendarClass) => !calendarClass.deleted_at);
    const activeIds = new Set(activeClasses.map((calendarClass) => calendarClass.id));
    const classesByName = new Map(activeClasses.map((calendarClass) => [normalizedName(calendarClass.name), calendarClass]));
    const newGroups = new Map<string, typeof review.plan.candidates>();

    for (const candidate of review.plan.candidates) {
      const target = targets[candidate.key] ?? SKIP_TARGET;
      if (target === SKIP_TARGET) continue;
      if (target !== NEW_TARGET) {
        if (!activeIds.has(target)) {
          setError("One of the selected classes is no longer available. Refresh the review and try again.");
          setBusy(false);
          return;
        }
        continue;
      }
      const name = names[candidate.key]?.trim().replace(/\s+/g, " ") ?? "";
      if (!name || name.length > 120) {
        setError("Every new class needs a name of 120 characters or fewer.");
        setBusy(false);
        return;
      }
      if (classesByName.has(normalizedName(name))) {
        setError(`“${name}” already exists. Choose that class from the menu instead of creating it again.`);
        setBusy(false);
        return;
      }
      const key = normalizedName(name);
      newGroups.set(key, [...(newGroups.get(key) ?? []), candidate]);
    }

    let createdClasses = 0;
    const createdByName = new Map<string, CalendarClass>();
    for (const [nameKey, candidates] of newGroups) {
      const displayName = names[candidates[0].key].trim().replace(/\s+/g, " ");
      const detectedCodes = [...new Set(candidates.map((candidate) => candidate.detectedCourseCode).filter((value): value is string => Boolean(value)))];
      const created = await createCalendarClass({
        name: displayName,
        course_code: detectedCodes[0] ?? null,
        aliases: detectedCodes.slice(1),
      });
      if (!created.ok) {
        setError(createdClasses
          ? `${created.error} ${createdClasses} class${createdClasses === 1 ? " was" : "es were"} created, but no calendar items were reassigned. You can safely reopen this review.`
          : created.error);
        setBusy(false);
        return;
      }
      createdByName.set(nameKey, created.calendarClass);
      createdClasses += 1;
    }

    const assignments = review.plan.candidates.flatMap((candidate) => {
      const target = targets[candidate.key] ?? SKIP_TARGET;
      if (target === SKIP_TARGET) return [];
      const classId = target === NEW_TARGET
        ? createdByName.get(normalizedName(names[candidate.key]))?.id
        : target;
      if (!classId) return [];
      return candidate.taskIds.map((taskId) => ({ taskId, classId }));
    });
    const assigned = await assignTaskClasses(assignments);
    if (!assigned.ok) {
      setError(`${assigned.error}${createdClasses ? " New classes were saved, but no calendar items were reassigned. Reopen this review to try again." : ""}`);
      setBusy(false);
      return;
    }

    setSummary({
      createdClasses,
      assignedItems: assigned.count,
      leftUnassigned: review.plan.eligibleCount - assignments.length,
    });
    setBusy(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="class-review-title" className="my-auto flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-5 sm:px-7">
          <div className="flex gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><Sparkles className="h-5 w-5" /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-600">Review before saving</p>
              <h2 id="class-review-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Organize items into classes</h2>
              <p className="mt-1 text-sm text-slate-500">Nothing changes until you confirm.</p>
            </div>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Close class review" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {error && <p role="alert" className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</p>}
          {busy && !review && <div className="flex min-h-56 items-center justify-center gap-3 text-sm font-semibold text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" />Checking your class items…</div>}

          {summary && (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-7 w-7" /></span>
              <h3 className="mt-4 text-xl font-bold text-slate-950">Class organization saved</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">Created {summary.createdClasses} class{summary.createdClasses === 1 ? "" : "es"} and assigned {summary.assignedItems} calendar item{summary.assignedItems === 1 ? "" : "s"}. {summary.leftUnassigned} item{summary.leftUnassigned === 1 ? " remains" : "s remain"} Unassigned.</p>
            </div>
          )}

          {review && !summary && (
            <>
              <div className="mb-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl bg-violet-50 px-4 py-3"><strong className="block text-lg text-violet-900">{review.plan.candidates.length}</strong><span className="text-xs font-semibold text-violet-700">suggested matches</span></div>
                <div className="rounded-2xl bg-slate-100 px-4 py-3"><strong className="block text-lg text-slate-900">{review.plan.unmatchedTasks.length}</strong><span className="text-xs font-semibold text-slate-600">could not identify</span></div>
                <div className="rounded-2xl bg-emerald-50 px-4 py-3"><strong className="block text-lg text-emerald-900">{review.plan.alreadyAssignedCount}</strong><span className="text-xs font-semibold text-emerald-700">already organized</span></div>
              </div>

              {!review.plan.candidates.length && !review.plan.unmatchedTasks.length && (
                <p className="rounded-2xl border border-slate-200 px-4 py-6 text-center text-sm font-semibold text-slate-600">Every Classes item is already organized.</p>
              )}

              <div className="space-y-3">
                {review.plan.candidates.map((candidate) => {
                  const target = targets[candidate.key] ?? SKIP_TARGET;
                  const isExpanded = expanded.has(candidate.key);
                  return (
                    <section key={candidate.key} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-bold text-slate-950">{candidate.suggestedName}</h3>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${candidate.confidence === "high" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{candidate.confidence} confidence</span>
                            {candidate.ambiguousClassIds.length > 0 && <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-700">Needs your choice</span>}
                          </div>
                          <button type="button" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(candidate.key)) next.delete(candidate.key); else next.add(candidate.key); return next; })} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
                            <ChevronDown className={`h-3.5 w-3.5 transition ${isExpanded ? "rotate-180" : ""}`} />{candidate.taskIds.length} matched item{candidate.taskIds.length === 1 ? "" : "s"}
                          </button>
                        </div>
                        <label className="shrink-0 text-xs font-bold text-slate-600">
                          Place in
                          <select value={target} onChange={(event) => setTargets((current) => ({ ...current, [candidate.key]: event.target.value }))} className="mt-1 block min-w-52 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100">
                            <option value={SKIP_TARGET}>Leave Unassigned</option>
                            <option value={NEW_TARGET}>Create a new class</option>
                            {review.classes.map((calendarClass) => <option key={calendarClass.id} value={calendarClass.id}>{calendarClass.name}</option>)}
                          </select>
                        </label>
                      </div>
                      {target === NEW_TARGET && (
                        <label className="mt-3 block text-xs font-bold text-slate-600">New class name
                          <input value={names[candidate.key] ?? ""} maxLength={120} onChange={(event) => setNames((current) => ({ ...current, [candidate.key]: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
                        </label>
                      )}
                      {isExpanded && <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">{candidate.taskTitles.map((title, index) => <li key={`${candidate.taskIds[index]}-${index}`} className="truncate">• {title}</li>)}</ul>}
                    </section>
                  );
                })}
              </div>

              {review.plan.unmatchedTasks.length > 0 && (
                <details className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <summary className="cursor-pointer text-sm font-bold text-slate-800">{review.plan.unmatchedTasks.length} item{review.plan.unmatchedTasks.length === 1 ? " needs" : "s need"} manual organization</summary>
                  <p className="mt-2 text-xs leading-5 text-slate-500">These stay Unassigned. You will be able to place them from the item editor in a later stage.</p>
                  <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs text-slate-600">{review.plan.unmatchedTasks.map((task) => <li key={task.id}>• {task.title}</li>)}</ul>
                </details>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <p className="text-xs font-semibold text-slate-500">{summary ? "Changes are saved on this device." : `${selectedItemCount} item${selectedItemCount === 1 ? "" : "s"} will be assigned.`}</p>
          <div className="flex gap-2">
            <button type="button" onClick={close} disabled={busy} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">{summary ? "Done" : "Cancel"}</button>
            {!summary && review && <button type="button" onClick={() => void applyReview()} disabled={busy || selectedItemCount === 0} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}Confirm organization</button>}
          </div>
        </footer>
      </div>
    </div>
  );
}
