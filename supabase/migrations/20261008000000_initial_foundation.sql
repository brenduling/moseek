-- Moseek's initial server-side foundation. Review before running in a Supabase
-- project. This migration does not import or replace the local prototype data.
-- Run as the Supabase database owner (postgres) so private SECURITY DEFINER
-- functions can inspect membership without invoking its RLS policy recursively.

begin;

create schema if not exists moseek_private;
revoke all on schema moseek_private from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'environment_type' and typnamespace = 'public'::regnamespace) then
    create type public.environment_type as enum ('personal', 'shared');
  end if;
  if not exists (select 1 from pg_type where typname = 'environment_role' and typnamespace = 'public'::regnamespace) then
    create type public.environment_role as enum ('owner', 'admin', 'member');
  end if;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Moseek member'
    check (length(btrim(display_name)) between 1 and 100),
  avatar_url text check (avatar_url is null or length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.environments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  type public.environment_type not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.environment_members (
  environment_id uuid not null references public.environments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.environment_role not null,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (environment_id, user_id)
);

-- Exactly one owner row may exist. A deferred constraint trigger below also
-- requires that row to exist and to match environments.created_by at commit.
create unique index if not exists environment_members_one_owner
  on public.environment_members (environment_id) where role = 'owner';
create index if not exists environment_members_by_user
  on public.environment_members (user_id, environment_id);
create index if not exists environments_by_creator
  on public.environments (created_by);

create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  x numeric(14, 2) not null default 0 check (x <> 'NaN'::numeric),
  y numeric(14, 2) not null default 0 check (y <> 'NaN'::numeric),
  width numeric(12, 2) not null check (width > 0 and width <> 'NaN'::numeric),
  height numeric(12, 2) not null check (height > 0 and height <> 'NaN'::numeric),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment_id, id)
);
create index if not exists sections_by_environment
  on public.sections (environment_id);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  section_id uuid,
  created_by uuid not null references public.profiles(id) on delete restrict,
  -- Text keeps the evolving Resource catalog easy to extend; the payload
  -- constraint below remains the authoritative allowlist and shape validator.
  type text not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text,
  url text,
  provider text check (provider is null or length(btrim(provider)) between 1 and 80),
  provider_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_metadata) = 'object' and octet_length(provider_metadata::text) <= 16384),
  x numeric(14, 2) not null default 0 check (x <> 'NaN'::numeric),
  y numeric(14, 2) not null default 0 check (y <> 'NaN'::numeric),
  width numeric(12, 2) check (width is null or (width > 0 and width <> 'NaN'::numeric)),
  height numeric(12, 2) check (height is null or (height > 0 and height <> 'NaN'::numeric)),
  original_filename text check (original_filename is null or length(btrim(original_filename)) between 1 and 255),
  mime_type text check (mime_type is null or length(btrim(mime_type)) between 1 and 255),
  file_size bigint check (file_size is null or file_size >= 0),
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A resource can only be placed in a section of its own Environment.
  -- Deleting a section removes just the section assignment, not the resource.
  constraint resources_section_same_environment
    foreign key (environment_id, section_id)
    references public.sections (environment_id, id)
    on delete set null (section_id),
  constraint resources_type_payload check (
    (type = 'note' and url is null and provider is null and provider_metadata = '{}'::jsonb
      and original_filename is null and mime_type is null and file_size is null and storage_path is null)
    or
    (type = 'link' and url is not null
      and url ~* '^https?://[^/[:space:]]+[^[:space:]]*$' and length(url) <= 2048
      and body is null and original_filename is null and mime_type is null
      and file_size is null and storage_path is null)
    or
    (type = 'file' and body is null and url is null and provider is null
      and provider_metadata = '{}'::jsonb and original_filename is not null
      and mime_type is not null and file_size is not null and storage_path is not null
      and length(storage_path) <= 600
      and storage_path ~ ('^' || environment_id::text || '/' || id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$'))
  )
);
create index if not exists resources_by_environment
  on public.resources (environment_id, created_at desc);
create index if not exists resources_by_section
  on public.resources (environment_id, section_id) where section_id is not null;
create index if not exists resources_by_creator
  on public.resources (created_by);
create unique index if not exists resources_unique_storage_path
  on public.resources (storage_path) where storage_path is not null;

create or replace function moseek_private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function moseek_private.protect_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'environments' then
    if new.id is distinct from old.id or new.created_by is distinct from old.created_by
       or new.type is distinct from old.type or new.created_at is distinct from old.created_at then
      raise exception 'Environment identity, creator, type and creation time are immutable';
    end if;
  elsif tg_table_name = 'sections' then
    if new.id is distinct from old.id or new.environment_id is distinct from old.environment_id
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'Section identity, Environment, creator and creation time are immutable';
    end if;
  elsif tg_table_name = 'resources' then
    if new.id is distinct from old.id or new.environment_id is distinct from old.environment_id
       or new.created_by is distinct from old.created_by or new.type is distinct from old.type
       or new.storage_path is distinct from old.storage_path
       or new.created_at is distinct from old.created_at then
      raise exception 'Resource identity, Environment, creator, type, file key and creation time are immutable';
    end if;
  elsif tg_table_name = 'environment_members' then
    if new.environment_id is distinct from old.environment_id or new.user_id is distinct from old.user_id
       or new.joined_at is distinct from old.joined_at then
      raise exception 'Membership identity and join time are immutable';
    end if;
  end if;
  return new;
end;
$$;

create or replace function moseek_private.validate_membership()
returns trigger language plpgsql set search_path = '' as $$
declare
  environment_kind public.environment_type;
  environment_owner uuid;
begin
  select e.type, e.created_by into environment_kind, environment_owner
  from public.environments e where e.id = new.environment_id;
  if environment_kind = 'personal' and (new.role <> 'owner' or new.user_id <> environment_owner) then
    raise exception 'Personal Environments only permit their owner';
  end if;
  if new.role = 'owner' and new.user_id <> environment_owner then
    raise exception 'Owner membership must match Environment creator';
  end if;
  return new;
end;
$$;

create or replace function moseek_private.add_environment_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.environment_members (environment_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

-- Deferred checks permit the automatic owner insert in the same transaction
-- and permit ordinary cascading deletion of the entire Environment.
create or replace function moseek_private.assert_owner_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  checked_environment uuid;
begin
  if tg_table_name = 'environments' then
    checked_environment := new.id;
  elsif tg_op = 'DELETE' then
    checked_environment := old.environment_id;
  else
    checked_environment := new.environment_id;
  end if;

  if exists (select 1 from public.environments e where e.id = checked_environment)
     and not exists (
       select 1 from public.environments e
       join public.environment_members m on m.environment_id = e.id
       where e.id = checked_environment and m.user_id = e.created_by and m.role = 'owner'
     ) then
    raise exception 'Every Environment must retain its creator as an owner member';
  end if;
  return null;
end;
$$;

-- Storage deletion must precede deletion of a file resource (or its parent
-- Environment). This avoids orphaned bytes and preserves the membership
-- check needed to authorize Storage object deletion.
create or replace function moseek_private.protect_file_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.type = 'file' and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'environment-files' and o.name = old.storage_path
  ) then
    raise exception 'Delete the Storage object before deleting its Resource';
  end if;
  return old;
end;
$$;

-- Parent deletion cascades to Resource rows. Stop it before that cascade when
-- Storage still contains bytes, so callers must remove objects through the
-- Storage API first. A future server-side deletion operation can coordinate
-- the complete sequence; this foundation intentionally blocks direct deletion.
create or replace function moseek_private.protect_environment_file_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'environment-files'
      and o.name like old.id::text || '/%'
  ) then
    raise exception 'Environment contains stored files; delete its Storage objects before deleting the Environment';
  end if;
  return old;
