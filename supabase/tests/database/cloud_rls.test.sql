begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;

select plan(49);

select has_table('public', 'calendar_items', 'calendar_items exists');
select has_table('public', 'subtasks', 'subtasks exists');
select has_table('public', 'user_settings', 'user_settings exists');
select has_table('public', 'calendar_classes', 'calendar_classes exists');
select has_column('public', 'calendar_items', 'class_id', 'calendar_items can reference a class');
select has_column('public', 'user_settings', 'unassigned_color', 'user settings store the Unassigned color');

select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.calendar_items'::regclass),
  true,
  'calendar_items has RLS enabled'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.subtasks'::regclass),
  true,
  'subtasks has RLS enabled'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.user_settings'::regclass),
  true,
  'user_settings has RLS enabled'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.calendar_classes'::regclass),
  true,
  'calendar_classes has RLS enabled'
);

select is(
  (select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'calendar_items'),
  3,
  'calendar_items has one policy for each permitted operation'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'subtasks'),
  3,
  'subtasks has one policy for each permitted operation'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'user_settings'),
  3,
  'user_settings has one policy for each permitted operation'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'calendar_classes'),
  3,
  'calendar_classes has one policy for each permitted operation'
);

select ok(
  to_regclass('public._migrations') is null,
  'migration history is not exposed through a public _migrations table'
);
select ok(
  not has_table_privilege('anon', 'public.calendar_items', 'select'),
  'anonymous visitors have no calendar read grant'
);
select ok(
  not has_table_privilege('anon', 'public.calendar_items', 'insert'),
  'anonymous visitors have no calendar write grant'
);
select ok(
  not has_table_privilege('anon', 'public.calendar_classes', 'select'),
  'anonymous visitors have no class read grant'
);
select ok(
  has_table_privilege('authenticated', 'public.calendar_items', 'select'),
  'signed-in users have a calendar read grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.calendar_items', 'delete'),
  'browser clients cannot hard-delete sync records'
);
select ok(
  has_table_privilege('authenticated', 'public.calendar_classes', 'select'),
  'signed-in users have a class read grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.calendar_classes', 'delete'),
  'browser clients cannot hard-delete class sync records'
);
select ok(
  not has_function_privilege('authenticated', 'private.set_sync_metadata()', 'execute'),
  'metadata trigger cannot be called directly by browser clients'
);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'rls-user-a@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'rls-user-b@example.invalid');

insert into public.calendar_classes (
  id, user_id, name, course_code, aliases, color
)
values (
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  '22222222-2222-4222-8222-222222222222',
  'User B class',
  'B 101',
  array['B101'],
  '#2563EB'
);

insert into public.calendar_items (
  id, user_id, title, category, source, kind, due_date
)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '22222222-2222-4222-8222-222222222222',
  'User B task',
  'classes',
  'manual',
  'task',
  '2026-09-03'
);

insert into public.subtasks (
  id, user_id, calendar_item_id, title
)
values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'User B subtask'
);

insert into public.user_settings (user_id)
values ('22222222-2222-4222-8222-222222222222');

