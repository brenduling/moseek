-- Completed tasks remain in the calendar and activity history, but no longer
-- appear as upcoming work on Home.
begin;
create or replace function public.get_home_upcoming_calendar_items()
returns table(item_id uuid, environment_id uuid, environment_name text, title text, item_type text,
  starts_at timestamptz, due_at timestamptz, all_day_start date, status text)
language sql stable set search_path = '' as $$
  select c.id, c.environment_id, e.name, c.title, c.item_type,
    c.starts_at, c.due_at, c.all_day_start, c.status
  from public.environment_calendar_items c
  join public.environments e on e.id = c.environment_id
  where ((c.all_day and c.all_day_start >= current_date)
    or (not c.all_day and c.starts_at >= now())
    or c.due_at >= now())
    and (c.item_type <> 'task' or c.status <> 'done')
  order by coalesce(c.all_day_start::timestamptz, c.starts_at, c.due_at), c.id
  limit 8
$$;
alter function public.get_home_upcoming_calendar_items() owner to postgres;
revoke all on function public.get_home_upcoming_calendar_items() from public, anon;
grant execute on function public.get_home_upcoming_calendar_items() to authenticated;
commit;