end;
$$;

create or replace function moseek_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'Moseek member'), 100)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists moseek_auth_user_created on auth.users;
create trigger moseek_auth_user_created after insert on auth.users
for each row execute function moseek_private.handle_new_user();

-- Existing Auth users also need a profile before creating Environments.
insert into public.profiles (id, display_name)
select u.id,
       left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), 'Moseek member'), 100)
from auth.users u
on conflict (id) do nothing;

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles', 'environments', 'environment_members', 'sections', 'resources'] loop
    execute format('drop trigger if exists moseek_set_updated_at on public.%I', table_name);
    execute format('create trigger moseek_set_updated_at before update on public.%I for each row execute function moseek_private.set_updated_at()', table_name);
  end loop;
  foreach table_name in array array['environments', 'environment_members', 'sections', 'resources'] loop
    execute format('drop trigger if exists moseek_protect_identity on public.%I', table_name);
    execute format('create trigger moseek_protect_identity before update on public.%I for each row execute function moseek_private.protect_identity()', table_name);
  end loop;
end;
$$;

drop trigger if exists moseek_validate_membership on public.environment_members;
create trigger moseek_validate_membership before insert or update on public.environment_members
for each row execute function moseek_private.validate_membership();
drop trigger if exists moseek_add_environment_owner on public.environments;
create trigger moseek_add_environment_owner after insert on public.environments
for each row execute function moseek_private.add_environment_owner();
drop trigger if exists moseek_owner_on_environment on public.environments;
create constraint trigger moseek_owner_on_environment after insert or update on public.environments
deferrable initially deferred for each row execute function moseek_private.assert_owner_membership();
drop trigger if exists moseek_owner_on_membership on public.environment_members;
create constraint trigger moseek_owner_on_membership after insert or update or delete on public.environment_members
deferrable initially deferred for each row execute function moseek_private.assert_owner_membership();
drop trigger if exists moseek_protect_file_deletion on public.resources;
create trigger moseek_protect_file_deletion before delete on public.resources
for each row execute function moseek_private.protect_file_deletion();
drop trigger if exists moseek_protect_environment_file_deletion on public.environments;
create trigger moseek_protect_environment_file_deletion before delete on public.environments
for each row execute function moseek_private.protect_environment_file_deletion();

