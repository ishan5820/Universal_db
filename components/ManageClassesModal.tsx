"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, Check, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { categoryHex, useCategoryColors } from "@/components/CategoryColorProvider";
import { BASE_CALENDAR_COLORS, nextAvailableCalendarColor } from "@/lib/calendarColors";
import { countClassAssignments, removeManagedClass } from "@/lib/classManagement";
import { createCalendarClass, getClassRegistry, setUnassignedClassColor, updateCalendarClass } from "@/lib/localClasses";
import { getAllTasks } from "@/lib/localTasks";
import type { CalendarClass } from "@/types/calendarClass";

interface ManageClassesModalProps {
  open: boolean;
  onClose: () => void;
}

type ClassForm = {
  name: string;
  courseCode: string;
  aliases: string;
  color: string;
};

const EMPTY_FORM: ClassForm = { name: "", courseCode: "", aliases: "", color: BASE_CALENDAR_COLORS[0] };

function parseAliases(value: string): string[] {
  return [...new Set(value.split(",").map((alias) => alias.trim()).filter(Boolean))];
}

function buildColorChoices(classes: readonly CalendarClass[], unassignedColor: string): string[] {
  const choices = [...new Set([...BASE_CALENDAR_COLORS, unassignedColor, ...classes.map((calendarClass) => calendarClass.color)])];
  const reserved = new Set(choices);
  for (let index = 0; index < 12; index += 1) {
    const color = nextAvailableCalendarColor(reserved, choices.length + index);
    choices.push(color);
    reserved.add(color);
  }
  return choices;
}

