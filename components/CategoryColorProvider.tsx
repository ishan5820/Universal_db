"use client";

import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { TaskCategory, TaskShade } from "@/types/task";
import {
  CATEGORY_COLORS_CHANGE_EVENT,
  CATEGORY_COLORS_STORAGE_KEY,
  DEFAULT_CATEGORY_COLORS,
  normalizeCategoryColors,
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
  setCategoryColor: (category: TaskCategory, color: CategoryColorId) => boolean;
}

const CategoryColorContext = createContext<CategoryColorContextValue | null>(null);

export function CategoryColorProvider({ children }: { children: ReactNode }) {
  const [colors, setColors] = useState<CategoryColors>(DEFAULT_CATEGORY_COLORS);

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

  const setCategoryColor = (category: TaskCategory, color: CategoryColorId): boolean => {
    if (Object.entries(colors).some(([key, value]) => key !== category && value === color)) return false;
    const next = { ...colors, [category]: color };
    setColors(next);
    try { window.localStorage.setItem(CATEGORY_COLORS_STORAGE_KEY, JSON.stringify(next)); } catch { /* Use the selection for this session. */ }
    window.dispatchEvent(new CustomEvent(CATEGORY_COLORS_CHANGE_EVENT, { detail: next }));
    return true;
  };

  return <CategoryColorContext.Provider value={{ colors, setCategoryColor }}>{children}</CategoryColorContext.Provider>;
}

export function useCategoryColors(): CategoryColorContextValue {
  const value = useContext(CategoryColorContext);
  if (!value) throw new Error("Category colors must be used inside CategoryColorProvider.");
  return value;
}

export function categoryHex(colors: CategoryColors, category: TaskCategory, shade: TaskShade = 3): string {
  const palette = CATEGORY_COLOR_PALETTES.find((item) => item.id === colors[category]) ?? CATEGORY_COLOR_PALETTES[0];
  return palette.shades[shade - 1];
}

export function categoryAccentStyle(colors: CategoryColors, category: TaskCategory): CSSProperties {
  return { backgroundColor: categoryHex(colors, category) };
}

export function categorySoftStyle(colors: CategoryColors, category: TaskCategory): CSSProperties {
  const palette = CATEGORY_COLOR_PALETTES.find((item) => item.id === colors[category]) ?? CATEGORY_COLOR_PALETTES[0];
  return { backgroundColor: `${palette.shades[2]}1f`, color: palette.shades[4] };
}

export function itemColorStyle(colors: CategoryColors, category: TaskCategory, shade: TaskShade, kind: "task" | "event"): CSSProperties {
  const palette = CATEGORY_COLOR_PALETTES.find((item) => item.id === colors[category]) ?? CATEGORY_COLOR_PALETTES[0];
  const color = palette.shades[shade - 1];
  if (kind === "event") return { backgroundColor: `${color}1f`, borderColor: color, color: palette.shades[4] };
  const darkText = shade <= 2 || (colors[category] === "yellow" && shade === 3);
  return { backgroundColor: color, color: darkText ? "#0f172a" : "#ffffff" };
}
