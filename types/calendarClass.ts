export interface CalendarClass {
  id: string;
  name: string;
  course_code: string | null;
  aliases: string[];
  color: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarClassDraft {
  name: string;
  course_code?: string | null;
  aliases?: string[];
  color?: string;
}

export interface ClassRegistrySnapshot {
  version: 1;
  classes: CalendarClass[];
  unassigned_color: string;
  updated_at: string | null;
}