-- This function reads the membership table as the migration owner. Its caller
-- supplies only an Environment ID; the user ID always comes from auth.uid().
-- It breaks the environment_members RLS recursion without trusting the client.
create or replace function moseek_private.current_environment_role(target_environment uuid)
returns public.environment_role language sql stable security definer set search_path = '' as $$
  select m.role from public.environment_members m
  where m.environment_id = target_environment and m.user_id = (select auth.uid())
$$;

-- A profile is visible to self and to people sharing a Shared Environment.
create or replace function moseek_private.shares_shared_environment(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.environment_members mine
    join public.environment_members theirs on theirs.environment_id = mine.environment_id
    join public.environments e on e.id = mine.environment_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = target_user and e.type = 'shared'
  )
$$;

-- Storage key: {environment_uuid}/{resource_uuid}/{opaque_object_name}.
-- Use an opaque generated basename, optionally with an extension; never the
-- human filename. A Resource row must be registered BEFORE upload. Its
-- storage_path must exactly equal the object key. No nested object segments.
-- The helper reads current membership and Resource metadata as the migration
-- owner so Storage access cannot be gained by guessing UUIDs or paths.
create or replace function moseek_private.can_access_file_path(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  path_environment uuid;
  path_resource uuid;
begin
  if (select auth.uid()) is null or object_name is null or length(object_name) > 600
     or object_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]*$' then
    return false;
  end if;
  path_environment := split_part(object_name, '/', 1)::uuid;
  path_resource := split_part(object_name, '/', 2)::uuid;
  return exists (
    select 1 from public.resources r
    join public.environment_members m on m.environment_id = r.environment_id
    where r.id = path_resource and r.environment_id = path_environment
      and r.type = 'file' and r.storage_path = object_name
      and m.user_id = (select auth.uid())
  );
end;
$$;

