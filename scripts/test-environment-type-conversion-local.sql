\set ON_ERROR_STOP on

-- All fixtures are synthetic and transactional. The caller must connect only
-- to supabase_db_moseek / postgres; this file never commits test data.
begin;
set local client_min_messages = notice;

select gen_random_uuid() as owner_id \gset
select gen_random_uuid() as shared_owner_id \gset
select gen_random_uuid() as admin_id \gset
select gen_random_uuid() as editor_id \gset
select gen_random_uuid() as viewer_id \gset
select gen_random_uuid() as outsider_id \gset
select gen_random_uuid() as personal_environment_id \gset
select gen_random_uuid() as shared_environment_id \gset

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
) values
  (:'owner_id'::uuid, 'authenticated', 'authenticated', 'phase41b-owner-' || :'owner_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'shared_owner_id'::uuid, 'authenticated', 'authenticated', 'phase41b-alone-' || :'shared_owner_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'admin_id'::uuid, 'authenticated', 'authenticated', 'phase41b-admin-' || :'admin_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'editor_id'::uuid, 'authenticated', 'authenticated', 'phase41b-editor-' || :'editor_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'viewer_id'::uuid, 'authenticated', 'authenticated', 'phase41b-viewer-' || :'viewer_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'outsider_id'::uuid, 'authenticated', 'authenticated', 'phase41b-outsider-' || :'outsider_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false);

select set_config('moseek.test.owner', :'owner_id', true);
select set_config('moseek.test.shared_owner', :'shared_owner_id', true);
select set_config('moseek.test.admin', :'admin_id', true);
select set_config('moseek.test.editor', :'editor_id', true);
select set_config('moseek.test.viewer', :'viewer_id', true);
select set_config('moseek.test.outsider', :'outsider_id', true);
select set_config('moseek.test.personal_environment', :'personal_environment_id', true);
select set_config('moseek.test.shared_environment', :'shared_environment_id', true);

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
  if condition is distinct from true then raise exception 'ASSERT FAILED: %', description; end if;
  raise notice 'PASS: %', description;
end;
$$;

set local role authenticated;
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);

insert into public.environments (id, name, type, created_by)
values (current_setting('moseek.test.personal_environment')::uuid, 'Personal conversion fixture', 'personal', auth.uid());

-- Owner-only shared fixture is created by its own authenticated identity.
select pg_temp.assume_user(current_setting('moseek.test.shared_owner')::uuid);
insert into public.environments (id, name, type, created_by)
values (current_setting('moseek.test.shared_environment')::uuid, 'Shared conversion fixture', 'shared', auth.uid());

-- Build preservation fixtures before converting Personal -> Shared.
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
insert into public.sections (id, environment_id, title, x, y, width, height, created_by)
values (gen_random_uuid(), current_setting('moseek.test.personal_environment')::uuid,
  'Preserved Section', 31, 47, 500, 320, auth.uid()) returning id \gset
select set_config('moseek.test.section_id', :'id', true);
update public.sections set card_color = 'sage' where id = current_setting('moseek.test.section_id')::uuid;
insert into public.resources (id, environment_id, created_by, type, title, body, x, y)
values (gen_random_uuid(), current_setting('moseek.test.personal_environment')::uuid, auth.uid(), 'note',
  'Preserved Note', 'Keep this note', 75, 91) returning id \gset
select set_config('moseek.test.note_id', :'id', true);
update public.resources set card_color = 'clay' where id = current_setting('moseek.test.note_id')::uuid;
insert into public.resources (id, environment_id, created_by, type, title, url, x, y)
values (gen_random_uuid(), current_setting('moseek.test.personal_environment')::uuid, auth.uid(), 'link',
  'Preserved Link', 'https://example.invalid', 130, 180);
with file_id as (select gen_random_uuid() as id)
insert into public.resources (id, environment_id, created_by, type, title, original_filename, mime_type,
  file_size, storage_path, x, y)
