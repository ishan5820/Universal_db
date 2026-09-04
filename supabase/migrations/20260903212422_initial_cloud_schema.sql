-- Universal Dashboard cloud persistence.
-- Browser clients use the publishable key and can reach only rows owned by the
-- signed-in user. Hard deletes are intentionally withheld from clients so a
-- deletion can be synchronized to other devices through deleted_at tombstones.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_sync_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := statement_timestamp();
    new.updated_at := new.created_at;
  else
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function private.set_sync_metadata() from public, anon, authenticated;

create table public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  canvas_uid text,
  title text not null,
  description text,
  due_date date,
  due_time time(0) without time zone,
  location text,
  category text not null,
  course_code text,
  is_pinned boolean not null default false,
  is_completed boolean not null default false,
  source text not null default 'manual',
  kind text not null default 'task',
  color_shade smallint not null default 3,
  end_time time(0) without time zone,
  series_id uuid,
  recurrence_rule text,
  series_until date,
  import_batch_id uuid,
  revision bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_items_user_id_id_key unique (user_id, id),
  constraint calendar_items_title_check check (
    char_length(btrim(title)) between 1 and 500
  ),
  constraint calendar_items_description_check check (
    description is null or char_length(description) <= 100000
  ),
  constraint calendar_items_canvas_uid_check check (
    canvas_uid is null or char_length(btrim(canvas_uid)) between 1 and 2048
  ),
  constraint calendar_items_location_check check (
    location is null or char_length(location) <= 1000
  ),
  constraint calendar_items_course_code_check check (
    course_code is null or char_length(course_code) <= 100
  ),
  constraint calendar_items_category_check check (
    category in ('classes', 'orgs', 'social')
  ),
  constraint calendar_items_source_check check (
    source in ('manual', 'ical')
  ),
  constraint calendar_items_kind_check check (
    kind in ('task', 'event')
  ),
  constraint calendar_items_color_shade_check check (
    color_shade between 1 and 5
  ),
  constraint calendar_items_revision_check check (revision > 0),
  constraint calendar_items_event_completion_check check (
    kind <> 'event' or is_completed = false
  ),
  constraint calendar_items_end_time_check check (
    kind = 'event' or end_time is null
  ),
  constraint calendar_items_due_time_check check (
    due_time is null or due_date is not null
  ),
  constraint calendar_items_recurrence_rule_check check (
    recurrence_rule is null or char_length(recurrence_rule) <= 4000
  )
);

create index calendar_items_user_due_idx
  on public.calendar_items (user_id, due_date, due_time, id)
  where deleted_at is null;

create index calendar_items_user_category_idx
  on public.calendar_items (user_id, category, is_completed, due_date)
  where deleted_at is null;

create unique index calendar_items_user_canvas_uid_key
  on public.calendar_items (user_id, canvas_uid)
  where canvas_uid is not null and deleted_at is null;

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  calendar_item_id uuid not null,
  title text not null,
  is_completed boolean not null default false,
  revision bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subtasks_parent_fkey foreign key (user_id, calendar_item_id)
    references public.calendar_items (user_id, id) on delete cascade,
  constraint subtasks_title_check check (
    char_length(btrim(title)) between 1 and 500
  ),
  constraint subtasks_revision_check check (revision > 0)
);

