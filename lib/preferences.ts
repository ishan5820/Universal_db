import type { TaskCategory } from "@/types/task";

export type CategoryColorId = "green" | "orange" | "purple" | "blue" | "red" | "pink" | "teal" | "yellow" | "gray";
export type CategoryColors = Record<TaskCategory, CategoryColorId>;
export type CalendarView = "month" | "week";
export type WorkspaceView = "list" | "calendar";

export interface LocalPreferences {
  colors: CategoryColors;
  calendarView: CalendarView;
  workspaceViews: Record<TaskCategory, WorkspaceView>;
}

export const DEFAULT_CATEGORY_COLORS: CategoryColors = { classes: "green", orgs: "orange", social: "purple" };
export const CATEGORY_BASE_COLORS: Record<CategoryColorId, string> = {
  green: "#059669", orange: "#D97706", purple: "#7C3AED", blue: "#2563EB", red: "#DC2626",
  pink: "#DB2777", teal: "#0D9488", yellow: "#CA8A04", gray: "#64748B",
};
export const CATEGORY_COLORS_STORAGE_KEY = "universal-dashboard-category-colors-v1";
export const CATEGORY_COLORS_CHANGE_EVENT = "universal-dashboard:category-colors-changed";
export const CALENDAR_VIEW_STORAGE_KEY = "universal-dashboard-calendar-view";
export const CALENDAR_VIEW_CHANGE_EVENT = "universal-dashboard:calendar-view-changed";
export const WORKSPACE_VIEW_CHANGE_EVENT = "universal-dashboard:workspace-view-changed";

const COLOR_IDS = new Set<CategoryColorId>(["green", "orange", "purple", "blue", "red", "pink", "teal", "yellow", "gray"]);
const CATEGORIES = ["classes", "orgs", "social"] as const;

const DEFAULT_PREFERENCES: LocalPreferences = {
  colors: DEFAULT_CATEGORY_COLORS,
  calendarView: "month",
  workspaceViews: { classes: "list", orgs: "list", social: "list" },
};

export function isCalendarView(value: unknown): value is CalendarView {
  return value === "month" || value === "week";
}

export function isWorkspaceView(value: unknown): value is WorkspaceView {
  return value === "list" || value === "calendar";
}

export function normalizeCategoryColors(value: unknown): CategoryColors {
  if (!value || typeof value !== "object") return DEFAULT_CATEGORY_COLORS;
  const input = value as Partial<Record<TaskCategory, unknown>>;
  const result = { ...DEFAULT_CATEGORY_COLORS };
  if (typeof input.classes === "string" && COLOR_IDS.has(input.classes as CategoryColorId)) {
    result.classes = input.classes as CategoryColorId;
  }
  const used = new Set<CategoryColorId>();
  for (const category of ["orgs", "social"] as const) {
    const requested = input[category];
    const preferred = typeof requested === "string" && COLOR_IDS.has(requested as CategoryColorId)
      ? requested as CategoryColorId
      : DEFAULT_CATEGORY_COLORS[category];
    const available = used.has(preferred)
      ? [...COLOR_IDS].find((color) => !used.has(color))
      : preferred;
    result[category] = available ?? DEFAULT_CATEGORY_COLORS[category];
    used.add(result[category]);
  }
  return result;
}

export function normalizeLocalPreferences(value: unknown): LocalPreferences | null {
  if (!value || typeof value !== "object") return null;
  const input = value as {
    colors?: unknown;
    calendarView?: unknown;
    workspaceViews?: Partial<Record<TaskCategory, unknown>>;
  };
  const workspaceViews = { ...DEFAULT_PREFERENCES.workspaceViews };
  for (const category of CATEGORIES) {
    const stored = input.workspaceViews?.[category];
    if (isWorkspaceView(stored)) workspaceViews[category] = stored;
  }
  return {
    colors: normalizeCategoryColors(input.colors),
    calendarView: isCalendarView(input.calendarView) ? input.calendarView : DEFAULT_PREFERENCES.calendarView,
    workspaceViews,
  };
}

function workspaceStorageKey(category: TaskCategory) {
  return `universal-dashboard-${category}-view`;
}

export function readLocalPreferences(): LocalPreferences {
  const defaults = DEFAULT_PREFERENCES;
  if (typeof window === "undefined") return defaults;

  let colors = defaults.colors;
  try {
    colors = normalizeCategoryColors(JSON.parse(window.localStorage.getItem(CATEGORY_COLORS_STORAGE_KEY) ?? "null"));
  } catch {
    colors = defaults.colors;
  }
  const storedCalendarView = window.localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
  const workspaceViews = { ...defaults.workspaceViews };
  for (const category of CATEGORIES) {
    const stored = window.localStorage.getItem(workspaceStorageKey(category));
    if (isWorkspaceView(stored)) workspaceViews[category] = stored;
  }
  return {
    colors,
    calendarView: isCalendarView(storedCalendarView) ? storedCalendarView : defaults.calendarView,
    workspaceViews,
  };
}

export function applyLocalPreferences(preferences: LocalPreferences): void {
  const colors = normalizeCategoryColors(preferences.colors);
  window.localStorage.setItem(CATEGORY_COLORS_STORAGE_KEY, JSON.stringify(colors));
  window.localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, preferences.calendarView);
  for (const category of CATEGORIES) {
    window.localStorage.setItem(workspaceStorageKey(category), preferences.workspaceViews[category]);
  }
  window.dispatchEvent(new CustomEvent(CATEGORY_COLORS_CHANGE_EVENT, { detail: colors }));
  window.dispatchEvent(new CustomEvent(CALENDAR_VIEW_CHANGE_EVENT, { detail: preferences.calendarView }));
  window.dispatchEvent(new CustomEvent(WORKSPACE_VIEW_CHANGE_EVENT, { detail: preferences.workspaceViews }));
}

export function saveWorkspaceView(category: TaskCategory, view: WorkspaceView): void {
  window.localStorage.setItem(workspaceStorageKey(category), view);
  window.dispatchEvent(new CustomEvent(WORKSPACE_VIEW_CHANGE_EVENT, { detail: { [category]: view } }));
}

export function readWorkspaceView(category: TaskCategory): WorkspaceView {
  const stored = window.localStorage.getItem(workspaceStorageKey(category));
  return isWorkspaceView(stored) ? stored : "list";
}
