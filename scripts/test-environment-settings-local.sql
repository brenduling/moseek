\set ON_ERROR_STOP on

-- Authenticated-only Environment details tests. All synthetic rows are created
-- in this transaction and rolled back at the end.
begin;
set local client_min_messages = notice;

select gen_random_uuid() as owner_id \gset
select gen_random_uuid() as admin_id \gset
select gen_random_uuid() as editor_id \gset
select gen_random_uuid() as viewer_id \gset
select gen_random_uuid() as outsider_id \gset
select gen_random_uuid() as environment_id \gset

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
) values
  (:'owner_id'::uuid, 'authenticated', 'authenticated', 'phase41a-owner-' || :'owner_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'admin_id'::uuid, 'authenticated', 'authenticated', 'phase41a-admin-' || :'admin_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'editor_id'::uuid, 'authenticated', 'authenticated', 'phase41a-editor-' || :'editor_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'viewer_id'::uuid, 'authenticated', 'authenticated', 'phase41a-viewer-' || :'viewer_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'outsider_id'::uuid, 'authenticated', 'authenticated', 'phase41a-outsider-' || :'outsider_id' || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false);

select set_config('moseek.test.owner', :'owner_id', true);
select set_config('moseek.test.admin', :'admin_id', true);
select set_config('moseek.test.editor', :'editor_id', true);
select set_config('moseek.test.viewer', :'viewer_id', true);
select set_config('moseek.test.outsider', :'outsider_id', true);
select set_config('moseek.test.environment', :'environment_id', true);

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
values (current_setting('moseek.test.environment')::uuid, 'Initial title', 'shared', auth.uid());
insert into public.environment_members (environment_id, user_id, role) values
  (current_setting('moseek.test.environment')::uuid, current_setting('moseek.test.admin')::uuid, 'admin'),
  (current_setting('moseek.test.environment')::uuid, current_setting('moseek.test.editor')::uuid, 'editor'),
  (current_setting('moseek.test.environment')::uuid, current_setting('moseek.test.viewer')::uuid, 'viewer');

update public.environments
set name = 'Owner title', description = 'Owner description'
where id = current_setting('moseek.test.environment')::uuid;
select pg_temp.assert(
  (select name = 'Owner title' and description = 'Owner description'
   from public.environments where id = current_setting('moseek.test.environment')::uuid),
  'Owner can update and read back Environment name and description'
);

-- Existing grants intentionally exclude type. The authenticated Owner cannot
-- use the client role to change Personal/Shared type.
do $$
begin
  begin
    update public.environments set type = 'personal'
    where id = current_setting('moseek.test.environment')::uuid;
    raise exception 'ASSERT FAILED: Owner changed Environment type';
  exception when insufficient_privilege then
    raise notice 'PASS: Environment type remains immutable to authenticated Owner';
  end;
end;
$$;

-- The database constraints remain the final guard even if a client bypasses
-- the form's validation.
do $$
begin
  begin
    update public.environments set name = '   '
    where id = current_setting('moseek.test.environment')::uuid;
    raise exception 'ASSERT FAILED: empty Environment name was accepted';
  exception when check_violation then
    raise notice 'PASS: Database rejects an empty Environment name';
  end;
  begin
    update public.environments set name = repeat('n', 161)
    where id = current_setting('moseek.test.environment')::uuid;
    raise exception 'ASSERT FAILED: overlong Environment name was accepted';
  exception when check_violation then
    raise notice 'PASS: Database rejects Environment names over 160 characters';
  end;
  begin
    update public.environments set description = repeat('x', 2001)
    where id = current_setting('moseek.test.environment')::uuid;
    raise exception 'ASSERT FAILED: oversized description was accepted';
  exception when check_violation then
    raise notice 'PASS: Database rejects descriptions over 2000 characters';
  end;
end;
$$;

select pg_temp.assume_user(current_setting('moseek.test.admin')::uuid);
update public.environments set name = 'Admin title', description = 'Admin description'
where id = current_setting('moseek.test.environment')::uuid;
select pg_temp.assert(
  (select name = 'Admin title' and description = 'Admin description'
   from public.environments where id = current_setting('moseek.test.environment')::uuid),
  'Admin can update and read back Environment name and description'
);

select pg_temp.assume_user(current_setting('moseek.test.editor')::uuid);
do $$
declare affected bigint;
begin
  update public.environments set name = 'Editor unauthorized', description = 'Editor unauthorized'
  where id = current_setting('moseek.test.environment')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Editor updated Environment details'; end if;
  raise notice 'PASS: Editor cannot update Environment details';
end;
$$;

select pg_temp.assume_user(current_setting('moseek.test.viewer')::uuid);
do $$
declare affected bigint;
begin
  update public.environments set name = 'Viewer unauthorized', description = 'Viewer unauthorized'
  where id = current_setting('moseek.test.environment')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: Viewer updated Environment details'; end if;
  raise notice 'PASS: Viewer cannot update Environment details';
end;
$$;

select pg_temp.assume_user(current_setting('moseek.test.outsider')::uuid);
select pg_temp.assert(not exists (
  select 1 from public.environments where id = current_setting('moseek.test.environment')::uuid
), 'Outsider cannot read the Environment');
do $$
declare affected bigint;
begin
  update public.environments set name = 'Outsider unauthorized', description = 'Outsider unauthorized'
  where id = current_setting('moseek.test.environment')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ASSERT FAILED: outsider updated Environment details'; end if;
  raise notice 'PASS: Outsider cannot update Environment details';
end;
$$;

reset role;
rollback;
