-- Persist the Stage 2-5 class registry in each signed-in user's cloud backup.
-- Existing calendar items remain valid because class_id is nullable. The
-- composite foreign key prevents a user from linking an item to another
-- user's class, even if a UUID is guessed.

create table public.calendar_classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  course_code text,
  aliases text[] not null default '{}',
  color text not null,
  revision bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_classes_user_id_id_key unique (user_id, id),
  constraint calendar_classes_name_check check (
    char_length(btrim(name)) between 1 and 120
  ),
  constraint calendar_classes_course_code_check check (
    course_code is null or char_length(course_code) <= 100
  ),
  constraint calendar_classes_aliases_check check (
    cardinality(aliases) <= 30
  ),
  constraint calendar_classes_color_check check (
    color ~ '^#[0-9A-F]{6}$'
  ),
  constraint calendar_classes_revision_check check (revision > 0)
);

create index calendar_classes_user_id_idx
  on public.calendar_classes (user_id, id);

create unique index calendar_classes_user_active_name_key
  on public.calendar_classes (user_id, lower(name))
  where deleted_at is null;

create unique index calendar_classes_user_active_color_key
  on public.calendar_classes (user_id, color)
  where deleted_at is null;

create trigger calendar_classes_set_sync_metadata
before insert or update on public.calendar_classes
for each row execute function private.set_sync_metadata();

alter table public.calendar_items
  add column class_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'calendar_items_class_fkey'
      and conrelid = 'public.calendar_items'::regclass
  ) then
    alter table public.calendar_items
      add constraint calendar_items_class_fkey
      foreign key (user_id, class_id)
      references public.calendar_classes (user_id, id);
  end if;
end $$;

alter table public.calendar_items
  add constraint calendar_items_class_category_check
  check (class_id is null or category = 'classes');

create index calendar_items_user_class_idx
  on public.calendar_items (user_id, class_id, due_date)
  where deleted_at is null and class_id is not null;

alter table public.user_settings
  add column unassigned_color text not null default '#64748B';

alter table public.user_settings
  add constraint user_settings_unassigned_color_check
  check (unassigned_color ~ '^#[0-9A-F]{6}$');

alter table public.user_settings
  drop constraint user_settings_unique_colors_check;

alter table public.user_settings
  add constraint user_settings_orgs_social_colors_check
  check (orgs_color <> social_color);

alter table public.calendar_classes enable row level security;
alter table public.calendar_classes force row level security;

revoke all on table public.calendar_classes from anon, authenticated;

grant select on table public.calendar_classes to authenticated;
grant insert (
  id, user_id, name, course_code, aliases, color, deleted_at
) on public.calendar_classes to authenticated;
grant update (
  name, course_code, aliases, color, deleted_at
) on public.calendar_classes to authenticated;

grant insert (class_id) on public.calendar_items to authenticated;
grant update (class_id) on public.calendar_items to authenticated;
grant insert (unassigned_color) on public.user_settings to authenticated;
grant update (unassigned_color) on public.user_settings to authenticated;

grant select, insert, update, delete on table public.calendar_classes to service_role;

create policy calendar_classes_select_own
on public.calendar_classes
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy calendar_classes_insert_own
on public.calendar_classes
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy calendar_classes_update_own
on public.calendar_classes
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

comment on table public.calendar_classes is
  'User-owned class names, matching aliases, and colors. deleted_at is a sync tombstone.';

comment on column public.calendar_items.class_id is
  'Optional user-owned class assignment for items in the Classes category.';

comment on column public.user_settings.unassigned_color is
  'Solid calendar color for Classes items without a class assignment.';
