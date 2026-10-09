-- Phase 4.0: enforce the four Environment roles in PostgreSQL and Storage.
begin;
set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.oid = 'public.environment_role'::regtype and e.enumlabel = 'viewer'
  ) then
    raise exception 'Viewer role label is missing; apply the preceding Phase 4.0 migration first';
  end if;
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.oid = 'public.environment_role'::regtype and e.enumlabel = 'member'
  ) then
    raise exception 'Legacy member role label remains; apply the Phase 4.0 role rename first';
  end if;
end;
$$;

-- Owners can manage all regular contributors. Admins can manage Editors and
-- Viewers, but cannot create, edit, or remove Admin or Owner memberships.
drop policy if exists moseek_members_insert on public.environment_members;
create policy moseek_members_insert on public.environment_members for insert to authenticated
with check (
  exists (select 1 from public.environments e
    where e.id = environment_id and e.type = 'shared')
  and (
    (moseek_private.current_environment_role(environment_id) = 'owner'
      and role in ('admin', 'editor', 'viewer'))
    or (moseek_private.current_environment_role(environment_id) = 'admin'
      and role in ('editor', 'viewer'))
  )
);

drop policy if exists moseek_members_update on public.environment_members;
create policy moseek_members_update on public.environment_members for update to authenticated
using (
  role <> 'owner'
  and (
    moseek_private.current_environment_role(environment_id) = 'owner'
    or (moseek_private.current_environment_role(environment_id) = 'admin'
      and role in ('editor', 'viewer'))
  )
)
with check (
  role in ('admin', 'editor', 'viewer')
  and (
    moseek_private.current_environment_role(environment_id) = 'owner'
    or (moseek_private.current_environment_role(environment_id) = 'admin'
      and role in ('editor', 'viewer'))
  )
);

drop policy if exists moseek_members_delete on public.environment_members;
create policy moseek_members_delete on public.environment_members for delete to authenticated
using (
  role <> 'owner'
  and (
    moseek_private.current_environment_role(environment_id) = 'owner'
    or (moseek_private.current_environment_role(environment_id) = 'admin'
      and role in ('editor', 'viewer'))
  )
);

-- Owner, Admin, and Editor retain the current shared content and color
-- permissions. Viewer remains able to read through the existing SELECT rules.
drop policy if exists moseek_sections_insert on public.sections;
create policy moseek_sections_insert on public.sections for insert to authenticated
with check (
  created_by = (select auth.uid())
  and moseek_private.current_environment_role(environment_id) in ('owner', 'admin', 'editor')
);
drop policy if exists moseek_sections_update on public.sections;
create policy moseek_sections_update on public.sections for update to authenticated
using (moseek_private.current_environment_role(environment_id) in ('owner', 'admin', 'editor'))
with check (moseek_private.current_environment_role(environment_id) in ('owner', 'admin', 'editor'));
drop policy if exists moseek_sections_delete on public.sections;
create policy moseek_sections_delete on public.sections for delete to authenticated
using (moseek_private.current_environment_role(environment_id) in ('owner', 'admin', 'editor'));

drop policy if exists moseek_resources_insert on public.resources;
create policy moseek_resources_insert on public.resources for insert to authenticated
with check (
  created_by = (select auth.uid())
  and moseek_private.current_environment_role(environment_id) in ('owner', 'admin', 'editor')
);
drop policy if exists moseek_resources_update on public.resources;
create policy moseek_resources_update on public.resources for update to authenticated
using (moseek_private.current_environment_role(environment_id) in ('owner', 'admin', 'editor'))
with check (moseek_private.current_environment_role(environment_id) in ('owner', 'admin', 'editor'));
drop policy if exists moseek_resources_delete on public.resources;
create policy moseek_resources_delete on public.resources for delete to authenticated
using (moseek_private.current_environment_role(environment_id) in ('owner', 'admin', 'editor'));

-- Reads remain available to all Environment members. Upload and remove require
-- a role that can manage content; path access still requires an exact File row.
create or replace function moseek_private.can_manage_file_path(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  path_environment uuid;
begin
  if not moseek_private.can_access_file_path(object_name) then
    return false;
  end if;
  path_environment := split_part(object_name, '/', 1)::uuid;
  return moseek_private.current_environment_role(path_environment) in ('owner', 'admin', 'editor');
end;
$$;
revoke all on function moseek_private.can_manage_file_path(text) from public, anon, authenticated;
grant execute on function moseek_private.can_manage_file_path(text) to authenticated;

drop policy if exists moseek_files_insert on storage.objects;
create policy moseek_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'environment-files' and moseek_private.can_manage_file_path(name));
drop policy if exists moseek_files_delete on storage.objects;
create policy moseek_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'environment-files' and moseek_private.can_manage_file_path(name));

-- Restrictive guards ensure another permissive Storage policy cannot grant a
-- Viewer upload or removal access to this bucket.
drop policy if exists moseek_files_insert_guard on storage.objects;
create policy moseek_files_insert_guard on storage.objects as restrictive
for insert to authenticated
with check (bucket_id <> 'environment-files' or moseek_private.can_manage_file_path(name));
drop policy if exists moseek_files_delete_guard on storage.objects;
create policy moseek_files_delete_guard on storage.objects as restrictive
for delete to authenticated
using (bucket_id <> 'environment-files' or moseek_private.can_manage_file_path(name));

commit;
