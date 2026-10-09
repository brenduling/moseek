-- Phase 4.4: serialize canvas position writes and move Section contents as one unit.
begin;
set local lock_timeout = '5s';

create or replace function moseek_private.lock_canvas_environment_positions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'resources' and new.section_id is null then return new; end if;
  elsif new.x is not distinct from old.x and new.y is not distinct from old.y
      and (tg_table_name <> 'sections' or (new.width is not distinct from old.width and new.height is not distinct from old.height))
      and (tg_table_name <> 'resources' or new.section_id is not distinct from old.section_id) then
    return new;
  end if;

  perform 1 from public.environments e where e.id = new.environment_id for update;
  if not found then raise exception 'Environment is unavailable.' using errcode = '23503'; end if;
  return new;
end;
$$;
revoke all on function moseek_private.lock_canvas_environment_positions() from public, anon, authenticated;

drop trigger if exists moseek_lock_section_positions on public.sections;
create trigger moseek_lock_section_positions before insert or update on public.sections
for each row execute function moseek_private.lock_canvas_environment_positions();
drop trigger if exists moseek_lock_resource_positions on public.resources;
create trigger moseek_lock_resource_positions before insert or update on public.resources
for each row execute function moseek_private.lock_canvas_environment_positions();

create or replace function public.move_section_group(
  p_environment_id uuid,
  p_section_id uuid,
  p_x numeric,
  p_y numeric,
  p_width numeric,
  p_height numeric,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  section_row public.sections%rowtype;
  delta_x numeric;
  delta_y numeric;
  moved_section public.sections%rowtype;
  moved_resources jsonb;
begin
  if actor_id is null or p_x is null or p_y is null or p_width is null or p_height is null
     or p_x <> p_x or p_y <> p_y
     or abs(p_x) > 10000000 or abs(p_y) > 10000000 then
    raise exception 'Section position is invalid.' using errcode = '22023';
  end if;
  if p_width < 360 or p_width > 1400 or p_height < 240 or p_height > 1000
     or p_width <> p_width or p_height <> p_height then
    raise exception 'Section dimensions are invalid.' using errcode = '22023';
  end if;

  perform 1 from public.environments e where e.id = p_environment_id for update;
  if not found or moseek_private.current_environment_role(p_environment_id) not in ('owner', 'admin', 'editor') then
    raise exception 'Not authorized to move this Section.' using errcode = '42501';
  end if;
  select s.* into section_row from public.sections s
    where s.environment_id = p_environment_id and s.id = p_section_id for update;
  if not found then raise exception 'Section is unavailable.' using errcode = '42501'; end if;
  if p_expected_updated_at is null or section_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Section changed elsewhere; reload its current position and try again.' using errcode = '40001';
  end if;

  delta_x := p_x - section_row.x;
  delta_y := p_y - section_row.y;
  perform r.id from public.resources r
    where r.environment_id = p_environment_id and r.section_id = p_section_id
    order by r.id for update;

  update public.sections s set x = p_x, y = p_y, width = p_width, height = p_height
    where s.environment_id = p_environment_id and s.id = p_section_id returning s.* into moved_section;
  update public.resources r set x = r.x + delta_x, y = r.y + delta_y
    where r.environment_id = p_environment_id and r.section_id = p_section_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) into moved_resources
    from public.resources r where r.environment_id = p_environment_id and r.section_id = p_section_id;
  return jsonb_build_object('section', to_jsonb(moved_section), 'resources', moved_resources);
end;
$$;

alter function public.move_section_group(uuid, uuid, numeric, numeric, numeric, numeric, timestamptz) owner to postgres;
revoke all on function public.move_section_group(uuid, uuid, numeric, numeric, numeric, numeric, timestamptz) from public, anon;
grant execute on function public.move_section_group(uuid, uuid, numeric, numeric, numeric, numeric, timestamptz) to authenticated;

commit;
