-- Phase 4.5C: real Environment events and tasks with member-scoped RLS.
-- Timed values are stored as timestamptz (UTC); all-day events use date values
-- so they do not shift across viewer time zones.
begin;
set local lock_timeout = '5s';

create unique index if not exists resources_environment_resource_key
  on public.resources (environment_id, id);

create table public.environment_calendar_items (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  item_type text not null check (item_type in ('event','task')),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 4000),
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  all_day boolean not null default false,
  all_day_start date,
  all_day_end date,
  status text not null default 'event' check (status in ('event','open','in_progress','done')),
  assigned_to uuid,
  section_id uuid,
  resource_id uuid,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment_id, id),
  constraint calendar_assignee_same_environment foreign key (environment_id, assigned_to)
    references public.environment_members (environment_id, user_id) on delete set null (assigned_to),
  constraint calendar_section_same_environment foreign key (environment_id, section_id)
    references public.sections (environment_id, id) on delete set null (section_id),
  constraint calendar_resource_same_environment foreign key (environment_id, resource_id)
    references public.resources (environment_id, id) on delete set null (resource_id),
  constraint calendar_item_schedule_check check (
    (item_type = 'event' and status = 'event' and (
      (all_day and all_day_start is not null and starts_at is null and ends_at is null
        and (all_day_end is null or all_day_end >= all_day_start))
      or
      (not all_day and all_day_start is null and all_day_end is null and starts_at is not null
        and (ends_at is null or ends_at >= starts_at))
    ))
    or
    (item_type = 'task' and status in ('open','in_progress','done') and not all_day
      and starts_at is null and ends_at is null and all_day_start is null and all_day_end is null)
  )
);
create index environment_calendar_items_by_month
  on public.environment_calendar_items (environment_id, starts_at, all_day_start, due_at);
create index environment_calendar_items_by_assignee
  on public.environment_calendar_items (assigned_to, due_at) where assigned_to is not null;
create trigger moseek_calendar_set_updated_at before update on public.environment_calendar_items
  for each row execute function moseek_private.set_updated_at();

create or replace function moseek_private.validate_calendar_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); actor_role public.environment_role;
begin
  select m.role into actor_role from public.environment_members m
    where m.environment_id = new.environment_id and m.user_id = actor;
  if actor is null or actor_role not in ('owner','admin','editor') then
    raise exception 'Not authorized to manage calendar items in this Environment.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is distinct from actor then
      raise exception 'Calendar item creator must be the signed-in user.' using errcode = '42501';
    end if;
  elsif new.id is distinct from old.id or new.environment_id is distinct from old.environment_id
      or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Calendar item identity is immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function moseek_private.validate_calendar_item() from public, anon, authenticated;
create trigger moseek_validate_calendar_item before insert or update on public.environment_calendar_items
  for each row execute function moseek_private.validate_calendar_item();
alter function moseek_private.validate_calendar_item() owner to postgres;

alter table public.environment_calendar_items enable row level security;
revoke all on public.environment_calendar_items from public, anon, authenticated;
grant select on public.environment_calendar_items to authenticated;
grant insert (id,environment_id,item_type,title,description,starts_at,ends_at,due_at,all_day,
  all_day_start,all_day_end,status,assigned_to,section_id,resource_id,created_by)
  on public.environment_calendar_items to authenticated;
grant update (item_type,title,description,starts_at,ends_at,due_at,all_day,
  all_day_start,all_day_end,status,assigned_to,section_id,resource_id)
  on public.environment_calendar_items to authenticated;
grant delete on public.environment_calendar_items to authenticated;
create policy moseek_calendar_member_read on public.environment_calendar_items
  for select to authenticated using (moseek_private.current_environment_role(environment_id) is not null);
create policy moseek_calendar_editor_insert on public.environment_calendar_items
  for insert to authenticated with check (created_by = (select auth.uid())
    and moseek_private.current_environment_role(environment_id) in ('owner','admin','editor'));
create policy moseek_calendar_editor_update on public.environment_calendar_items
  for update to authenticated using (moseek_private.current_environment_role(environment_id) in ('owner','admin','editor'))
  with check (moseek_private.current_environment_role(environment_id) in ('owner','admin','editor'));
create policy moseek_calendar_editor_delete on public.environment_calendar_items
  for delete to authenticated using (moseek_private.current_environment_role(environment_id) in ('owner','admin','editor'));

create or replace function public.get_home_upcoming_calendar_items()
returns table(item_id uuid, environment_id uuid, environment_name text, title text, item_type text,
  starts_at timestamptz, due_at timestamptz, all_day_start date, status text)
language sql stable set search_path = '' as $$
  select c.id, c.environment_id, e.name, c.title, c.item_type, c.starts_at, c.due_at, c.all_day_start, c.status
  from public.environment_calendar_items c
  join public.environments e on e.id = c.environment_id
  where ((c.all_day and c.all_day_start >= current_date)
    or (not c.all_day and c.starts_at >= now())
    or c.due_at >= now())
    and (c.item_type <> 'task' or c.status <> 'done')
  order by coalesce(c.all_day_start::timestamptz, c.starts_at, c.due_at), c.id
  limit 8
$$;
revoke all on function public.get_home_upcoming_calendar_items() from public, anon;
grant execute on function public.get_home_upcoming_calendar_items() to authenticated;

-- The generic activity recorder was installed before this table existed.
create trigger moseek_record_activity after insert or update or delete on public.environment_calendar_items
  for each row execute function moseek_private.record_environment_activity();

alter function public.get_home_upcoming_calendar_items() owner to postgres;
commit;
