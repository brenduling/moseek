-- Phase 4.5B: append-only, server-authored Environment activity history.
-- Deleting an Environment cascades its activity because history belongs to
-- that private space and has no standalone retention purpose.
begin;
set local lock_timeout = '5s';

create table public.environment_activity (
  id bigint generated always as identity primary key,
  environment_id uuid not null references public.environments(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  action text not null,
  target_type text not null,
  target_id uuid,
  target_label text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);
create index environment_activity_recent
  on public.environment_activity (environment_id, occurred_at desc, id desc);
alter table public.environment_activity enable row level security;
revoke all on public.environment_activity from public, anon, authenticated;
grant select on public.environment_activity to authenticated;
create policy moseek_environment_activity_member_read on public.environment_activity
  for select to authenticated using (moseek_private.current_environment_role(environment_id) is not null);

create or replace function moseek_private.record_environment_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_label text;
  row_new jsonb;
  row_old jsonb;
  chosen jsonb;
  target_environment uuid;
  target_uuid uuid;
  target_name text;
  target_kind text := tg_table_name;
  event_action text;
  detail jsonb := '{}'::jsonb;
begin
  if actor is null then return null; end if;
  if current_setting('moseek.suppress_activity', true) = 'true' then return null; end if;
  row_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  row_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  chosen := coalesce(row_new, row_old);
  target_environment := nullif(chosen->>'environment_id', '')::uuid;
  target_uuid := nullif(chosen->>'id', '')::uuid;
  target_name := nullif(chosen->>'title', '');
  if target_environment is not null and not exists (
    select 1 from public.environments e where e.id = target_environment
  ) then return null; end if;
  select coalesce(p.display_name, 'Moseek member') into actor_label
    from public.profiles p where p.id = actor;
  actor_label := coalesce(actor_label, 'Moseek member');

  if tg_table_name = 'environments' then
    target_kind := 'environment';
    target_environment := (chosen->>'id')::uuid;
    target_uuid := target_environment;
    target_name := chosen->>'name';
    if tg_op = 'DELETE' then return null;
    elsif tg_op = 'INSERT' then event_action := 'environment_created';
    elsif row_new->>'type' is distinct from row_old->>'type' then event_action := 'environment_type_changed';
    elsif row_new->>'name' is distinct from row_old->>'name'
       or row_new->>'description' is distinct from row_old->>'description' then event_action := 'environment_updated';
    else return null; end if;
    detail := jsonb_build_object('type', row_new->>'type');
  elsif tg_table_name = 'environment_members' then
    target_kind := 'contributor';
    target_uuid := nullif(chosen->>'user_id', '')::uuid;
    select coalesce(p.display_name, 'Moseek member') into target_name from public.profiles p where p.id = target_uuid;
    if tg_op = 'INSERT' then
      if (chosen->>'role') = 'owner' and target_uuid = actor then return null; end if;
      event_action := 'contributor_added';
    elsif tg_op = 'DELETE' then event_action := 'contributor_removed';
    elsif row_new->>'role' is distinct from row_old->>'role' then
      event_action := 'contributor_role_changed';
      detail := jsonb_build_object('from_role', row_old->>'role', 'to_role', row_new->>'role');
    else return null; end if;
    target_name := coalesce(target_name, 'A contributor');
  elsif tg_table_name = 'environment_invitations' then
    target_kind := 'invitation'; target_name := 'A contributor invitation';
    if tg_op = 'INSERT' then event_action := 'contributor_invited';
    elsif row_new->>'status' is distinct from row_old->>'status' and row_new->>'status' = 'accepted' then event_action := 'invitation_accepted';
    elsif row_new->>'status' is distinct from row_old->>'status' and row_new->>'status' in ('declined','revoked','expired') then
      event_action := 'invitation_' || (row_new->>'status');
    else return null; end if;
  elsif tg_table_name = 'environment_join_requests' then
    target_kind := 'join_request'; target_name := 'A request to join';
    if tg_op = 'INSERT' then event_action := 'join_request_created';
    elsif row_new->>'status' is distinct from row_old->>'status' and row_new->>'status' in ('accepted','declined','revoked','expired') then
      event_action := 'join_request_' || (row_new->>'status');
    else return null; end if;
  elsif tg_table_name = 'sections' then
    target_kind := 'section'; target_name := chosen->>'title';
    if tg_op = 'INSERT' then event_action := 'section_created';
    elsif tg_op = 'DELETE' then event_action := 'section_deleted';
    elsif row_new->>'title' is distinct from row_old->>'title' then event_action := 'section_renamed';
    elsif row_new->>'x' is distinct from row_old->>'x' or row_new->>'y' is distinct from row_old->>'y' then event_action := 'section_moved';
    elsif row_new->>'width' is distinct from row_old->>'width' or row_new->>'height' is distinct from row_old->>'height' then event_action := 'section_resized';
    else return null; end if;
  elsif tg_table_name = 'resources' then
    target_kind := coalesce(chosen->>'type', 'resource'); target_name := chosen->>'title';
    if tg_op = 'INSERT' then
      if chosen->>'type' in ('file','image') then return null; end if;
      event_action := 'resource_created';
    elsif tg_op = 'DELETE' then
      if row_old->>'type' in ('file','image') and not exists (
        select 1 from public.environment_activity a where a.environment_id = target_environment
          and a.target_id = target_uuid and a.action in ('file_uploaded','image_uploaded')) then return null; end if;
      event_action := 'resource_deleted';
    elsif row_new->>'section_id' is distinct from row_old->>'section_id' then
      event_action := case when row_new->>'section_id' is null then 'resource_detached' else 'resource_attached' end;
    elsif row_new->>'x' is distinct from row_old->>'x' or row_new->>'y' is distinct from row_old->>'y' then
      if current_setting('moseek.grouped_section_move', true) = row_new->>'section_id' then return null; end if;
      event_action := 'resource_moved';
    elsif row_new->>'width' is distinct from row_old->>'width' or row_new->>'height' is distinct from row_old->>'height' then
      event_action := 'resource_resized';
    elsif row_new->>'title' is distinct from row_old->>'title' or row_new->>'body' is distinct from row_old->>'body'
       or row_new->>'url' is distinct from row_old->>'url' then event_action := 'resource_updated';
    else return null; end if;
  elsif tg_table_name = 'environment_calendar_items' then
    target_kind := coalesce(chosen->>'item_type', 'calendar_item'); target_name := chosen->>'title';
    if tg_op = 'INSERT' then event_action := 'calendar_item_created';
    elsif tg_op = 'DELETE' then event_action := 'calendar_item_deleted';
    elsif row_new->>'status' is distinct from row_old->>'status' then
      event_action := 'calendar_status_changed';
      detail := jsonb_build_object('from_status', row_old->>'status', 'to_status', row_new->>'status');
    else event_action := 'calendar_item_updated'; end if;
  else return null; end if;

  insert into public.environment_activity
    (environment_id, actor_id, actor_name, action, target_type, target_id, target_label, metadata)
  values (target_environment, actor, actor_label, event_action, target_kind, target_uuid,
    left(coalesce(target_name, ''), 200), detail);
  return null;
end;
$$;
revoke all on function moseek_private.record_environment_activity() from public, anon, authenticated;

-- Upload history is written only after the Storage API confirms the exact
-- registered object exists, so failed metadata-first upload attempts leave no
-- false creation/deletion entries.
create or replace function public.record_environment_resource_upload(p_resource_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); item public.resources%rowtype; item_action text;
  actor_label text;
begin
  if actor is null then raise exception 'Not authorized to record this upload.' using errcode = '42501'; end if;
  select r.* into item from public.resources r where r.id = p_resource_id for update;
  if not found or item.type not in ('file','image')
     or moseek_private.current_environment_role(item.environment_id) not in ('owner','admin','editor')
     or not exists (select 1 from storage.objects o where o.bucket_id='environment-files' and o.name=item.storage_path) then
    raise exception 'The uploaded Resource could not be verified.' using errcode = '42501';
  end if;
  item_action := case when item.type = 'image' then 'image_uploaded' else 'file_uploaded' end;
  if exists (select 1 from public.environment_activity a where a.environment_id=item.environment_id
    and a.target_id=item.id and a.action=item_action) then return 'recorded'; end if;
  select coalesce(p.display_name,'Moseek member') into actor_label from public.profiles p where p.id=actor;
  insert into public.environment_activity (environment_id,actor_id,actor_name,action,target_type,target_id,target_label)
  values (item.environment_id,actor,coalesce(actor_label,'Moseek member'),item_action,item.type,item.id,left(item.title,200));
  return 'recorded';
end;
$$;

-- Attach trusted triggers to existing and newly-created tables.
do $$ declare table_name text;
begin
  foreach table_name in array array[
    'environments','environment_members','environment_invitations','environment_join_requests',
    'sections','resources','environment_calendar_items'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists moseek_record_activity on public.%I', table_name);
      execute format('create trigger moseek_record_activity after insert or update or delete on public.%I for each row execute function moseek_private.record_environment_activity()', table_name);
    end if;
  end loop;
end;
$$;

-- SECURITY DEFINER grouped movement locks are unchanged; set a transaction-local
-- marker so the child Resource triggers do not emit one history row per card.
create or replace function public.move_section_group(
  p_environment_id uuid, p_section_id uuid,
  p_x numeric, p_y numeric, p_width numeric, p_height numeric,
  p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid(); section_row public.sections%rowtype;
  delta_x numeric; delta_y numeric; moved_section public.sections%rowtype; moved_resources jsonb;
begin
  if actor_id is null or p_x is null or p_y is null or p_width is null or p_height is null
     or p_x <> p_x or p_y <> p_y or abs(p_x) > 10000000 or abs(p_y) > 10000000 then
    raise exception 'Section position is invalid.' using errcode = '22023';
  end if;
  if p_width < 360 or p_width > 1400 or p_height < 240 or p_height > 1000
     or p_width <> p_width or p_height <> p_height then
    raise exception 'Section dimensions are invalid.' using errcode = '22023';
  end if;
  perform 1 from public.environments e where e.id=p_environment_id for update;
  if not found or moseek_private.current_environment_role(p_environment_id) not in ('owner','admin','editor') then
    raise exception 'Not authorized to move this Section.' using errcode = '42501';
  end if;
  select s.* into section_row from public.sections s where s.environment_id=p_environment_id and s.id=p_section_id for update;
  if not found then raise exception 'Section is unavailable.' using errcode = '42501'; end if;
  if p_expected_updated_at is null or section_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Section changed elsewhere; reload its current position and try again.' using errcode = '40001';
  end if;
  delta_x := p_x-section_row.x; delta_y := p_y-section_row.y;
  perform r.id from public.resources r where r.environment_id=p_environment_id and r.section_id=p_section_id order by r.id for update;
  update public.sections set x=p_x,y=p_y,width=p_width,height=p_height
    where environment_id=p_environment_id and id=p_section_id returning * into moved_section;
  perform set_config('moseek.grouped_section_move',p_section_id::text,true);
  update public.resources set x=x+delta_x,y=y+delta_y where environment_id=p_environment_id and section_id=p_section_id;
  perform set_config('moseek.grouped_section_move','',true);
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) into moved_resources
    from public.resources r where r.environment_id=p_environment_id and r.section_id=p_section_id;
  return jsonb_build_object('section',to_jsonb(moved_section),'resources',moved_resources);
end;
$$;
alter function public.move_section_group(uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) owner to postgres;

revoke all on function public.record_environment_resource_upload(uuid) from public, anon;
grant execute on function public.record_environment_resource_upload(uuid) to authenticated;
revoke all on function public.move_section_group(uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) from public, anon;
grant execute on function public.move_section_group(uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) to authenticated;
commit;
