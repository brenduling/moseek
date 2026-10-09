\set ON_ERROR_STOP on

-- Phase 4.0 authenticated RLS regression suite. All fixtures, including the
-- Storage metadata row, are synthetic and enclosed in a transaction rolled
-- back at the end. No Storage bytes are created.
begin;
set local client_min_messages = notice;

select gen_random_uuid() as owner_id \gset
select gen_random_uuid() as admin_id \gset
select gen_random_uuid() as editor_id \gset
select gen_random_uuid() as viewer_id \gset
select gen_random_uuid() as contributor_id \gset
select gen_random_uuid() as outsider_id \gset
select gen_random_uuid() as shared_id \gset
select gen_random_uuid() as personal_id \gset
select gen_random_uuid() as section_id \gset
select gen_random_uuid() as note_id \gset
select gen_random_uuid() as link_id \gset
select gen_random_uuid() as file_id \gset

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
) values
  (:'owner_id'::uuid, 'authenticated', 'authenticated', 'phase40-owner-' || :'owner_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'admin_id'::uuid, 'authenticated', 'authenticated', 'phase40-admin-' || :'admin_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'editor_id'::uuid, 'authenticated', 'authenticated', 'phase40-editor-' || :'editor_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'viewer_id'::uuid, 'authenticated', 'authenticated', 'phase40-viewer-' || :'viewer_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'contributor_id'::uuid, 'authenticated', 'authenticated', 'phase40-contributor-' || :'contributor_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'outsider_id'::uuid, 'authenticated', 'authenticated', 'phase40-outsider-' || :'outsider_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false);

select set_config('moseek.test.owner', :'owner_id', true);
select set_config('moseek.test.admin', :'admin_id', true);
select set_config('moseek.test.editor', :'editor_id', true);
select set_config('moseek.test.viewer', :'viewer_id', true);
select set_config('moseek.test.contributor', :'contributor_id', true);
select set_config('moseek.test.outsider', :'outsider_id', true);
select set_config('moseek.test.shared', :'shared_id', true);
select set_config('moseek.test.personal', :'personal_id', true);
select set_config('moseek.test.section', :'section_id', true);
select set_config('moseek.test.note', :'note_id', true);
select set_config('moseek.test.link', :'link_id', true);
select set_config('moseek.test.file', :'file_id', true);

create function pg_temp.assume_user(actor uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.assert(condition boolean, description text) returns void
language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'ASSERT FAILED: %', description;
  end if;
  raise notice 'PASS: %', description;
end;
$$;

set local role authenticated;
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);

-- Create fixtures through the same authenticated RLS path as the app.
insert into public.environments (id, name, type, created_by)
values (current_setting('moseek.test.shared')::uuid, 'Phase 4.0 shared fixture', 'shared', auth.uid());
select pg_temp.assert(
  (select count(*) = 1 from public.environment_members
    where environment_id = current_setting('moseek.test.shared')::uuid
      and user_id = auth.uid() and role = 'owner'),
  'Owner Environment insert creates exactly one protected Owner membership'
);

insert into public.environments (id, name, type, created_by)
values (current_setting('moseek.test.personal')::uuid, 'Phase 4.0 personal fixture', 'personal', auth.uid());
insert into public.environment_members (environment_id, user_id, role) values
  (current_setting('moseek.test.shared')::uuid, current_setting('moseek.test.admin')::uuid, 'admin'),
  (current_setting('moseek.test.shared')::uuid, current_setting('moseek.test.editor')::uuid, 'editor'),
  (current_setting('moseek.test.shared')::uuid, current_setting('moseek.test.viewer')::uuid, 'viewer');
insert into public.sections (id, environment_id, title, width, height, created_by)
values (current_setting('moseek.test.section')::uuid, current_setting('moseek.test.shared')::uuid,
  'Role fixture Section', 400, 280, auth.uid());
insert into public.resources (id, environment_id, created_by, type, title, body)
values (current_setting('moseek.test.note')::uuid, current_setting('moseek.test.shared')::uuid,
  auth.uid(), 'note', 'Role fixture Note', 'Temporary');
