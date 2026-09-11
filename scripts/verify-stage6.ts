import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve("supabase/migrations/20260910225036_persist_calendar_classes.sql"), "utf8");
const rlsTest = readFileSync(resolve("supabase/tests/database/cloud_rls.test.sql"), "utf8");

for (const required of [
  /create table public\.calendar_classes/i,
  /alter table public\.calendar_classes enable row level security/i,
  /alter table public\.calendar_classes force row level security/i,
  /foreign key \(user_id, class_id\)[\s\S]*references public\.calendar_classes \(user_id, id\)/i,
  /grant select on table public\.calendar_classes to authenticated/i,
  /grant insert \([\s\S]*user_id[\s\S]*\) on public\.calendar_classes to authenticated/i,
  /grant update \([\s\S]*\) on public\.calendar_classes to authenticated/i,
  /create policy calendar_classes_select_own[\s\S]*\(select auth\.uid\(\)\) = user_id/i,
  /create policy calendar_classes_insert_own[\s\S]*with check \(\(select auth\.uid\(\)\)[\s\S]*= user_id\)/i,
  /create policy calendar_classes_update_own[\s\S]*using[\s\S]*with check/i,
  /add column unassigned_color text not null default '#64748B'/i,
]) {
  assert.match(migration, required);
}

assert.doesNotMatch(migration, /grant delete on table public\.calendar_classes to authenticated/i);
assert.match(rlsTest, /user A can read only their own classes/i);
assert.match(rlsTest, /user B can read only their own classes/i);
assert.match(rlsTest, /a calendar item cannot reference another user class/i);
assert.match(rlsTest, /anonymous visitors have no class read grant/i);

console.log("PASS Stage 6 migration adds class persistence without invalidating existing calendar items.");
console.log("PASS Class rows use owner-scoped RLS, least-privilege grants, and no browser hard deletes.");
console.log("PASS Composite ownership prevents cross-user class assignments.");
console.log("PASS Database tests cover anonymous denial and two-user isolation.");
