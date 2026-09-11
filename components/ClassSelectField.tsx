"use client";

import { useCategoryColors } from "@/components/CategoryColorProvider";

interface ClassSelectFieldProps {
  value: string | null;
  onChange: (classId: string | null) => void;
  label?: string;
  compact?: boolean;
  disabled?: boolean;
}

export function ClassSelectField({ value, onChange, label = "Class", compact = false, disabled = false }: ClassSelectFieldProps) {
  const { classes, unassignedColor } = useCategoryColors();
  const selected = classes.find((calendarClass) => calendarClass.id === value);
  const selectedColor = selected?.color ?? unassignedColor;

  return (
    <label className={compact ? "flex min-w-0 items-center gap-2" : "block"}>
      <span className={compact ? "sr-only" : "text-sm font-semibold text-slate-700"}>{label}</span>
      <span className={`flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white ${compact ? "px-2 py-1.5" : "mt-1.5 px-3 py-2.5"}`}>
        <span className="h-3.5 w-3.5 shrink-0 rounded-full shadow-sm ring-1 ring-black/10" style={{ backgroundColor: selectedColor }} aria-hidden="true" />
        <select
          value={selected?.id ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
          disabled={disabled}
          aria-label={compact ? label : undefined}
          className={`min-w-0 flex-1 border-0 bg-transparent font-semibold text-slate-700 outline-none disabled:opacity-50 ${compact ? "max-w-40 text-xs" : "text-sm"}`}
        >
          <option value="">Unassigned</option>
          {classes.map((calendarClass) => <option key={calendarClass.id} value={calendarClass.id}>{calendarClass.name}</option>)}
        </select>
      </span>
    </label>
  );
}
