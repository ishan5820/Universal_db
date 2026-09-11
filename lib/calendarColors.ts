export const DEFAULT_UNASSIGNED_CLASS_COLOR = "#64748B";

export const BASE_CALENDAR_COLORS = [
  "#059669", "#EA580C", "#7C3AED", "#2563EB",
  "#DC2626", "#DB2777", "#0D9488", "#D97706",
  "#0891B2", "#4F46E5", "#65A30D", "#C026D3",
  "#0284C7", "#E11D48", "#16A34A", "#475569",
] as const;

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

export function normalizeCalendarColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = ((hue % 360) + 360) % 360 / 60;
  const intermediate = chroma * (1 - Math.abs(section % 2 - 1));
  const offset = l - chroma / 2;
  const [red, green, blue] = section < 1 ? [chroma, intermediate, 0]
    : section < 2 ? [intermediate, chroma, 0]
      : section < 3 ? [0, chroma, intermediate]
        : section < 4 ? [0, intermediate, chroma]
          : section < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  const channel = (value: number) => Math.round((value + offset) * 255).toString(16).padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

export function nextAvailableCalendarColor(usedColors: Iterable<string>, startingIndex = 0): string {
  const used = new Set([...usedColors].map((color) => normalizeCalendarColor(color)).filter(Boolean));
  for (let offset = 0; offset < BASE_CALENDAR_COLORS.length; offset += 1) {
    const candidate = BASE_CALENDAR_COLORS[(startingIndex + offset) % BASE_CALENDAR_COLORS.length];
    if (!used.has(candidate)) return candidate;
  }

  for (let offset = 0; offset < 720; offset += 1) {
    const sequence = startingIndex + offset;
    const candidate = hslToHex(sequence * 137.508, 68 + sequence % 3 * 4, 39 + sequence % 4 * 3);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("No distinct calendar color could be generated.");
}

export function calendarColorText(color: string): "#0F172A" | "#FFFFFF" {
  const normalized = normalizeCalendarColor(color) ?? DEFAULT_UNASSIGNED_CLASS_COLOR;
  const channels = [1, 3, 5].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.46 ? "#0F172A" : "#FFFFFF";
}