insert into public.resources (id, environment_id, created_by, type, title, url)
values (current_setting('moseek.test.link')::uuid, current_setting('moseek.test.shared')::uuid,
  auth.uid(), 'link', 'Role fixture Link', 'https://example.invalid/');
insert into public.resources (
  id, environment_id, created_by, type, title, original_filename, mime_type, file_size, storage_path
) values (
  current_setting('moseek.test.file')::uuid, current_setting('moseek.test.shared')::uuid,
  auth.uid(), 'file', 'Role fixture File', 'role-fixture.txt', 'text/plain', 1,
  current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'
);
update public.sections set title = 'Owner-updated Section', card_color = 'mist'
where id = current_setting('moseek.test.section')::uuid;
update public.resources set body = 'Owner edit', card_color = 'sand'
where id = current_setting('moseek.test.note')::uuid;
insert into public.resources (environment_id, created_by, type, title, body)
values (current_setting('moseek.test.shared')::uuid, auth.uid(), 'note', 'Owner-delete fixture', 'Temporary');
delete from public.resources where title = 'Owner-delete fixture';
select pg_temp.assert(
  (select title = 'Owner-updated Section' and card_color = 'mist' from public.sections where id = current_setting('moseek.test.section')::uuid)
  and (select body = 'Owner edit' and card_color = 'sand' from public.resources where id = current_setting('moseek.test.note')::uuid)
  and not exists (select 1 from public.resources where title = 'Owner-delete fixture'),
  'Owner retains full content and shared-color control'
);
select pg_temp.assert(moseek_private.can_manage_file_path(
  current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Owner can manage an exact member File path');

select pg_temp.assert(
  (select count(*) = 1 from public.environment_members where environment_id = current_setting('moseek.test.personal')::uuid)
  and not exists (select 1 from public.environment_members where environment_id = current_setting('moseek.test.personal')::uuid and role <> 'owner'),
  'Personal Environment contains only its Owner'
);

-- Owner management: grant only the four supported roles, and keep the owner row immutable.
do $$
declare affected bigint;
begin
  begin
    insert into public.environment_members (environment_id, user_id, role)
    values (current_setting('moseek.test.personal')::uuid, current_setting('moseek.test.editor')::uuid, 'editor');
    raise exception 'ASSERT FAILED: Personal Environment accepted another member';
  exception when raise_exception then
    if sqlerrm <> 'Personal Environments only permit their owner' then raise; end if;
    raise notice 'PASS: Personal Environment rejects membership insertion';
  end;
  update public.environment_members set role = 'editor'
    where environment_id = current_setting('moseek.test.shared')::uuid and role = 'owner';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Owner role was changed'; end if;
  raise notice 'PASS: Owner membership role cannot be changed';
  delete from public.environment_members
    where environment_id = current_setting('moseek.test.shared')::uuid and role = 'owner';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Owner membership was deleted'; end if;
  raise notice 'PASS: Owner membership cannot be deleted';
  begin
    insert into public.environment_members (environment_id, user_id, role)
    values (current_setting('moseek.test.shared')::uuid, current_setting('moseek.test.outsider')::uuid, 'owner');
    raise exception 'ASSERT FAILED: a second Owner was created';
  exception when raise_exception then
    if sqlerrm <> 'Owner membership must match Environment creator' then raise; end if;
    raise notice 'PASS: Owner cannot create a second Owner through membership insertion';
  end;
end;
$$;

-- Admin can manage regular contributors and content, but cannot grant or assume Admin.
select pg_temp.assume_user(current_setting('moseek.test.admin')::uuid);
select pg_temp.assert(moseek_private.can_manage_file_path(
  current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Admin can manage an exact member File path');
insert into public.environment_members (environment_id, user_id, role)
values (current_setting('moseek.test.shared')::uuid, current_setting('moseek.test.contributor')::uuid, 'editor');
select pg_temp.assert(
  exists (select 1 from public.environment_members where user_id = current_setting('moseek.test.contributor')::uuid and role = 'editor'),
  'Admin can add a regular Editor contributor'
);
do $$
declare affected bigint;
begin
  begin
    insert into public.environment_members (environment_id, user_id, role)
    values (current_setting('moseek.test.shared')::uuid, current_setting('moseek.test.outsider')::uuid, 'admin');
    raise exception 'ASSERT FAILED: Admin created another Admin';
  exception when insufficient_privilege then
    raise notice 'PASS: Admin cannot grant Admin privileges';
  end;
  begin
    update public.environment_members set role = 'admin'
    where environment_id = current_setting('moseek.test.shared')::uuid
      and user_id = current_setting('moseek.test.contributor')::uuid;
    raise exception 'ASSERT FAILED: Admin promoted a contributor to Admin';
  exception when insufficient_privilege then
    raise notice 'PASS: Admin cannot promote a regular contributor to Admin';
  end;
  update public.environment_members set role = 'editor'
    where environment_id = current_setting('moseek.test.shared')::uuid and role = 'owner';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Admin changed the Owner role'; end if;
  raise notice 'PASS: Admin cannot change the Owner role';
  delete from public.environment_members
    where environment_id = current_setting('moseek.test.shared')::uuid and role = 'owner';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Admin removed the Owner'; end if;
  raise notice 'PASS: Admin cannot remove the Owner';
end;
$$;
update public.environment_members set role = 'viewer'
where environment_id = current_setting('moseek.test.shared')::uuid
  and user_id = current_setting('moseek.test.contributor')::uuid;
select pg_temp.assert(
  exists (select 1 from public.environment_members where user_id = current_setting('moseek.test.contributor')::uuid and role = 'viewer'),
  'Admin can change a regular contributor role'
);
delete from public.environment_members where environment_id = current_setting('moseek.test.shared')::uuid
  and user_id = current_setting('moseek.test.contributor')::uuid;
select pg_temp.assert(not exists (select 1 from public.environment_members where user_id = current_setting('moseek.test.contributor')::uuid),
  'Admin can remove a regular contributor');
update public.environments set name = 'Phase 4.0 admin update'
where id = current_setting('moseek.test.shared')::uuid;
select pg_temp.assert((select name = 'Phase 4.0 admin update' from public.environments where id = current_setting('moseek.test.shared')::uuid),
  'Admin retains Environment name update permission');
do $$
declare affected bigint;
begin
  delete from public.environments where id = current_setting('moseek.test.shared')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Admin deleted the Environment'; end if;
  raise notice 'PASS: Admin cannot delete the Environment';
  delete from public.environment_members where environment_id = current_setting('moseek.test.shared')::uuid
    and user_id = current_setting('moseek.test.admin')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Admin changed own membership'; end if;
  raise notice 'PASS: Admin cannot change or remove own membership';
end;
$$;

-- Editors retain existing content, position, delete, and shared-color rights.
select pg_temp.assume_user(current_setting('moseek.test.editor')::uuid);
insert into public.sections (environment_id, title, width, height, created_by)
values (current_setting('moseek.test.shared')::uuid, 'Editor-created Section', 240, 180, auth.uid());
select pg_temp.assert((select count(*) = 1 from public.sections where title = 'Editor-created Section'),
  'Editor can create a Section');
update public.sections set title = 'Editor-updated Section', card_color = 'sage'
where id = current_setting('moseek.test.section')::uuid;
update public.resources set body = 'Editor edit', card_color = 'clay'
where id = current_setting('moseek.test.note')::uuid;
select pg_temp.assert(
  (select title = 'Editor-updated Section' and card_color = 'sage' from public.sections where id = current_setting('moseek.test.section')::uuid)
  and (select body = 'Editor edit' and card_color = 'clay' from public.resources where id = current_setting('moseek.test.note')::uuid),
  'Editor can edit content and shared Section/Note colors'
);
insert into public.resources (environment_id, created_by, type, title, body)
values (current_setting('moseek.test.shared')::uuid, auth.uid(), 'note', 'Editor-created Note', 'Temporary');
select pg_temp.assert((select count(*) = 1 from public.resources where title = 'Editor-created Note'),
  'Editor can create a Resource');
delete from public.resources where title = 'Editor-created Note';
select pg_temp.assert(not exists (select 1 from public.resources where title = 'Editor-created Note'),
  'Editor can delete a Resource');
do $$
declare affected bigint;
begin
  update public.environments set name = 'Editor must not change settings'
  where id = current_setting('moseek.test.shared')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Editor updated Environment settings'; end if;
  raise notice 'PASS: Editor cannot change Environment settings';
  begin
    insert into public.environment_members (environment_id, user_id, role)
    values (current_setting('moseek.test.shared')::uuid, current_setting('moseek.test.outsider')::uuid, 'viewer');
    raise exception 'ASSERT FAILED: Editor managed membership';
  exception when insufficient_privilege then
    raise notice 'PASS: Editor cannot add contributors';
  end;
  update public.environment_members set role = 'viewer'
    where environment_id = current_setting('moseek.test.shared')::uuid and user_id = current_setting('moseek.test.viewer')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Editor changed a contributor role'; end if;
  raise notice 'PASS: Editor cannot change contributor roles';
  delete from public.environment_members where environment_id = current_setting('moseek.test.shared')::uuid
    and user_id = current_setting('moseek.test.viewer')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Editor removed a contributor'; end if;
  raise notice 'PASS: Editor cannot remove contributors';
  delete from public.environment_members where environment_id = current_setting('moseek.test.shared')::uuid
    and user_id = auth.uid();
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Editor changed own membership'; end if;
  raise notice 'PASS: Editor cannot change or remove own membership';
  begin
    update public.sections set environment_id = current_setting('moseek.test.personal')::uuid
    where id = current_setting('moseek.test.section')::uuid;
    raise exception 'ASSERT FAILED: Editor moved a Section across Environments';
  exception when insufficient_privilege then
    raise notice 'PASS: Editor cannot change a Section Environment ID';
  end;
end;
$$;

-- Viewers can read shared content but every write path is denied by RLS.
select pg_temp.assume_user(current_setting('moseek.test.viewer')::uuid);
select pg_temp.assert(
  (select count(*) = 1 from public.environments where id = current_setting('moseek.test.shared')::uuid)
  and (select count(*) = 1 from public.sections where id = current_setting('moseek.test.section')::uuid)
  and (select count(*) = 1 from public.resources where id = current_setting('moseek.test.note')::uuid),
  'Viewer can read Environment, Sections, and Resources'
);
select pg_temp.assert(not exists (select 1 from public.environments where id = current_setting('moseek.test.personal')::uuid),
  'Viewer cannot read another user’s Personal Environment');
do $$
declare affected bigint;
begin
  update public.sections set title = 'Viewer edit', card_color = 'mist'
    where id = current_setting('moseek.test.section')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Viewer updated Section or color'; end if;
  raise notice 'PASS: Viewer cannot update Sections or Section colors';
  update public.resources set body = 'Viewer edit', card_color = 'mist'
    where id = current_setting('moseek.test.note')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Viewer updated Resource or color'; end if;
  raise notice 'PASS: Viewer cannot update Resources or Note colors';
  delete from public.sections where id = current_setting('moseek.test.section')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Viewer deleted Section'; end if;
  raise notice 'PASS: Viewer cannot delete Sections';
  delete from public.resources where id = current_setting('moseek.test.note')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Viewer deleted Resource'; end if;
  raise notice 'PASS: Viewer cannot delete Resources';
  begin
    insert into public.sections (environment_id, title, width, height, created_by)
    values (current_setting('moseek.test.shared')::uuid, 'Viewer Section', 200, 140, auth.uid());
    raise exception 'ASSERT FAILED: Viewer created Section';
  exception when insufficient_privilege then
    raise notice 'PASS: Viewer cannot create Sections';
  end;
  begin
    insert into public.resources (environment_id, created_by, type, title, body)
    values (current_setting('moseek.test.shared')::uuid, auth.uid(), 'note', 'Viewer Note', 'Denied');
    raise exception 'ASSERT FAILED: Viewer created Resource';
  exception when insufficient_privilege then
    raise notice 'PASS: Viewer cannot create Resources';
  end;
  begin
    insert into public.environment_members (environment_id, user_id, role)
    values (current_setting('moseek.test.shared')::uuid, current_setting('moseek.test.outsider')::uuid, 'viewer');
    raise exception 'ASSERT FAILED: Viewer managed membership';
  exception when insufficient_privilege then
    raise notice 'PASS: Viewer cannot create membership';
  end;
  delete from public.environment_members where environment_id = current_setting('moseek.test.shared')::uuid
    and user_id = auth.uid();
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Viewer changed own membership'; end if;
  raise notice 'PASS: Viewer cannot change or remove own membership';
end;
$$;

-- Storage reads remain available to members. Upload/removal are restricted to
-- Owner/Admin/Editor. The temporary internal flag models the Storage API's
-- deletion guard for this synthetic metadata row only; the transaction rolls back.
select pg_temp.assert(moseek_private.can_access_file_path(
  current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Viewer can access an exact member File path');
select pg_temp.assert(not moseek_private.can_manage_file_path(
  current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Viewer cannot upload or remove a File');
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
    values ('environment-files', current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt',
      auth.uid(), auth.uid()::text, '{"mimetype":"text/plain","size":1}'::jsonb);
    raise exception 'ASSERT FAILED: Viewer uploaded a Storage object';
  exception when insufficient_privilege then
    raise notice 'PASS: Viewer cannot upload to Environment Storage';
  end;
end;
$$;
select pg_temp.assume_user(current_setting('moseek.test.editor')::uuid);
select pg_temp.assert(moseek_private.can_manage_file_path(
  current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Editor can manage an exact member File path');
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('environment-files', current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt',
  auth.uid(), auth.uid()::text, '{"mimetype":"text/plain","size":1}'::jsonb);
select pg_temp.assert((select count(*) = 1 from storage.objects
  where bucket_id = 'environment-files' and name = current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Editor can upload a Storage object for an exact File Resource');
select pg_temp.assume_user(current_setting('moseek.test.viewer')::uuid);
select pg_temp.assert((select count(*) = 1 from storage.objects
  where bucket_id = 'environment-files' and name = current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Viewer can read an Environment Storage object');
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'environment-files'
  and name = current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt';
select pg_temp.assert(exists (select 1 from storage.objects
  where bucket_id = 'environment-files' and name = current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Viewer cannot remove an Environment Storage object');
select pg_temp.assume_user(current_setting('moseek.test.editor')::uuid);
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'environment-files'
  and name = current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt';
select pg_temp.assert(not exists (select 1 from storage.objects
  where bucket_id = 'environment-files' and name = current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Editor can remove an Environment Storage object through the authorized delete policy');

-- Outsiders cannot discover or mutate the Environment or its membership/content.
select pg_temp.assume_user(current_setting('moseek.test.outsider')::uuid);
select pg_temp.assert(
  not exists (select 1 from public.environments where id = current_setting('moseek.test.shared')::uuid)
  and not exists (select 1 from public.sections where id = current_setting('moseek.test.section')::uuid)
  and not exists (select 1 from public.resources where id = current_setting('moseek.test.note')::uuid)
  and not exists (select 1 from public.environment_members where environment_id = current_setting('moseek.test.shared')::uuid),
  'Outsider cannot read Environment, memberships, Sections, or Resources'
);
select pg_temp.assert(not moseek_private.can_access_file_path(
  current_setting('moseek.test.shared') || '/' || current_setting('moseek.test.file') || '/role-fixture.txt'),
  'Outsider cannot access an Environment File path');

-- Owner can still remove an Environment, while the membership guard prevents
-- removal of its protected Owner row. The synthetic transaction rolls back.
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
delete from public.environments where id = current_setting('moseek.test.shared')::uuid;
select pg_temp.assert(not exists (select 1 from public.environments where id = current_setting('moseek.test.shared')::uuid),
  'Owner retains Environment deletion permission');

reset role;
rollback;

select not exists (select 1 from auth.users where id in
  (:'owner_id'::uuid, :'admin_id'::uuid, :'editor_id'::uuid, :'viewer_id'::uuid, :'contributor_id'::uuid, :'outsider_id'::uuid))
  and not exists (select 1 from public.environments where id in (:'shared_id'::uuid, :'personal_id'::uuid)) as test_cleanup_ok \gset
\if :test_cleanup_ok
  \echo PASS: all Phase 4.0 synthetic records cleaned by transaction rollback
\else
  \echo FAIL: Phase 4.0 synthetic records remain after rollback
  \quit 1
\endif
