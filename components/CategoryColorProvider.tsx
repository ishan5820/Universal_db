"use client";

import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { calendarColorText, DEFAULT_UNASSIGNED_CLASS_COLOR } from "@/lib/calendarColors";
import { getClassRegistry, subscribeClassChanges } from "@/lib/localClasses";
import type { CalendarClass } from "@/types/calendarClass";
import type { Task, TaskCategory, TaskShade } from "@/types/task";
import {
  CATEGORY_COLORS_CHANGE_EVENT,
  CATEGORY_COLORS_STORAGE_KEY,
  DEFAULT_CATEGORY_COLORS,
  normalizeCategoryColors,
  CATEGORY_BASE_COLORS,
  type CategoryColorId,
  type CategoryColors,
} from "@/lib/preferences";

export type { CategoryColorId, CategoryColors } from "@/lib/preferences";

export const CATEGORY_COLOR_PALETTES: ReadonlyArray<{ id: CategoryColorId; label: string; shades: readonly [string, string, string, string, string] }> = [
  { id: "green", label: "Green", shades: ["#6ee7b7", "#34d399", "#059669", "#047857", "#064e3b"] },
  { id: "orange", label: "Orange", shades: ["#fcd34d", "#fbbf24", "#d97706", "#b45309", "#78350f"] },
  { id: "purple", label: "Purple", shades: ["#c4b5fd", "#a78bfa", "#7c3aed", "#6d28d9", "#4c1d95"] },
  { id: "blue", label: "Blue", shades: ["#93c5fd", "#60a5fa", "#2563eb", "#1d4ed8", "#1e3a8a"] },
  { id: "red", label: "Red", shades: ["#fca5a5", "#f87171", "#dc2626", "#b91c1c", "#7f1d1d"] },
  { id: "pink", label: "Pink", shades: ["#f9a8d4", "#f472b6", "#db2777", "#be185d", "#831843"] },
  { id: "teal", label: "Teal", shades: ["#5eead4", "#2dd4bf", "#0d9488", "#0f766e", "#134e4a"] },
  { id: "yellow", label: "Yellow", shades: ["#fef08a", "#fde047", "#ca8a04", "#a16207", "#713f12"] },
  { id: "gray", label: "Gray", shades: ["#cbd5e1", "#94a3b8", "#64748b", "#475569", "#1e293b"] },
];

function loadColors(): CategoryColors {
  if (typeof window === "undefined") return DEFAULT_CATEGORY_COLORS;
  try {
    return normalizeCategoryColors(JSON.parse(window.localStorage.getItem(CATEGORY_COLORS_STORAGE_KEY) ?? "null"));
  } catch {
    return DEFAULT_CATEGORY_COLORS;
  }
}

interface CategoryColorContextValue {
  colors: CategoryColors;
  classes: CalendarClass[];
  unassignedColor: string;
  setCategoryColor: (category: TaskCategory, color: CategoryColorId) => boolean;
}

const CategoryColorContext = createContext<CategoryColorContextValue | null>(null);

export function CategoryColorProvider({ children }: { children: ReactNode }) {
  const [colors, setColors] = useState<CategoryColors>(DEFAULT_CATEGORY_COLORS);
  const [classes, setClasses] = useState<CalendarClass[]>([]);
  const [unassignedColor, setUnassignedColor] = useState(DEFAULT_UNASSIGNED_CLASS_COLOR);

  useEffect(() => {
    const timer = window.setTimeout(() => setColors(loadColors()), 0);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CATEGORY_COLORS_STORAGE_KEY) setColors(loadColors());
    };
    const handleLocalChange = (event: Event) => setColors(normalizeCategoryColors((event as CustomEvent<unknown>).detail));
    window.addEventListener("storage", handleStorage);
    window.addEventListener(CATEGORY_COLORS_CHANGE_EVENT, handleLocalChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(CATEGORY_COLORS_CHANGE_EVENT, handleLocalChange);
    };
  }, []);

  useEffect(() => {
    const loadClasses = async () => {
      const result = await getClassRegistry();
      if (!result.ok) return;
      setClasses(result.classes);
      setUnassignedColor(result.unassignedColor);
    };
    const timer = window.setTimeout(() => void loadClasses(), 0);
    const unsubscribe = subscribeClassChanges(() => void loadClasses());
    return () => { window.clearTimeout(timer); unsubscribe(); };
  }, []);

  const setCategoryColor = (category: TaskCategory, color: CategoryColorId): boolean => {
    if (category === "classes") return false;
    const otherCategory = category === "orgs" ? "social" : "orgs";
    const requestedHex = CATEGORY_BASE_COLORS[color];
    if (colors[otherCategory] === color || unassignedColor === requestedHex || classes.some((calendarClass) => calendarClass.color === requestedHex)) return false;
    const next = { ...colors, [category]: color };
    setColors(next);
    try { window.localStorage.setItem(CATEGORY_COLORS_STORAGE_KEY, JSON.stringify(next)); } catch { /* Use the selection for this session. */ }
    window.dispatchEvent(new CustomEvent(CATEGORY_COLORS_CHANGE_EVENT, { detail: next }));
    return true;
  };

  return <CategoryColorContext.Provider value={{ colors, classes, unassignedColor, setCategoryColor }}>{children}</CategoryColorContext.Provider>;
}

export function useCategoryColors(): CategoryColorContextValue {
  const value = useContext(CategoryColorContext);
  if (!value) throw new Error("Category colors must be used inside CategoryColorProvider.");
  return value;
}

export function categoryHex(colors: CategoryColors, category: TaskCategory, shade: TaskShade = 3): string {
  void shade;
  return CATEGORY_BASE_COLORS[colors[category]];
}

export function categoryAccentStyle(colors: CategoryColors, category: TaskCategory): CSSProperties {
  return { backgroundColor: categoryHex(colors, category) };
}

export function categorySoftStyle(colors: CategoryColors, category: TaskCategory): CSSProperties {
  const color = categoryHex(colors, category);
  return { backgroundColor: `${color}1f`, color: "#334155" };
}

export function itemColorStyle(colors: CategoryColors, category: TaskCategory, shade: TaskShade, kind: "task" | "event"): CSSProperties {
  void shade;
  return solidItemColorStyle(categoryHex(colors, category), kind);
}

export function solidItemColorStyle(color: string, kind: "task" | "event"): CSSProperties {
  if (kind === "event") return { backgroundColor: `${color}1f`, borderColor: color, color: "#334155" };
  return { backgroundColor: color, color: calendarColorText(color) };
}

export function solidSoftStyle(color: string): CSSProperties {
  return { backgroundColor: `${color}1f`, color: "#334155", borderColor: color };
}

export function resolveTaskColor(colors: CategoryColors, classes: readonly CalendarClass[], unassignedColor: string, task: Pick<Task, "category" | "class_id">): string {
  if (task.category !== "classes") return categoryHex(colors, task.category);
  return classes.find((calendarClass) => calendarClass.id === task.class_id)?.color ?? unassignedColor;
}

export function resolveClassName(classes: readonly CalendarClass[], task: Pick<Task, "category" | "class_id">): string | null {
  if (task.category !== "classes") return null;
  return classes.find((calendarClass) => calendarClass.id === task.class_id)?.name ?? "Unassigned";
}