create index subtasks_user_parent_idx
  on public.subtasks (user_id, calendar_item_id, created_at)
  where deleted_at is null;

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  classes_color text not null default 'green',
  orgs_color text not null default 'orange',
  social_color text not null default 'purple',
  calendar_view text not null default 'month',
  classes_workspace_view text not null default 'list',
  orgs_workspace_view text not null default 'list',
  social_workspace_view text not null default 'list',
  local_migration_completed_at timestamptz,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_classes_color_check check (
    classes_color in ('green', 'orange', 'purple', 'blue', 'red', 'pink', 'teal', 'yellow', 'gray')
  ),
  constraint user_settings_orgs_color_check check (
    orgs_color in ('green', 'orange', 'purple', 'blue', 'red', 'pink', 'teal', 'yellow', 'gray')
  ),
  constraint user_settings_social_color_check check (
    social_color in ('green', 'orange', 'purple', 'blue', 'red', 'pink', 'teal', 'yellow', 'gray')
  ),
  constraint user_settings_unique_colors_check check (
    classes_color <> orgs_color
    and classes_color <> social_color
    and orgs_color <> social_color
  ),
  constraint user_settings_calendar_view_check check (
    calendar_view in ('month', 'week')
  ),
  constraint user_settings_classes_workspace_view_check check (
    classes_workspace_view in ('list', 'calendar')
  ),
  constraint user_settings_orgs_workspace_view_check check (
    orgs_workspace_view in ('list', 'calendar')
  ),
  constraint user_settings_social_workspace_view_check check (
    social_workspace_view in ('list', 'calendar')
  ),
  constraint user_settings_revision_check check (revision > 0)
);

create trigger calendar_items_set_sync_metadata
before insert or update on public.calendar_items
for each row execute function private.set_sync_metadata();

create trigger subtasks_set_sync_metadata
before insert or update on public.subtasks
for each row execute function private.set_sync_metadata();

create trigger user_settings_set_sync_metadata
before insert or update on public.user_settings
for each row execute function private.set_sync_metadata();

alter table public.calendar_items enable row level security;
alter table public.calendar_items force row level security;
alter table public.subtasks enable row level security;
alter table public.subtasks force row level security;
alter table public.user_settings enable row level security;
alter table public.user_settings force row level security;

revoke all on table public.calendar_items from anon, authenticated;
revoke all on table public.subtasks from anon, authenticated;
revoke all on table public.user_settings from anon, authenticated;

grant select on table public.calendar_items to authenticated;
grant insert (
  id, user_id, canvas_uid, title, description, due_date, due_time, location,
  category, course_code, is_pinned, is_completed, source, kind, color_shade,
  end_time, series_id, recurrence_rule, series_until, import_batch_id, deleted_at
) on public.calendar_items to authenticated;
grant update (
  canvas_uid, title, description, due_date, due_time, location, category,
  course_code, is_pinned, is_completed, source, kind, color_shade, end_time,
  series_id, recurrence_rule, series_until, import_batch_id, deleted_at
) on public.calendar_items to authenticated;

grant select on table public.subtasks to authenticated;
grant insert (
  id, user_id, calendar_item_id, title, is_completed, deleted_at
) on public.subtasks to authenticated;
grant update (
  calendar_item_id, title, is_completed, deleted_at
) on public.subtasks to authenticated;

grant select on table public.user_settings to authenticated;
grant insert (
  user_id, classes_color, orgs_color, social_color, calendar_view,
  classes_workspace_view, orgs_workspace_view, social_workspace_view,
  local_migration_completed_at
) on public.user_settings to authenticated;
grant update (
  classes_color, orgs_color, social_color, calendar_view,
  classes_workspace_view, orgs_workspace_view, social_workspace_view,
  local_migration_completed_at
) on public.user_settings to authenticated;

grant select, insert, update, delete on table
  public.calendar_items,
  public.subtasks,
  public.user_settings
to service_role;

create policy calendar_items_select_own
on public.calendar_items
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy calendar_items_insert_own
on public.calendar_items
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy calendar_items_update_own
on public.calendar_items
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy subtasks_select_own
on public.subtasks
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy subtasks_insert_own
on public.subtasks
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy subtasks_update_own
on public.subtasks
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy user_settings_select_own
on public.user_settings
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy user_settings_insert_own
on public.user_settings
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy user_settings_update_own
on public.user_settings
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

comment on table public.calendar_items is
  'User-owned Universal Dashboard tasks and calendar events. deleted_at is a sync tombstone.';
comment on table public.subtasks is
  'User-owned subtasks; the composite foreign key prevents cross-user parent references.';
comment on table public.user_settings is
  'User-owned calendar view and color preferences.';
