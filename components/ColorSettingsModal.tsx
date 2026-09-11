"use client";

import { useState } from "react";
import { Palette, X } from "lucide-react";
import { CATEGORY_STYLES } from "@/lib/categories";
import { CATEGORY_COLOR_PALETTES, useCategoryColors, type CategoryColorId } from "@/components/CategoryColorProvider";
import type { TaskCategory } from "@/types/task";

const EDITABLE_CATEGORIES = ["orgs", "social"] as const satisfies readonly TaskCategory[];

export function ColorSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { colors, classes, unassignedColor, setCategoryColor } = useCategoryColors();
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const choose = (category: TaskCategory, color: CategoryColorId) => {
    if (!setCategoryColor(category, color)) {
      setError("That color is already used by another category, class, or Unassigned.");
      return;
    }
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="color-settings-title" className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <header className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-indigo-600"><Palette className="h-4 w-4" />Calendar colors</div><h2 id="color-settings-title" className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Choose colors for Orgs and Social</h2><p className="mt-1 text-sm leading-6 text-slate-500">Each color can be used only once. Class colors and the Unassigned color live under Manage classes.</p></div><button type="button" onClick={onClose} aria-label="Close calendar colors" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
        <div className="mt-6 space-y-5">{EDITABLE_CATEGORIES.map((category) => <fieldset key={category}><legend className="text-sm font-bold text-slate-800">{CATEGORY_STYLES[category].label}</legend><div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-9">{CATEGORY_COLOR_PALETTES.map((palette) => { const selected = colors[category] === palette.id; const hex = palette.shades[2]; const usedElsewhere = EDITABLE_CATEGORIES.some((item) => item !== category && colors[item] === palette.id) || classes.some((calendarClass) => calendarClass.color.toLowerCase() === hex.toLowerCase()) || unassignedColor.toLowerCase() === hex.toLowerCase(); return <button key={palette.id} type="button" disabled={usedElsewhere} onClick={() => choose(category, palette.id)} aria-label={`${palette.label} for ${CATEGORY_STYLES[category].label}${usedElsewhere ? ", already used" : ""}`} aria-pressed={selected} className={`flex aspect-square items-center justify-center rounded-xl border-2 transition disabled:cursor-not-allowed disabled:opacity-20 ${selected ? "border-slate-950 ring-2 ring-slate-300" : "border-white hover:scale-105"}`}><span className="h-7 w-7 rounded-full shadow-sm ring-1 ring-black/10" style={{ backgroundColor: hex }} /></button>; })}</div></fieldset>)}</div>
        {error && <p role="alert" className="mt-5 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
        <div className="mt-6 flex justify-end border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white">Done</button></div>
      </section>
    </div>
  );
}
