import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { categoryHex, itemColorStyle } from "../components/CategoryColorProvider";
import { normalizeCategoryColors, type CategoryColors } from "../lib/preferences";

const colors: CategoryColors = { classes: "blue", orgs: "red", social: "yellow" };
const classShades = new Set(([1, 2, 3, 4, 5] as const).map((shade) => categoryHex(colors, "classes", shade)));
assert.equal(classShades.size, 5, "Each category must retain five distinct item shades.");

const taskStyle = itemColorStyle(colors, "classes", 3, "task");
const eventStyle = itemColorStyle(colors, "classes", 3, "event");
assert.equal(taskStyle.backgroundColor, categoryHex(colors, "classes", 3));
assert.equal(taskStyle.borderColor, undefined);
assert.equal(eventStyle.borderColor, categoryHex(colors, "classes", 3));
assert.notEqual(eventStyle.backgroundColor, eventStyle.borderColor);

const repaired = normalizeCategoryColors({ classes: "green", orgs: "green", social: "green" });
assert.equal(new Set(Object.values(repaired)).size, 3, "Categories must use different base colors.");

const workspaceSource = readFileSync(new URL("../components/CategoryWorkspace.tsx", import.meta.url), "utf8");
const taskListSource = readFileSync(new URL("../components/CategoryTaskList.tsx", import.meta.url), "utf8");
assert.doesNotMatch(workspaceSource, /Manage Classes|Organize Classes|ClassDetectionReview|ManageClassesModal/);
assert.doesNotMatch(taskListSource, /ClassSelectField|Class \(optional\)/);
assert.match(taskListSource, /New item color shade/);

console.log("PASS Classes, Orgs, and Social retain distinct selectable category colors.");
console.log("PASS Tasks and events retain five selectable shades with their original visual treatment.");
console.log("PASS Per-class color management controls are absent from the calendar UI.");
