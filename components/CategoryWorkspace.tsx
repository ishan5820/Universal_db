"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { CalendarDays, CheckCircle2, CircleAlert, FileUp, ListTodo, Plus, Settings2, Sparkles } from "lucide-react";
import { CalendarGrid } from "@/components/CalendarGrid";
import { ClassDetectionReview } from "@/components/ClassDetectionReview";
import { categoryAccentStyle, useCategoryColors } from "@/components/CategoryColorProvider";
import { CategoryTaskList } from "@/components/CategoryTaskList";
import { ManageClassesModal } from "@/components/ManageClassesModal";
import { RecurringEventModal } from "@/components/RecurringEventModal";
import { SyllabusImporter } from "@/components/SyllabusImporter";
import { CATEGORY_STYLES } from "@/lib/categories";
import { BASE_CALENDAR_COLORS } from "@/lib/calendarColors";
import { toLocalDateString } from "@/lib/datetime";
import { getAllTasks, subscribeTaskChanges } from "@/lib/localTasks";
import { readWorkspaceView, saveWorkspaceView, WORKSPACE_VIEW_CHANGE_EVENT, type WorkspaceView } from "@/lib/preferences";
import type { Task, TaskCategory } from "@/types/task";

export interface CategoryWorkspaceProps {
  category: TaskCategory;
}