function ColorChoices({ colors, selected, unavailable, onSelect, label }: {
  colors: readonly string[];
  selected: string;
  unavailable: ReadonlySet<string>;
  onSelect: (color: string) => void;
  label: string;
}) {
  const visibleColors = [selected, ...colors.filter((color) => color !== selected && !unavailable.has(color))].slice(0, 12);
  return (
    <fieldset>
      <legend className="text-xs font-bold text-slate-600">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {visibleColors.map((color) => {
          return (
            <button
              key={color}
              type="button"
              onClick={() => onSelect(color)}
              aria-label={`${selected === color ? "Selected " : ""}color ${color}`}
              aria-pressed={selected === color}
              title={color}
              className={`relative h-8 w-8 rounded-full border-2 transition ${selected === color ? "scale-110 border-slate-950 shadow-md" : "border-white shadow-sm ring-1 ring-slate-200"}`}
              style={{ backgroundColor: color }}
            >
              {selected === color && <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] font-semibold text-slate-400">Colors already in use are hidden.</p>
    </fieldset>
  );
}

export function ManageClassesModal({ open, onClose }: ManageClassesModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { colors: categoryColors } = useCategoryColors();
  const [classes, setClasses] = useState<CalendarClass[]>([]);
  const [unassignedColor, setUnassignedColorState] = useState("#64748B");
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [newForm, setNewForm] = useState<ClassForm>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<ClassForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CalendarClass | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const colorChoices = useMemo(() => buildColorChoices(classes, unassignedColor), [classes, unassignedColor]);
  const reservedColors = useMemo(() => [categoryHex(categoryColors, "orgs"), categoryHex(categoryColors, "social")], [categoryColors]);
  const usedColors = useMemo(() => new Set([unassignedColor, ...reservedColors, ...classes.map((calendarClass) => calendarClass.color)]), [classes, reservedColors, unassignedColor]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [classResult, taskResult] = await Promise.all([getClassRegistry(), getAllTasks()]);
    if (!classResult.ok || !taskResult.ok) {
      setError(!classResult.ok ? classResult.error : taskResult.ok ? "Could not load calendar items." : taskResult.error);
      setLoading(false);
      return false;
    }
    setClasses(classResult.classes);
    setUnassignedColorState(classResult.unassignedColor);
    setCounts(countClassAssignments(taskResult.tasks));
    const refreshedUsedColors = new Set([classResult.unassignedColor, ...reservedColors, ...classResult.classes.map((calendarClass) => calendarClass.color)]);
    setNewForm((current) => ({
      ...current,
      color: refreshedUsedColors.has(current.color)
        ? nextAvailableCalendarColor(refreshedUsedColors, classResult.classes.length)
        : current.color,
    }));
    setLoading(false);
    return true;
  }, [reservedColors]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [open, refresh]);

  const close = useCallback(() => {
    if (busy) return;
    setEditingId(null);
    setEditForm(null);
    setRemoveTarget(null);
    setError(null);
    setMessage(null);
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    requestAnimationFrame(() => dialog?.querySelector<HTMLElement>("button,input")?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (removeTarget) setRemoveTarget(null);
        else if (editingId) { setEditingId(null); setEditForm(null); }
        else close();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, [close, editingId, open, removeTarget]);

  const createClass = async () => {
    setBusy(true); setError(null); setMessage(null);
    const result = await createCalendarClass({
      name: newForm.name,
      course_code: newForm.courseCode || null,
      aliases: parseAliases(newForm.aliases),
      color: newForm.color,
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setNewForm({ ...EMPTY_FORM, color: nextAvailableCalendarColor([result.unassignedColor, ...reservedColors, ...result.classes.map((calendarClass) => calendarClass.color)], result.classes.length) });
    setMessage(`${result.calendarClass.name} was added.`);
    await refresh();
    setBusy(false);
  };

  const beginEdit = (calendarClass: CalendarClass) => {
    setEditingId(calendarClass.id);
    setEditForm({
      name: calendarClass.name,
      courseCode: calendarClass.course_code ?? "",
      aliases: calendarClass.aliases.join(", "),
      color: calendarClass.color,
    });
    setError(null);
    setMessage(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editForm) return;
    setBusy(true); setError(null); setMessage(null);
    const result = await updateCalendarClass(editingId, {
      name: editForm.name,
      course_code: editForm.courseCode || null,
      aliases: parseAliases(editForm.aliases),
      color: editForm.color,
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setEditingId(null);
    setEditForm(null);
    setMessage(`${result.calendarClass.name} was updated.`);
    await refresh();
    setBusy(false);
  };

  const saveUnassignedColor = async (color: string) => {
    if (color === unassignedColor) return;
    setBusy(true); setError(null); setMessage(null);
    const result = await setUnassignedClassColor(color);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setUnassignedColorState(result.unassignedColor);
    setMessage("The Unassigned color was updated.");
    await refresh();
    setBusy(false);
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setBusy(true); setError(null); setMessage(null);
    const targetName = removeTarget.name;
    const result = await removeManagedClass(removeTarget.id);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setRemoveTarget(null);
    if (editingId === removeTarget.id) { setEditingId(null); setEditForm(null); }
    setMessage(`${targetName} was removed. ${result.unassignedCount} calendar item${result.unassignedCount === 1 ? " was" : "s were"} moved to Unassigned.`);
    await refresh();
    setBusy(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="manage-classes-title" className="relative my-auto flex max-h-[calc(100vh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-5 sm:px-7">
          <div className="flex gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700"><BookOpen className="h-5 w-5" /></span>
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Class settings</p><h2 id="manage-classes-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Manage classes</h2><p className="mt-1 text-sm text-slate-500">Each class has one distinct color. Add as many as you need.</p></div>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Close class settings" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {error && <p role="alert" className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</p>}
          {message && <p role="status" className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><Check className="mr-2 inline h-4 w-4" />{message}</p>}
          {loading && !classes.length ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm font-semibold text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" />Loading classes…</div> : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
              <section>
                <div className="mb-3 flex items-center justify-between"><div><h3 className="font-bold text-slate-950">Your classes</h3><p className="text-xs text-slate-500">{classes.length} active class{classes.length === 1 ? "" : "es"}</p></div></div>
                <div className="space-y-3">
                  {classes.map((calendarClass) => {
                    const attachedCount = counts.get(calendarClass.id) ?? 0;
                    const editing = editingId === calendarClass.id && editForm;
                    const unavailable = new Set([unassignedColor, ...reservedColors, ...classes.filter((row) => row.id !== calendarClass.id).map((row) => row.color)]);
                    return (
                      <article key={calendarClass.id} className="rounded-2xl border border-slate-200 p-4">
                        {editing ? (
                          <div className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="text-xs font-bold text-slate-600">Class name<input value={editForm.name} maxLength={120} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>
                              <label className="text-xs font-bold text-slate-600">Course code <span className="font-normal text-slate-400">optional</span><input value={editForm.courseCode} maxLength={100} onChange={(event) => setEditForm({ ...editForm, courseCode: event.target.value })} placeholder="ECO 304K" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>
                            </div>
                            <label className="block text-xs font-bold text-slate-600">Recognition aliases <span className="font-normal text-slate-400">optional, comma-separated</span><input value={editForm.aliases} onChange={(event) => setEditForm({ ...editForm, aliases: event.target.value })} placeholder="Microeconomics, Canvas ECO" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>
                            <ColorChoices colors={colorChoices} selected={editForm.color} unavailable={unavailable} onSelect={(color) => setEditForm({ ...editForm, color })} label="Class color" />
                            <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setEditingId(null); setEditForm(null); }} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">Cancel</button><button type="button" onClick={() => void saveEdit()} disabled={busy || !editForm.name.trim()} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Save changes</button></div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <span className="h-10 w-10 shrink-0 rounded-xl shadow-sm ring-1 ring-black/5" style={{ backgroundColor: calendarClass.color }} aria-hidden="true" />
                            <div className="min-w-0 flex-1"><h4 className="truncate font-bold text-slate-950">{calendarClass.name}</h4><p className="truncate text-xs text-slate-500">{calendarClass.course_code ? `${calendarClass.course_code} · ` : ""}{attachedCount} calendar item{attachedCount === 1 ? "" : "s"}</p></div>
                            <button type="button" onClick={() => beginEdit(calendarClass)} aria-label={`Edit ${calendarClass.name}`} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>
                            <button type="button" onClick={() => { setRemoveTarget(calendarClass); setError(null); setMessage(null); }} aria-label={`Remove ${calendarClass.name}`} className="rounded-xl border border-rose-200 p-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {!classes.length && <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center"><BookOpen className="mx-auto h-7 w-7 text-slate-400" /><p className="mt-2 text-sm font-bold text-slate-700">No classes yet</p><p className="mt-1 text-xs text-slate-500">Add one here or use Organize classes to detect them from existing items.</p></div>}
                </div>

                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl shadow-sm" style={{ backgroundColor: unassignedColor }} /><div><h3 className="text-sm font-bold text-slate-950">Unassigned</h3><p className="text-xs text-slate-500">Items that are not connected to a class yet.</p></div></div>
                  <div className="mt-4"><ColorChoices colors={colorChoices} selected={unassignedColor} unavailable={new Set([...reservedColors, ...classes.map((calendarClass) => calendarClass.color)])} onSelect={(color) => void saveUnassignedColor(color)} label="Unassigned color" /></div>
                </div>
              </section>

              <aside className="h-fit rounded-2xl border border-sky-200 bg-sky-50 p-4 lg:sticky lg:top-0">
                <div className="flex items-center gap-2 text-sm font-bold text-sky-950"><Plus className="h-4 w-4" />Add a class</div>
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-bold text-slate-700">Class name<input value={newForm.name} maxLength={120} onChange={(event) => setNewForm({ ...newForm, name: event.target.value })} placeholder="Microeconomics" className="mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>
                  <label className="block text-xs font-bold text-slate-700">Course code <span className="font-normal text-slate-500">optional</span><input value={newForm.courseCode} maxLength={100} onChange={(event) => setNewForm({ ...newForm, courseCode: event.target.value })} placeholder="ECO 304K" className="mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>
                  <label className="block text-xs font-bold text-slate-700">Aliases <span className="font-normal text-slate-500">optional</span><input value={newForm.aliases} onChange={(event) => setNewForm({ ...newForm, aliases: event.target.value })} placeholder="Canvas name, nickname" className="mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" /></label>
                  <ColorChoices colors={colorChoices} selected={newForm.color} unavailable={usedColors} onSelect={(color) => setNewForm({ ...newForm, color })} label="Class color" />
                  <button type="button" onClick={() => void createClass()} disabled={busy || !newForm.name.trim() || usedColors.has(newForm.color)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-4 w-4" />Add class</button>
                </div>
              </aside>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-7"><p className="text-xs font-semibold text-slate-500">Removing a class never deletes its calendar items.</p><button type="button" onClick={close} disabled={busy} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Done</button></footer>

        {removeTarget && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-slate-950/55 p-5 backdrop-blur-sm">
            <section role="alertdialog" aria-modal="true" aria-labelledby="remove-class-title" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-700"><AlertTriangle className="h-5 w-5" /></span>
              <h3 id="remove-class-title" className="mt-4 text-xl font-bold text-slate-950">Remove {removeTarget.name}?</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{counts.get(removeTarget.id) ?? 0} attached calendar item{(counts.get(removeTarget.id) ?? 0) === 1 ? " will" : "s will"} move to Unassigned. The items, dates, notes, and subtasks will not be deleted.</p>
              <div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={() => setRemoveTarget(null)} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Keep class</button><button type="button" onClick={() => void confirmRemove()} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}Remove class</button></div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