set local role anon;
select throws_ok(
  $$select count(*) from public.calendar_items$$,
  '42501',
  'permission denied for table calendar_items',
  'anonymous visitors cannot read calendar items'
);
select throws_ok(
  $$insert into public.calendar_items (user_id, title, category) values ('11111111-1111-4111-8111-111111111111', 'No access', 'classes')$$,
  '42501',
  'permission denied for table calendar_items',
  'anonymous visitors cannot insert calendar items'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.calendar_classes (id, user_id, name, course_code, aliases, color) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'User A class', 'A 101', array['A101'], '#059669')$$,
  'a signed-in user can insert their own class'
);
select results_eq(
  $$select name from public.calendar_classes order by name$$,
  $$values ('User A class'::text)$$,
  'user A can read only their own classes'
);
select throws_ok(
  $$insert into public.calendar_classes (user_id, name, color) values ('22222222-2222-4222-8222-222222222222', 'Wrong owner class', '#DC2626')$$,
  '42501',
  'new row violates row-level security policy for table "calendar_classes"',
  'user A cannot insert a class owned by user B'
);
select lives_ok(
  $$insert into public.calendar_items (id, user_id, title, category) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'User A task', 'orgs')$$,
  'a signed-in user can insert their own calendar item'
);
select results_eq(
  $$select title from public.calendar_items order by title$$,
  $$values ('User A task'::text)$$,
  'user A can read only their own calendar items'
);
select throws_ok(
  $$insert into public.calendar_items (user_id, title, category) values ('22222222-2222-4222-8222-222222222222', 'Wrong owner', 'social')$$,
  '42501',
  'new row violates row-level security policy for table "calendar_items"',
  'user A cannot insert a calendar item owned by user B'
);
select results_eq(
  $$update public.calendar_items set title = 'User A updated' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' returning title$$,
  $$values ('User A updated'::text)$$,
  'user A can update their own calendar item'
);
select is(
  (select revision from public.calendar_items where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  2::bigint,
  'the database increments the sync revision on update'
);
select results_eq(
  $$update public.calendar_items set title = 'Compromised' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning title$$,
  $$select null::text where false$$,
  'user A cannot update user B calendar items'
);
select throws_ok(
  $$update public.calendar_items set user_id = '22222222-2222-4222-8222-222222222222' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501',
  'permission denied for table calendar_items',
  'browser clients cannot reassign ownership'
);
select throws_ok(
  $$delete from public.calendar_items where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501',
  'permission denied for table calendar_items',
  'browser clients cannot bypass tombstones with a hard delete'
);
select lives_ok(
  $$insert into public.subtasks (id, user_id, calendar_item_id, title) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'User A subtask')$$,
  'user A can add a subtask to their own calendar item'
);
select results_eq(
  $$select title from public.subtasks order by title$$,
  $$values ('User A subtask'::text)$$,
  'user A can read only their own subtasks'
);
select throws_ok(
  $$insert into public.subtasks (user_id, calendar_item_id, title) values ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cross-user subtask')$$,
  '23503',
  'insert or update on table "subtasks" violates foreign key constraint "subtasks_parent_fkey"',
  'a subtask cannot reference another user parent'
);
select throws_ok(
  $$insert into public.calendar_items (user_id, title, category, class_id) values ('11111111-1111-4111-8111-111111111111', 'Cross-user class link', 'classes', 'ffffffff-ffff-4fff-8fff-ffffffffffff')$$,
  '23503',
  'insert or update on table "calendar_items" violates foreign key constraint "calendar_items_class_fkey"',
  'a calendar item cannot reference another user class'
);
select lives_ok(
  $$insert into public.user_settings (user_id, classes_color, orgs_color, social_color) values ('11111111-1111-4111-8111-111111111111', 'blue', 'red', 'yellow')$$,
  'user A can save their own preferences'
);
select throws_ok(
  $$update public.user_settings set social_color = 'red' where user_id = '11111111-1111-4111-8111-111111111111'$$,
  '23514',
  'new row for relation "user_settings" violates check constraint "user_settings_orgs_social_colors_check"',
  'Orgs and Social cannot use the same color'
);
select is(
  (select count(*) from public.user_settings),
  1::bigint,
  'user A can read only their own settings row'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

select results_eq(
  $$select title from public.calendar_items order by title$$,
  $$values ('User B task'::text)$$,
  'user B can read only their own calendar items'
);
select results_eq(
  $$select title from public.subtasks order by title$$,
  $$values ('User B subtask'::text)$$,
  'user B can read only their own subtasks'
);
select results_eq(
  $$select name from public.calendar_classes order by name$$,
  $$values ('User B class'::text)$$,
  'user B can read only their own classes'
);
select is(
  (select count(*) from public.user_settings),
  1::bigint,
  'user B can read only their own settings row'
);
select results_eq(
  $$update public.calendar_items set title = 'Compromised by B' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' returning title$$,
  $$select null::text where false$$,
  'user B cannot update user A calendar items'
);
select results_eq(
  $$update public.calendar_items set deleted_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' returning id$$,
  $$select null::uuid where false$$,
  'user B cannot soft-delete user A calendar items'
);

select * from finish();
rollback;
