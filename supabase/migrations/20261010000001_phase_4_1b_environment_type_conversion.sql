-- Phase 4.1B: owner-only, atomic Environment type conversion.
-- Environment type is still not updateable through the authenticated table API.
-- The trusted RPC locks the Environment and memberships before validating the
-- transition, then sets a transaction-local marker consumed by the identity
-- trigger. Shared -> Personal is allowed only for the Owner alone.
begin;
set local lock_timeout = '5s';

create or replace function moseek_private.protect_identity()
returns trigger language plpgsql set search_path = '' as $$
declare
  conversion_function_owner name;
  trusted_type_conversion boolean := false;
begin
  if tg_table_name = 'environments' then
    if new.type is distinct from old.type then
      select pg_catalog.pg_get_userbyid(p.proowner) into conversion_function_owner
      from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure(
        'public.convert_environment_type(uuid,public.environment_type)'
      );

      trusted_type_conversion := current_user = conversion_function_owner
        and pg_catalog.current_setting('moseek.environment_type_conversion', true) = old.id::text;

      if not trusted_type_conversion then
        raise exception 'Environment type can only be changed by its Owner through the conversion operation';
      end if;
    end if;

    if new.id is distinct from old.id or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Environment identity, creator and creation time are immutable';
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

-- Membership INSERT/UPDATE validates under the same parent-row lock as type
-- conversion. This prevents a concurrent new member from passing validation
-- against Shared and being committed after the Environment becomes Personal.
create or replace function moseek_private.validate_membership()
returns trigger language plpgsql set search_path = '' as $$
declare
  environment_kind public.environment_type;
  environment_owner uuid;
begin
  select e.type, e.created_by into environment_kind, environment_owner
  from public.environments e where e.id = new.environment_id
  for update;

  if environment_kind = 'personal' and (new.role <> 'owner' or new.user_id <> environment_owner) then
    raise exception 'Personal Environments only permit their owner';
  end if;
  if new.role = 'owner' and new.user_id <> environment_owner then
    raise exception 'Owner membership must match Environment creator';
  end if;
  return new;
end;
$$;

create or replace function public.convert_environment_type(
  p_environment_id uuid,
  p_target_type public.environment_type
)
returns setof public.environments
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  environment_row public.environments%rowtype;
  membership_count bigint;
  owner_count bigint;
begin
  if actor_id is null then
    raise exception 'Not authorized to change this Environment.' using errcode = '42501';
  end if;

  select e.* into environment_row
  from public.environments e
  where e.id = p_environment_id
  for update;

  if not found or environment_row.created_by <> actor_id
     or not exists (
       select 1 from public.environment_members m
       where m.environment_id = p_environment_id
         and m.user_id = actor_id and m.role = 'owner'
     ) then
    raise exception 'Not authorized to change this Environment.' using errcode = '42501';
  end if;

  -- Lock every current membership in a stable order. The membership validator
  -- takes the Environment row lock before accepting INSERT/UPDATE operations.
  perform m.user_id
  from public.environment_members m
  where m.environment_id = p_environment_id
  order by m.user_id
  for update;

  select count(*), count(*) filter (where m.user_id = actor_id and m.role = 'owner')
    into membership_count, owner_count
  from public.environment_members m
  where m.environment_id = p_environment_id;

  if environment_row.type = 'shared' and p_target_type = 'personal'
     and (membership_count <> 1 or owner_count <> 1) then
    raise exception 'Remove all other contributors before changing this Environment to Personal.'
      using errcode = '23514', constraint = 'environment_personal_requires_owner_only_membership';
  end if;

  if environment_row.type is distinct from p_target_type then
    perform pg_catalog.set_config('moseek.environment_type_conversion', p_environment_id::text, true);
    update public.environments e
      set type = p_target_type
      where e.id = p_environment_id
      returning e.* into environment_row;
  end if;

  return next environment_row;
end;
$$;

alter function public.convert_environment_type(uuid, public.environment_type) owner to postgres;
revoke all on function public.convert_environment_type(uuid, public.environment_type) from public, anon;
grant execute on function public.convert_environment_type(uuid, public.environment_type) to authenticated;

commit;