-- Only policy helpers are callable by authenticated database roles. The
-- private schema must remain absent from Supabase's Exposed schemas list.
revoke all on function moseek_private.set_updated_at() from public, anon, authenticated;
revoke all on function moseek_private.protect_identity() from public, anon, authenticated;
revoke all on function moseek_private.validate_membership() from public, anon, authenticated;
revoke all on function moseek_private.add_environment_owner() from public, anon, authenticated;
revoke all on function moseek_private.assert_owner_membership() from public, anon, authenticated;
revoke all on function moseek_private.protect_file_deletion() from public, anon, authenticated;
revoke all on function moseek_private.protect_environment_file_deletion() from public, anon, authenticated;
revoke all on function moseek_private.handle_new_user() from public, anon, authenticated;
revoke all on function moseek_private.current_environment_role(uuid) from public, anon;
revoke all on function moseek_private.shares_shared_environment(uuid) from public, anon;
revoke all on function moseek_private.can_access_file_path(text) from public, anon;
grant usage on schema moseek_private to authenticated;
-- This helper returns false for anon. Storage's restrictive guard below must
-- be evaluable even if another policy in the project grants anon access.
grant usage on schema moseek_private to anon;
grant execute on function moseek_private.current_environment_role(uuid) to authenticated;
grant execute on function moseek_private.shares_shared_environment(uuid) to authenticated;
grant execute on function moseek_private.can_access_file_path(text) to authenticated, anon;

alter table public.profiles enable row level security;
alter table public.environments enable row level security;
alter table public.environment_members enable row level security;
alter table public.sections enable row level security;
alter table public.resources enable row level security;

revoke all on public.profiles, public.environments, public.environment_members,
  public.sections, public.resources from anon, authenticated;
grant select on public.profiles, public.environments, public.environment_members,
  public.sections, public.resources to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
grant insert (id, name, type, created_by), update (name), delete
  on public.environments to authenticated;
grant insert (environment_id, user_id, role), update (role), delete
  on public.environment_members to authenticated;
grant insert (id, environment_id, title, x, y, width, height, created_by),
  update (title, x, y, width, height), delete on public.sections to authenticated;
grant insert (id, environment_id, section_id, created_by, type, title, body, url,
  provider, provider_metadata, x, y, width, height, original_filename, mime_type,
  file_size, storage_path),
  update (section_id, title, body, url, provider, provider_metadata,
  x, y, width, height, original_filename, mime_type, file_size), delete
  on public.resources to authenticated;

drop policy if exists moseek_profiles_select on public.profiles;
create policy moseek_profiles_select on public.profiles for select to authenticated
using (id = (select auth.uid()) or moseek_private.shares_shared_environment(id));
drop policy if exists moseek_profiles_update on public.profiles;
create policy moseek_profiles_update on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists moseek_environments_select on public.environments;
create policy moseek_environments_select on public.environments for select to authenticated
using (moseek_private.current_environment_role(id) is not null);
drop policy if exists moseek_environments_insert on public.environments;
create policy moseek_environments_insert on public.environments for insert to authenticated
with check (created_by = (select auth.uid()));
drop policy if exists moseek_environments_update on public.environments;
create policy moseek_environments_update on public.environments for update to authenticated
using (moseek_private.current_environment_role(id) in ('owner', 'admin'))
with check (moseek_private.current_environment_role(id) in ('owner', 'admin'));
drop policy if exists moseek_environments_delete on public.environments;
create policy moseek_environments_delete on public.environments for delete to authenticated
using (moseek_private.current_environment_role(id) = 'owner');