export function CategoryWorkspace({ category }: CategoryWorkspaceProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<WorkspaceView>("list");
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [classReviewOpen, setClassReviewOpen] = useState(false);
  const [manageClassesOpen, setManageClassesOpen] = useState(false);
  const [seriesToEdit, setSeriesToEdit] = useState<Task[]>([]);
  const style = CATEGORY_STYLES[category];
  const { colors, classes } = useCategoryColors();
  const classAccentStyle = useMemo<CSSProperties>(() => {
    const classColors = classes.map((calendarClass) => calendarClass.color);
    const wheelColors = classColors.length > 1 ? classColors : BASE_CALENDAR_COLORS.slice(0, 4);
    const step = 100 / wheelColors.length;
    return { background: `linear-gradient(to bottom, ${wheelColors.map((color, index) => `${color} ${index * step}% ${(index + 1) * step}%`).join(", ")})` };
  }, [classes]);

  const loadTasks = useCallback(async () => {
    const result = await getAllTasks();
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setTasks(result.tasks.filter((task) => task.category === category));
  }, [category]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTasks(), 0);
    const unsubscribe = subscribeTaskChanges(() => void loadTasks());
    return () => { window.clearTimeout(timer); unsubscribe(); };
  }, [loadTasks]);

  useEffect(() => {
    const timer = window.setTimeout(() => setMobileView(readWorkspaceView(category)), 0);
    const handleChange = (event: Event) => {
      const views = (event as CustomEvent<Partial<Record<TaskCategory, WorkspaceView>>>).detail;
      if (views?.[category]) setMobileView(views[category]);
    };
    window.addEventListener(WORKSPACE_VIEW_CHANGE_EVENT, handleChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(WORKSPACE_VIEW_CHANGE_EVENT, handleChange);
    };
  }, [category]);

  const changeView = (view: WorkspaceView) => {
    setMobileView(view);
    saveWorkspaceView(category, view);
  };
  const today = toLocalDateString(new Date());
  const taskRows = tasks.filter((task) => task.kind === "task");
  const open = taskRows.filter((task) => !task.is_completed).length;
  const overdue = taskRows.filter((task) => !task.is_completed && task.due_date && task.due_date < today).length;
  const completed = taskRows.filter((task) => task.is_completed).length;

  const openSeriesEditor = (rows: Task[]) => { setSeriesToEdit(rows); setRecurringOpen(true); };
  const closeRecurring = () => { setRecurringOpen(false); setSeriesToEdit([]); };
  const handleSeriesChanged = (changed: Task[], mode: "created" | "updated") => {
    if (mode === "created") setTasks((current) => [...current, ...changed]);
    else {
      const replacements = new Map(changed.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => replacements.get(task.id) ?? task));
    }
  };
  const handleImported = (created: Task[], updated: Task[]) => {
    const replacements = new Map(updated.map((task) => [task.id, task]));
    setTasks((current) => [
      ...current.map((task) => replacements.get(task.id) ?? task),
      ...created.filter((task) => task.category === category),
    ]);
  };

  return (
    <main className="mx-auto w-full max-w-[1700px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="mb-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-4"><span style={category === "classes" ? classAccentStyle : categoryAccentStyle(colors, category)} className="h-12 w-2 rounded-full" aria-hidden="true" /><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Category workspace</p><h1 className="mt-1 text-3xl font-bold tracking-[-0.035em] text-slate-950">{style.label}</h1></div></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600"><ListTodo className="h-4 w-4" />{open} open</div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${overdue ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-500"}`}><CircleAlert className="h-4 w-4" />{overdue} overdue</div>
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{completed} completed</div>
            {category === "classes" && <button type="button" onClick={() => setManageClassesOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-bold text-sky-800 shadow-sm"><Settings2 className="h-4 w-4" />Manage classes</button>}
            {category === "classes" && <button type="button" onClick={() => setClassReviewOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-800 shadow-sm"><Sparkles className="h-4 w-4" />Organize classes</button>}
            {category === "classes" && <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm"><FileUp className="h-4 w-4 text-emerald-600" />Import syllabus</button>}
            <button type="button" onClick={() => { setSeriesToEdit([]); setRecurringOpen(true); }} style={category === "classes" ? { backgroundColor: "#020617" } : categoryAccentStyle(colors, category)} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm"><Plus className="h-4 w-4" />Add recurring</button>
          </div>
        </div>
      </header>

      {loadError && <p role="alert" className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{loadError}</p>}

      <div className="mb-4 grid grid-cols-2 rounded-2xl bg-slate-200 p-1 min-[1750px]:hidden" aria-label={`${style.label} view`}>
        <button type="button" onClick={() => changeView("list")} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${mobileView === "list" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><ListTodo className="h-4 w-4" />List</button>
        <button type="button" onClick={() => changeView("calendar")} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${mobileView === "calendar" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}><CalendarDays className="h-4 w-4" />Calendar</button>
      </div>

      <div className="min-[1750px]:grid min-[1750px]:grid-cols-[minmax(0,1.2fr)_minmax(700px,0.8fr)] min-[1750px]:gap-5">
        <div className={`${mobileView === "list" ? "block" : "hidden"} min-[1750px]:block min-[1750px]:max-h-[calc(100vh-9rem)] min-[1750px]:overflow-y-auto min-[1750px]:rounded-3xl`}><CategoryTaskList category={category} initialTasks={tasks} onTasksChange={setTasks} onEditSeries={openSeriesEditor} /></div>
        <div className={`${mobileView === "calendar" ? "block" : "hidden"} min-[1750px]:block min-[1750px]:max-h-[calc(100vh-9rem)] min-[1750px]:overflow-y-auto min-[1750px]:rounded-3xl`}><div className="min-[1750px]:sticky min-[1750px]:top-0"><CalendarGrid tasks={tasks} scopeCategory={category} variant="compact" defaultView="month" onTasksChange={setTasks} /></div></div>
      </div>

      {recurringOpen && <RecurringEventModal key={`${category}-${seriesToEdit[0]?.series_id ?? "new"}`} open onClose={closeRecurring} initialCategory={category} lockCategory existingSeries={seriesToEdit} onChanged={handleSeriesChanged} />}
      {category === "classes" && manageClassesOpen && <ManageClassesModal open onClose={() => setManageClassesOpen(false)} />}
      {category === "classes" && classReviewOpen && <ClassDetectionReview open onClose={() => setClassReviewOpen(false)} />}
      {category === "classes" && importOpen && <SyllabusImporter open onClose={() => setImportOpen(false)} initialCategory="classes" existingTasks={tasks} onImported={handleImported} onUndone={(batchId) => setTasks((current) => current.filter((task) => task.import_batch_id !== batchId))} />}
    </main>
  );
}