select file_id.id, e.id, auth.uid(), 'file', 'Preserved File', 'notes.pdf', 'application/pdf',
  128, e.id::text || '/' || file_id.id::text || '/file.pdf', 200, 240
from public.environments e cross join file_id
where e.id = current_setting('moseek.test.personal_environment')::uuid;
insert into public.environment_color_preferences (user_id, environment_id, card_color)
values (auth.uid(), current_setting('moseek.test.personal_environment')::uuid, 'sand');

select pg_temp.assert(auth.uid() = current_setting('moseek.test.owner')::uuid,
  'Authenticated test context uses the Personal Environment Owner identity');

-- Personal -> Shared succeeds and keeps the Owner, all content, positions,
-- shared colors, and the personal color preference unchanged.
select * from public.convert_environment_type(current_setting('moseek.test.personal_environment')::uuid, 'shared');
select pg_temp.assert((select type = 'shared' from public.environments
  where id = current_setting('moseek.test.personal_environment')::uuid),
  'Owner converts Personal to Shared');
select pg_temp.assert((select count(*) = 1 from public.list_environment_default_invitation_code(
  current_setting('moseek.test.personal_environment')::uuid) where state = 'active' and approval_required),
  'Personal to Shared provisions an approval-required default code');
select pg_temp.assert((select count(*) = 1 from public.environment_members
  where environment_id = current_setting('moseek.test.personal_environment')::uuid
    and user_id = current_setting('moseek.test.owner')::uuid and role = 'owner'),
  'Personal to Shared preserves the Owner membership');
select pg_temp.assert((select count(*) = 3 from public.resources
  where environment_id = current_setting('moseek.test.personal_environment')::uuid)
  and (select count(*) = 1 from public.sections
  where environment_id = current_setting('moseek.test.personal_environment')::uuid),
  'Personal to Shared preserves Section, Note, Link, and File records');
select pg_temp.assert((select x = 31 and y = 47 and card_color = 'sage' from public.sections
  where id = current_setting('moseek.test.section_id')::uuid)
  and (select x = 75 and y = 91 and card_color = 'clay' from public.resources
  where id = current_setting('moseek.test.note_id')::uuid),
  'Personal to Shared preserves positions and shared card colors');
select pg_temp.assert((select x = 130 and y = 180 from public.resources
  where environment_id = current_setting('moseek.test.personal_environment')::uuid and type = 'link')
  and (select x = 200 and y = 240 and storage_path = environment_id::text || '/' || id::text || '/file.pdf'
    from public.resources where environment_id = current_setting('moseek.test.personal_environment')::uuid and type = 'file'),
  'Personal to Shared preserves Link and File positions and the File Storage key');
select pg_temp.assert((select card_color = 'sand' from public.environment_color_preferences
  where user_id = current_setting('moseek.test.owner')::uuid
    and environment_id = current_setting('moseek.test.personal_environment')::uuid),
  'Personal to Shared preserves the Owner personal Environment color');

-- Shared -> Personal is rejected with a contributor, and the type is unchanged.
insert into public.environment_members (environment_id, user_id, role) values
  (current_setting('moseek.test.personal_environment')::uuid, current_setting('moseek.test.admin')::uuid, 'admin'),
  (current_setting('moseek.test.personal_environment')::uuid, current_setting('moseek.test.editor')::uuid, 'editor'),
  (current_setting('moseek.test.personal_environment')::uuid, current_setting('moseek.test.viewer')::uuid, 'viewer');
do $$
begin
  begin
    perform * from public.convert_environment_type(current_setting('moseek.test.personal_environment')::uuid, 'personal');
    raise exception 'ASSERT FAILED: Shared to Personal accepted existing contributors';
  exception when check_violation then
    raise notice 'PASS: Shared to Personal is rejected while contributors remain';
  end;
end;
$$;
select pg_temp.assert((select type = 'shared' from public.environments
  where id = current_setting('moseek.test.personal_environment')::uuid),
  'Blocked Shared to Personal leaves the original type unchanged');