drop policy if exists moseek_members_select on public.environment_members;
create policy moseek_members_select on public.environment_members for select to authenticated
using (moseek_private.current_environment_role(environment_id) is not null);
drop policy if exists moseek_members_insert on public.environment_members;
create policy moseek_members_insert on public.environment_members for insert to authenticated
with check (
  exists (select 1 from public.environments e where e.id = environment_id and e.type = 'shared')
  and (
    (moseek_private.current_environment_role(environment_id) = 'owner' and role in ('admin', 'member'))
    or (moseek_private.current_environment_role(environment_id) = 'admin' and role = 'member')
  )
);
drop policy if exists moseek_members_update on public.environment_members;
create policy moseek_members_update on public.environment_members for update to authenticated
using (role <> 'owner' and moseek_private.current_environment_role(environment_id) = 'owner')
with check (role in ('admin', 'member') and moseek_private.current_environment_role(environment_id) = 'owner');
drop policy if exists moseek_members_delete on public.environment_members;
create policy moseek_members_delete on public.environment_members for delete to authenticated
using (
  role <> 'owner' and (
    moseek_private.current_environment_role(environment_id) = 'owner'
    or (moseek_private.current_environment_role(environment_id) = 'admin' and role = 'member')
    or user_id = (select auth.uid())
  )
);

drop policy if exists moseek_sections_select on public.sections;
create policy moseek_sections_select on public.sections for select to authenticated
using (moseek_private.current_environment_role(environment_id) is not null);
drop policy if exists moseek_sections_insert on public.sections;
create policy moseek_sections_insert on public.sections for insert to authenticated
with check (created_by = (select auth.uid()) and moseek_private.current_environment_role(environment_id) is not null);
drop policy if exists moseek_sections_update on public.sections;
create policy moseek_sections_update on public.sections for update to authenticated
using (moseek_private.current_environment_role(environment_id) is not null)
with check (moseek_private.current_environment_role(environment_id) is not null);
drop policy if exists moseek_sections_delete on public.sections;
create policy moseek_sections_delete on public.sections for delete to authenticated
using (moseek_private.current_environment_role(environment_id) is not null);

drop policy if exists moseek_resources_select on public.resources;
create policy moseek_resources_select on public.resources for select to authenticated
using (moseek_private.current_environment_role(environment_id) is not null);
drop policy if exists moseek_resources_insert on public.resources;
create policy moseek_resources_insert on public.resources for insert to authenticated
with check (created_by = (select auth.uid()) and moseek_private.current_environment_role(environment_id) is not null);
drop policy if exists moseek_resources_update on public.resources;
create policy moseek_resources_update on public.resources for update to authenticated
using (moseek_private.current_environment_role(environment_id) is not null)
with check (moseek_private.current_environment_role(environment_id) is not null);
drop policy if exists moseek_resources_delete on public.resources;
create policy moseek_resources_delete on public.resources for delete to authenticated
using (moseek_private.current_environment_role(environment_id) is not null);

-- Private Storage bucket. 25 MiB matches the current prototype's file limit.
-- An existing bucket is made private as a defensive rerun behavior.
insert into storage.buckets (id, name, public, file_size_limit)
values ('environment-files', 'environment-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists moseek_files_select on storage.objects;
create policy moseek_files_select on storage.objects for select to authenticated
using (bucket_id = 'environment-files' and moseek_private.can_access_file_path(name));
drop policy if exists moseek_files_insert on storage.objects;
create policy moseek_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'environment-files' and moseek_private.can_access_file_path(name));
drop policy if exists moseek_files_delete on storage.objects;
create policy moseek_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'environment-files' and moseek_private.can_access_file_path(name));
-- Restrictive policies also protect this bucket if the project already has a
-- permissive Storage policy for another bucket. They do not grant access to
-- any other bucket; those buckets still need their own permissive policies.
drop policy if exists moseek_files_bucket_guard on storage.objects;
create policy moseek_files_bucket_guard on storage.objects as restrictive
for all to public
using (bucket_id <> 'environment-files' or moseek_private.can_access_file_path(name))
with check (bucket_id <> 'environment-files' or moseek_private.can_access_file_path(name));
drop policy if exists moseek_files_no_update on storage.objects;
create policy moseek_files_no_update on storage.objects as restrictive
for update to public
using (bucket_id <> 'environment-files')
with check (bucket_id <> 'environment-files');
-- In-place overwrite/upsert is unavailable even if another Storage policy
-- permits updates elsewhere.

commit;
