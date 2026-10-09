-- Follow-up guard: section and resource row records have different shapes,
-- so branch before reading table-specific fields from a trigger record.
begin;
set local lock_timeout = '5s';

create or replace function moseek_private.lock_canvas_environment_positions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'resources' then
      if new.section_id is null then return new; end if;
    end if;
  elsif tg_table_name = 'sections' then
    if new.x is not distinct from old.x and new.y is not distinct from old.y
       and new.width is not distinct from old.width and new.height is not distinct from old.height then
      return new;
    end if;
  elsif new.x is not distinct from old.x and new.y is not distinct from old.y
      and new.section_id is not distinct from old.section_id then
    return new;
  end if;

  perform 1 from public.environments e where e.id = new.environment_id for update;
  if not found then raise exception 'Environment is unavailable.' using errcode = '23503'; end if;
  return new;
end;
$$;

commit;