-- A separate Shared Environment with only its Owner may become Personal.
select pg_temp.assume_user(current_setting('moseek.test.shared_owner')::uuid);
select * from public.convert_environment_type(current_setting('moseek.test.shared_environment')::uuid, 'personal');
select pg_temp.assert((select type = 'personal' from public.environments
  where id = current_setting('moseek.test.shared_environment')::uuid),
  'Owner converts Shared to Personal when the Owner is the sole member');
select pg_temp.assert((select count(*) = 0 from public.list_environment_default_invitation_code(
  current_setting('moseek.test.shared_environment')::uuid) where state = 'active'),
  'Shared to Personal conversion revokes its active default code');

-- Admin, Editor, Viewer, and outsider must all be rejected by the function.
select pg_temp.assume_user(current_setting('moseek.test.admin')::uuid);
do $$ begin
  begin perform * from public.convert_environment_type(current_setting('moseek.test.personal_environment')::uuid, 'shared');
    raise exception 'ASSERT FAILED: Admin converted Environment type';
  exception when insufficient_privilege then raise notice 'PASS: Admin cannot convert Environment type'; end;
end $$;
select pg_temp.assume_user(current_setting('moseek.test.editor')::uuid);
do $$ begin
  begin perform * from public.convert_environment_type(current_setting('moseek.test.personal_environment')::uuid, 'shared');
    raise exception 'ASSERT FAILED: Editor converted Environment type';
  exception when insufficient_privilege then raise notice 'PASS: Editor cannot convert Environment type'; end;
end $$;
select pg_temp.assume_user(current_setting('moseek.test.viewer')::uuid);
do $$ begin
  begin perform * from public.convert_environment_type(current_setting('moseek.test.personal_environment')::uuid, 'shared');
    raise exception 'ASSERT FAILED: Viewer converted Environment type';
  exception when insufficient_privilege then raise notice 'PASS: Viewer cannot convert Environment type'; end;
end $$;
select pg_temp.assume_user(current_setting('moseek.test.outsider')::uuid);
do $$ begin
  begin perform * from public.convert_environment_type(current_setting('moseek.test.personal_environment')::uuid, 'shared');
    raise exception 'ASSERT FAILED: outsider converted Environment type';
  exception when insufficient_privilege then raise notice 'PASS: outsider cannot convert Environment type'; end;
end $$;

-- Direct type changes remain blocked even if a caller forges the transaction
-- marker. No authenticated role receives UPDATE privilege on the type column.
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
do $$ begin
  begin
    update public.environments set type = 'personal'
    where id = current_setting('moseek.test.personal_environment')::uuid;
    raise exception 'ASSERT FAILED: direct type UPDATE succeeded';
  exception when insufficient_privilege then raise notice 'PASS: direct authenticated type UPDATE is denied'; end;
end $$;
select set_config('moseek.environment_type_conversion', current_setting('moseek.test.personal_environment'), true);
do $$ begin
  begin
    update public.environments set type = 'personal'
    where id = current_setting('moseek.test.personal_environment')::uuid;
    raise exception 'ASSERT FAILED: caller-forged conversion marker bypassed type protection';
  exception when insufficient_privilege then raise notice 'PASS: caller-forged marker cannot grant type UPDATE privilege'; end;
end $$;

-- Type conversion does not bypass membership policy: once private, another
-- authenticated user cannot join through direct membership INSERT.
select pg_temp.assume_user(current_setting('moseek.test.shared_owner')::uuid);
do $$ begin
  begin
    insert into public.environment_members (environment_id, user_id, role)
    values (current_setting('moseek.test.shared_environment')::uuid,
      current_setting('moseek.test.editor')::uuid, 'editor');
    raise exception 'ASSERT FAILED: contributor joined Personal Environment';
  exception when others then
    if sqlerrm = 'ASSERT FAILED: contributor joined Personal Environment' then raise; end if;
    raise notice 'PASS: Personal Environment still rejects contributor membership';
  end;
end $$;

reset role;
rollback;
