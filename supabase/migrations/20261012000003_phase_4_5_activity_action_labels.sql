-- Correct action label concatenation precedence in the activity trigger.
-- Kept as a forward migration so local databases that already applied 4.5B
-- receive the fix without reset or modification of existing activity rows.
begin;
create or replace function moseek_private.record_environment_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); actor_label text;
  row_new jsonb; row_old jsonb; chosen jsonb;
  target_environment uuid; target_uuid uuid; target_name text;
  target_kind text := tg_table_name; event_action text;
  detail jsonb := '{}'::jsonb;
begin
  if actor is null or current_setting('moseek.suppress_activity', true) = 'true' then return null; end if;
  row_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  row_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  chosen := coalesce(row_new, row_old);
  target_environment := nullif(chosen->>'environment_id', '')::uuid;
  target_uuid := nullif(chosen->>'id', '')::uuid;
  target_name := nullif(chosen->>'title', '');
  if target_environment is not null and not exists (
    select 1 from public.environments e where e.id = target_environment
  ) then return null; end if;
  select coalesce(p.display_name, 'Moseek member') into actor_label from public.profiles p where p.id = actor;
  actor_label := coalesce(actor_label, 'Moseek member');

  if tg_table_name = 'environments' then
    target_kind := 'environment'; target_environment := (chosen->>'id')::uuid;
    target_uuid := target_environment; target_name := chosen->>'name';
    if tg_op = 'DELETE' then return null;
    elsif tg_op = 'INSERT' then event_action := 'environment_created';
    elsif row_new->>'type' is distinct from row_old->>'type' then event_action := 'environment_type_changed';
    elsif row_new->>'name' is distinct from row_old->>'name'
       or row_new->>'description' is distinct from row_old->>'description' then event_action := 'environment_updated';
    else return null; end if;
    detail := jsonb_build_object('type', row_new->>'type');
  elsif tg_table_name = 'environment_members' then
    target_kind := 'contributor'; target_uuid := nullif(chosen->>'user_id', '')::uuid;
    select coalesce(p.display_name, 'Moseek member') into target_name from public.profiles p where p.id = target_uuid;
    if tg_op = 'INSERT' then
      if chosen->>'role' = 'owner' and target_uuid = actor then return null; end if;
      event_action := 'contributor_added';
    elsif tg_op = 'DELETE' then event_action := 'contributor_removed';
    elsif row_new->>'role' is distinct from row_old->>'role' then
      event_action := 'contributor_role_changed'; detail := jsonb_build_object('from_role', row_old->>'role', 'to_role', row_new->>'role');
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
      if chosen->>'type' in ('file','image') then return null; end if; event_action := 'resource_created';
    elsif tg_op = 'DELETE' then
      if row_old->>'type' in ('file','image') and not exists (select 1 from public.environment_activity a
        where a.environment_id = target_environment and a.target_id = target_uuid and a.action in ('file_uploaded','image_uploaded')) then return null; end if;
      event_action := 'resource_deleted';
    elsif row_new->>'section_id' is distinct from row_old->>'section_id' then
      event_action := case when row_new->>'section_id' is null then 'resource_detached' else 'resource_attached' end;
    elsif row_new->>'x' is distinct from row_old->>'x' or row_new->>'y' is distinct from row_old->>'y' then
      if current_setting('moseek.grouped_section_move', true) = row_new->>'section_id' then return null; end if; event_action := 'resource_moved';
    elsif row_new->>'width' is distinct from row_old->>'width' or row_new->>'height' is distinct from row_old->>'height' then event_action := 'resource_resized';
    elsif row_new->>'title' is distinct from row_old->>'title' or row_new->>'body' is distinct from row_old->>'body'
       or row_new->>'url' is distinct from row_old->>'url' then event_action := 'resource_updated';
    else return null; end if;
  elsif tg_table_name = 'environment_calendar_items' then
    target_kind := coalesce(chosen->>'item_type', 'calendar_item'); target_name := chosen->>'title';
    if tg_op = 'INSERT' then event_action := 'calendar_item_created';
    elsif tg_op = 'DELETE' then event_action := 'calendar_item_deleted';
    elsif row_new->>'status' is distinct from row_old->>'status' then
      event_action := 'calendar_status_changed'; detail := jsonb_build_object('from_status', row_old->>'status', 'to_status', row_new->>'status');
    else event_action := 'calendar_item_updated'; end if;
  else return null; end if;

  insert into public.environment_activity (environment_id, actor_id, actor_name, action, target_type, target_id, target_label, metadata)
  values (target_environment, actor, actor_label, event_action, target_kind, target_uuid, left(coalesce(target_name, ''), 200), detail);
  return null;
end;
$$;
alter function moseek_private.record_environment_activity() owner to postgres;
revoke all on function moseek_private.record_environment_activity() from public, anon, authenticated;
commit;
