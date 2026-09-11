import type { CalendarClass } from "@/types/calendarClass";
import type { Task } from "@/types/task";

export type ClassDetectionConfidence = "high" | "medium";
export type ClassDetectionSource = "course-code" | "title" | "alias";

export interface ClassDetectionCandidate {
  key: string;
  detectedCourseCode: string | null;
  suggestedName: string;
  confidence: ClassDetectionConfidence;
  source: ClassDetectionSource;
  taskIds: string[];
  taskTitles: string[];
  existingClassId: string | null;
  ambiguousClassIds: string[];
}

export interface UnmatchedClassTask {
  id: string;
  title: string;
}

export interface ClassDetectionPlan {
  candidates: ClassDetectionCandidate[];
  unmatchedTasks: UnmatchedClassTask[];
  alreadyAssignedCount: number;
  eligibleCount: number;
  fingerprint: string;
}

type DetectableTask = Pick<Task, "id" | "title" | "course_code" | "category" | "class_id" | "updated_at">;
type DetectableClass = Pick<CalendarClass, "id" | "name" | "course_code" | "aliases" | "updated_at" | "deleted_at">;

const COURSE_CODE_PATTERN = /(?:^|[^A-Z0-9])((?:B\s+A)|[A-Z]{2,4})\s*[- ]?\s*(\d{3}[A-Z]?)(?=$|[^A-Z0-9])/gi;
const BLOCKED_DEPARTMENTS = new Set(["CLASS", "EXAM", "FALL", "FINAL", "GROUP", "QUIZ", "ROOM", "SPRING", "TEST", "UNIT", "WEEK"]);

function identity(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase().replace(/[^A-Z0-9]/g, "");
}

function displayCourseCode(department: string, number: string): string {
  const normalizedDepartment = department.toLocaleUpperCase().replace(/\s+/g, " ").trim();
  return `${normalizedDepartment} ${number.toLocaleUpperCase()}`;
}

export function extractCourseCode(value: string | null | undefined): string | null {
  if (!value) return null;
  COURSE_CODE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COURSE_CODE_PATTERN.exec(value.toLocaleUpperCase())) !== null) {
    const department = match[1].replace(/\s+/g, " ").trim();
    if (BLOCKED_DEPARTMENTS.has(department.replace(/\s/g, ""))) continue;
    return displayCourseCode(department, match[2]);
  }
  return null;
}

function classCourseIdentities(calendarClass: DetectableClass): Set<string> {
  const values = [calendarClass.course_code, extractCourseCode(calendarClass.name), ...calendarClass.aliases.map(extractCourseCode)];
  return new Set(values.filter((value): value is string => Boolean(value)).map(identity));
}

function matchesAlias(taskTitle: string, calendarClass: DetectableClass): boolean {
  const titleIdentity = identity(taskTitle);
  const aliases = [calendarClass.name, ...calendarClass.aliases]
    .map(identity)
    .filter((alias) => alias.length >= 4);
  return aliases.some((alias) => titleIdentity.includes(alias));
}

function hashFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function classDetectionFingerprint(tasks: readonly DetectableTask[], classes: readonly DetectableClass[]): string {
  const taskRows = tasks
    .filter((task) => task.category === "classes")
    .map((task) => [task.id, task.title, task.course_code ?? "", task.class_id ?? "", task.updated_at].join("\u001f"))
    .sort();
  const classRows = classes
    .map((calendarClass) => [
      calendarClass.id,
      calendarClass.name,
      calendarClass.course_code ?? "",
      [...calendarClass.aliases].sort().join("\u001e"),
      calendarClass.deleted_at ?? "",
      calendarClass.updated_at,
    ].join("\u001f"))
    .sort();
  return hashFingerprint([...taskRows, "--classes--", ...classRows].join("\u001d"));
}

export function buildClassDetectionPlan(tasks: readonly DetectableTask[], classes: readonly DetectableClass[]): ClassDetectionPlan {
  const activeClasses = classes.filter((calendarClass) => !calendarClass.deleted_at);
  const classCodes = new Map(activeClasses.map((calendarClass) => [calendarClass.id, classCourseIdentities(calendarClass)]));
  const eligible = tasks.filter((task) => task.category === "classes" && !task.class_id);
  const alreadyAssignedCount = tasks.filter((task) => task.category === "classes" && Boolean(task.class_id)).length;
  const grouped = new Map<string, ClassDetectionCandidate>();
  const unmatchedTasks: UnmatchedClassTask[] = [];

  for (const task of eligible) {
    const metadataCode = extractCourseCode(task.course_code);
    const titleCode = extractCourseCode(task.title);
    const detectedCourseCode = metadataCode ?? titleCode;
    if (detectedCourseCode) {
      const codeIdentity = identity(detectedCourseCode);
      const matches = activeClasses.filter((calendarClass) => classCodes.get(calendarClass.id)?.has(codeIdentity));
      const key = `code:${codeIdentity}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.taskIds.push(task.id);
        existing.taskTitles.push(task.title);
        if (metadataCode) existing.confidence = "high";
        continue;
      }
      grouped.set(key, {
        key,
        detectedCourseCode,
        suggestedName: matches.length === 1 ? matches[0].name : detectedCourseCode,
        confidence: metadataCode ? "high" : "medium",
        source: metadataCode ? "course-code" : "title",
        taskIds: [task.id],
        taskTitles: [task.title],
        existingClassId: matches.length === 1 ? matches[0].id : null,
        ambiguousClassIds: matches.length > 1 ? matches.map((calendarClass) => calendarClass.id) : [],
      });
      continue;
    }

    const aliasMatches = activeClasses.filter((calendarClass) => matchesAlias(task.title, calendarClass));
    if (aliasMatches.length === 1) {
      const calendarClass = aliasMatches[0];
      const key = `alias:${calendarClass.id}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.taskIds.push(task.id);
        existing.taskTitles.push(task.title);
      } else {
        grouped.set(key, {
          key,
          detectedCourseCode: calendarClass.course_code,
          suggestedName: calendarClass.name,
          confidence: "medium",
          source: "alias",
          taskIds: [task.id],
          taskTitles: [task.title],
          existingClassId: calendarClass.id,
          ambiguousClassIds: [],
        });
      }
      continue;
    }

    if (aliasMatches.length > 1) {
      grouped.set(`ambiguous:${task.id}`, {
        key: `ambiguous:${task.id}`,
        detectedCourseCode: null,
        suggestedName: task.title.slice(0, 120),
        confidence: "medium",
        source: "alias",
        taskIds: [task.id],
        taskTitles: [task.title],
        existingClassId: null,
        ambiguousClassIds: aliasMatches.map((calendarClass) => calendarClass.id),
      });
      continue;
    }

    unmatchedTasks.push({ id: task.id, title: task.title });
  }

  return {
    candidates: [...grouped.values()].sort((left, right) => left.suggestedName.localeCompare(right.suggestedName)),
    unmatchedTasks: unmatchedTasks.sort((left, right) => left.title.localeCompare(right.title)),
    alreadyAssignedCount,
    eligibleCount: eligible.length,
    fingerprint: classDetectionFingerprint(tasks, classes),
  };
}
