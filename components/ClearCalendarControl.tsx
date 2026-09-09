"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowLeft, Check, LoaderCircle, Trash2, X } from "lucide-react";
import { useCloudSync } from "@/components/CloudSyncProvider";
import { clearCalendar, getAllTasks, subscribeTaskChanges } from "@/lib/localTasks";
import type { Task } from "@/types/task";

type VerificationStep = 1 | 2 | 3;

export function ClearCalendarControl() {
  const cloud = useCloudSync();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<VerificationStep>(1);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearedCount, setClearedCount] = useState<number | null>(null);

  useEffect(() => {
    const refresh = async () => {
      const result = await getAllTasks();
      if (result.ok) setTasks(result.tasks);
    };
    void refresh();
    return subscribeTaskChanges(() => void refresh());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, open]);

  const subtaskCount = useMemo(
    () => tasks.reduce((total, task) => total + task.subtasks.length, 0),
    [tasks],
  );

  const begin = async () => {
    const result = await getAllTasks();
    if (!result.ok) {
      setError(result.error);
      setOpen(true);
      return;
    }
    setTasks(result.tasks);
    setStep(1);
    setTypedConfirmation("");
    setError(null);
    setClearedCount(null);
    setOpen(true);
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const permanentlyClear = async () => {
    setBusy(true);
    setError(null);
    const result = await clearCalendar();
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    setTasks([]);
    setClearedCount(result.count);
    await cloud.syncNow();
    setBusy(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void begin()}
        disabled={tasks.length === 0}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-30 inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-bold text-rose-700 shadow-lg shadow-slate-900/10 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:shadow-none md:bottom-6 md:right-6"
        title={tasks.length === 0 ? "Your calendar is already empty" : "Remove every calendar item"}
      >
        <Trash2 className="h-4 w-4" />
        Clear calendar
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-calendar-title"
            className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                  {clearedCount === null ? <AlertTriangle className="h-5 w-5" /> : <Check className="h-5 w-5" />}
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose-500">
                    {clearedCount === null ? `Verification ${step} of 3` : "Calendar cleared"}
                  </p>
                  <h2 id="clear-calendar-title" className="mt-1 text-xl font-black tracking-tight text-slate-950">
                    {clearedCount === null ? "Clear your entire calendar?" : `${clearedCount} items removed`}
                  </h2>
                </div>
              </div>
              <button type="button" onClick={close} disabled={busy} aria-label="Close" className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </div>

            {clearedCount !== null ? (
              <div className="mt-6">
                <p className="text-sm leading-6 text-slate-600">Your calendar is now empty on this device. If you are signed in, the cleared calendar is also being saved to your cloud backup.</p>
                <button type="button" onClick={close} className="mt-6 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800">Done</button>
              </div>
            ) : (
              <>
                <div className="mt-6 flex gap-2" aria-hidden="true">
                  {[1, 2, 3].map((number) => <span key={number} className={`h-1.5 flex-1 rounded-full ${number <= step ? "bg-rose-500" : "bg-slate-200"}`} />)}
                </div>

                {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}

                {step === 1 && (
                  <div className="mt-5">
                    <p className="text-sm leading-6 text-slate-600">This removes all tasks and events from every category, including every nested subtask. Calendar colors and view settings will stay unchanged.</p>
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                      <p className="text-2xl font-black text-slate-950">{tasks.length}</p>
                      <p className="text-sm font-semibold text-slate-500">calendar items{subtaskCount > 0 ? ` · ${subtaskCount} subtasks` : ""}</p>
                    </div>
                    <p className="mt-4 text-xs font-semibold text-rose-600">This cannot be undone unless you exported a backup first.</p>
                  </div>
                )}

                {step === 2 && (
                  <div className="mt-5">
                    <p className="text-sm leading-6 text-slate-600">To verify that you intend to remove the whole calendar, type <strong className="text-slate-950">CLEAR</strong> below.</p>
                    <label htmlFor="clear-calendar-confirmation" className="mt-4 block text-xs font-bold uppercase tracking-wider text-slate-500">Type CLEAR</label>
                    <input
                      id="clear-calendar-confirmation"
                      autoFocus
                      value={typedConfirmation}
                      onChange={(event) => setTypedConfirmation(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-bold uppercase outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-100"
                    />
                  </div>
                )}

                {step === 3 && (
                  <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <p className="font-bold text-rose-900">Final confirmation</p>
                    <p className="mt-1 text-sm leading-6 text-rose-800">Permanently remove all {tasks.length} calendar items{subtaskCount > 0 ? ` and their ${subtaskCount} subtasks` : ""}?</p>
                  </div>
                )}

                <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
                  {step === 1 ? (
                    <button type="button" onClick={close} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100">Cancel</button>
                  ) : (
                    <button type="button" onClick={() => setStep((step - 1) as VerificationStep)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-40"><ArrowLeft className="h-4 w-4" />Back</button>
                  )}

                  {step < 3 ? (
                    <button
                      type="button"
                      onClick={() => setStep((step + 1) as VerificationStep)}
                      disabled={step === 2 && typedConfirmation.trim().toUpperCase() !== "CLEAR"}
                      className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      Continue
                    </button>
                  ) : (
                    <button type="button" onClick={() => void permanentlyClear()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">
                      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      {busy ? "Clearing…" : "Permanently clear"}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
