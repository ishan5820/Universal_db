"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, LoaderCircle, Sparkles } from "lucide-react";
import { CalendarGrid } from "@/components/CalendarGrid";
import { CloudMigrationNotice } from "@/components/CloudMigrationNotice";
import { getAllTasks, subscribeTaskChanges } from "@/lib/localTasks";
import type { Task } from "@/types/task";

export function OverviewClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    const result = await getAllTasks();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setTasks(result.tasks);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTasks(), 0);
    const unsubscribe = subscribeTaskChanges(() => void loadTasks());
    return () => { window.clearTimeout(timer); unsubscribe(); };
  }, [loadTasks]);

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm"><Sparkles className="h-3.5 w-3.5 text-amber-500" /> Universal semester view</div>
          <h1 className="text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-4xl">Everything on one calendar.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">Your calendar starts privately in this browser. Sign in to keep an encrypted-in-transit, account-protected backup available across your devices.</p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white">{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}</span><span><span className="block text-lg font-bold leading-none text-slate-950">{tasks.length}</span><span className="mt-1 block text-xs font-medium text-slate-500">calendar items</span></span></div>
      </header>

      {!loading && <CloudMigrationNotice itemCount={tasks.length} />}
      {error && <section role="alert" className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">{error}</section>}
      {!loading && !error && tasks.length === 0 && <section className="mb-5 rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-4"><p className="font-semibold text-slate-900">Your private calendar is ready.</p><p className="mt-1 text-sm text-slate-500">Click any calendar day to add something, restore a JSON backup, or use Sync Canvas in the navigation.</p></section>}
      <CalendarGrid tasks={tasks} variant="full" defaultView="month" onTasksChange={setTasks} />
    </main>
  );
}
