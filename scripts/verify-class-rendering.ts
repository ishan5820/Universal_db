import assert from "node:assert/strict";
import {
  categoryHex,
  resolveClassName,
  resolveTaskColor,
  solidItemColorStyle,
} from "../components/CategoryColorProvider";
import { normalizeCategoryColors, type CategoryColors } from "../lib/preferences";
import type { CalendarClass } from "../types/calendarClass";

const timestamp = "2026-09-10T17:00:00.000Z";
const classes: CalendarClass[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "ECO 304K",
    course_code: "ECO 304K",
    aliases: ["ECO304K"],
    color: "#2563EB",
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  },
];
const colors: CategoryColors = { classes: "green", orgs: "orange", social: "purple" };

assert.equal(resolveTaskColor(colors, classes, "#64748B", { category: "classes", class_id: classes[0].id }), "#2563EB");
assert.equal(resolveTaskColor(colors, classes, "#64748B", { category: "classes", class_id: null }), "#64748B");
assert.equal(resolveTaskColor(colors, classes, "#64748B", { category: "orgs", class_id: classes[0].id }), "#D97706");
assert.equal(resolveClassName(classes, { category: "classes", class_id: classes[0].id }), "ECO 304K");
assert.equal(resolveClassName(classes, { category: "classes", class_id: null }), "Unassigned");
assert.equal(resolveClassName(classes, { category: "social", class_id: null }), null);

assert.equal(categoryHex(colors, "orgs", 1), categoryHex(colors, "orgs", 5), "Legacy shades must not change the rendered color.");
const taskStyle = solidItemColorStyle("#2563EB", "task");
const eventStyle = solidItemColorStyle("#2563EB", "event");
assert.equal(taskStyle.backgroundColor, "#2563EB");
assert.equal(taskStyle.borderColor, undefined);
assert.equal(eventStyle.backgroundColor, "#2563EB1f");
assert.equal(eventStyle.borderColor, "#2563EB");

const legacyCollision = normalizeCategoryColors({ classes: "orange", orgs: "orange", social: "purple" });
assert.equal(legacyCollision.orgs, "orange", "The retired overall Classes color must not reserve an Orgs color.");
assert.notEqual(legacyCollision.orgs, legacyCollision.social);

console.log("PASS Class items use their assigned class color and unassigned items use the configured fallback.");
console.log("PASS Orgs and Social use one solid category color regardless of legacy shade data.");
console.log("PASS Tasks render solid while events retain a light fill and colored left border.");
console.log("PASS The retired overall Classes preference no longer participates in category color uniqueness.");
