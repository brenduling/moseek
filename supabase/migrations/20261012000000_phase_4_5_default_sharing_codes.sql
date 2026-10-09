-- Phase 4.5A: one approval-required default code for each Shared Environment.
-- Codes are hash-only at rest. Reissue returns a new plaintext once; it never
-- attempts to recover a previous code from its verifier.
begin;
set local lock_timeout = '5s';

alter table public.environment_invitation_codes
  add column is_default boolean not null default false;
create unique index environment_invitation_codes_one_default_unrevoked
  on public.environment_invitation_codes (environment_id)
  where is_default and revoked_at is null;

create or replace function moseek_private.issue_default_environment_code(
  target_environment uuid, actor_id uuid, actor_role public.environment_role
) returns table(code_id uuid, raw_code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  environment_kind public.environment_type;
  existing_code public.environment_invitation_codes%rowtype;
  generated_code text;
  expiration timestamptz := now() + interval '90 days';
begin
  select e.type into environment_kind from public.environments e
    where e.id = target_environment for update;
  if not found or environment_kind <> 'shared' then return; end if;
  select c.* into existing_code from public.environment_invitation_codes c
    where c.environment_id = target_environment and c.is_default and c.revoked_at is null
    order by c.created_at desc limit 1 for update;
  if found and existing_code.expires_at > now() then return; end if;
  if found then update public.environment_invitation_codes set revoked_at = now() where id = existing_code.id; end if;
  generated_code := encode(extensions.gen_random_bytes(32), 'hex');
  return query insert into public.environment_invitation_codes
    (environment_id, code_hash, role, approval_required, created_by, created_by_role, expires_at, is_default)
    values (target_environment, extensions.digest(convert_to(generated_code, 'UTF8'), 'sha256'),
      'editor', true, actor_id, actor_role, expiration, true)
    returning id, generated_code, environment_invitation_codes.expires_at;
end;
$$;
revoke all on function moseek_private.issue_default_environment_code(uuid, uuid, public.environment_role)
  from public, anon, authenticated;

create or replace function moseek_private.provision_default_environment_code()
returns trigger language plpgsql security definer set search_path = '' as $$
declare environment_owner uuid;
begin
  if new.type <> 'shared' then return new; end if;
  if tg_op = 'UPDATE' and old.type = new.type then return new; end if;
  select e.created_by into environment_owner from public.environments e where e.id = new.id;
  perform * from moseek_private.issue_default_environment_code(new.id, environment_owner, 'owner');
  return new;
end;
$$;
revoke all on function moseek_private.provision_default_environment_code() from public, anon, authenticated;
drop trigger if exists moseek_provision_default_environment_code on public.environments;
create trigger moseek_provision_default_environment_code
  after insert or update of type on public.environments
  for each row execute function moseek_private.provision_default_environment_code();

-- Existing manually-created codes remain untouched; one separate default code
-- is added to each existing Shared Environment.
do $$ declare environment_row record;
begin
  for environment_row in select e.id, e.created_by from public.environments e
    where e.type = 'shared' order by e.id
  loop
    perform * from moseek_private.issue_default_environment_code(environment_row.id, environment_row.created_by, 'owner');
  end loop;
end;
$$;

create or replace function public.list_environment_default_invitation_code(p_environment_id uuid)
returns table(code_id uuid, state text, role public.environment_role, approval_required boolean,
  expires_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (select 1 from public.environment_members m
    where m.environment_id = p_environment_id and m.user_id = actor_id and m.role in ('owner', 'admin')) then
    raise exception 'Not authorized to view the default sharing code.' using errcode = '42501';
  end if;
  return query select c.id, case when c.revoked_at is not null then 'disabled'
    when c.expires_at <= now() then 'expired' else 'active' end,
    c.role, c.approval_required, c.expires_at, c.created_at
  from public.environment_invitation_codes c where c.environment_id = p_environment_id and c.is_default
  order by c.created_at desc limit 1;
end;
$$;

create or replace function public.reissue_environment_default_invitation_code(p_environment_id uuid)
returns table(invitation_code_id uuid, invitation_code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); actor_role public.environment_role;
begin
  if actor_id is null then raise exception 'Not authorized to manage this sharing code.' using errcode = '42501'; end if;
  perform 1 from public.environments e where e.id = p_environment_id and e.type = 'shared' for update;
  if not found then raise exception 'This Shared Environment is unavailable.' using errcode = '42501'; end if;
  select m.role into actor_role from public.environment_members m
    where m.environment_id = p_environment_id and m.user_id = actor_id;
  if actor_role not in ('owner', 'admin') then raise exception 'Not authorized to manage this sharing code.' using errcode = '42501'; end if;
  update public.environment_invitation_codes set revoked_at = now()
    where environment_id = p_environment_id and is_default and revoked_at is null;
  return query select issued.code_id, issued.raw_code, issued.expires_at
    from moseek_private.issue_default_environment_code(p_environment_id, actor_id, actor_role) issued;
end;
$$;

create or replace function public.disable_environment_default_invitation_code(p_environment_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); actor_role public.environment_role;
begin
  if actor_id is null then raise exception 'Not authorized to manage this sharing code.' using errcode = '42501'; end if;
  perform 1 from public.environments e where e.id = p_environment_id and e.type = 'shared' for update;
  if not found then raise exception 'This Shared Environment is unavailable.' using errcode = '42501'; end if;
  select m.role into actor_role from public.environment_members m
    where m.environment_id = p_environment_id and m.user_id = actor_id;
  if actor_role not in ('owner', 'admin') then raise exception 'Not authorized to manage this sharing code.' using errcode = '42501'; end if;
  update public.environment_invitation_codes set revoked_at = now()
    where environment_id = p_environment_id and is_default and revoked_at is null;
  return 'disabled';
end;
$$;

drop function public.list_environment_invitation_codes(uuid);
create function public.list_environment_invitation_codes(p_environment_id uuid)
returns table(code_id uuid, role public.environment_role, approval_required boolean,
  expires_at timestamptz, revoked_at timestamptz, created_at timestamptz, is_default boolean)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (select 1 from public.environment_members m where m.environment_id=p_environment_id
    and m.user_id=actor_id and m.role in ('owner','admin')) then
    raise exception 'Not authorized to view invitation codes.' using errcode = '42501';
  end if;
  return query select c.id,c.role,c.approval_required,c.expires_at,c.revoked_at,c.created_at,c.is_default
    from public.environment_invitation_codes c where c.environment_id=p_environment_id order by c.created_at desc;
end;
$$;

-- Code revocation is atomic with Shared -> Personal conversion. Contributors,
-- pending invitations and unresolved join requests remain explicit blockers.
create or replace function public.convert_environment_type(
  p_environment_id uuid, p_target_type public.environment_type
) returns setof public.environments
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid(); environment_row public.environments%rowtype;
  membership_count bigint; owner_count bigint; pending_invitation_count bigint; pending_request_count bigint;
begin
  if actor_id is null then raise exception 'Not authorized to change this Environment.' using errcode = '42501'; end if;
  select e.* into environment_row from public.environments e where e.id = p_environment_id for update;
  if not found or environment_row.created_by <> actor_id or not exists (
    select 1 from public.environment_members m where m.environment_id = p_environment_id and m.user_id = actor_id and m.role = 'owner'
  ) then raise exception 'Not authorized to change this Environment.' using errcode = '42501'; end if;
  perform m.user_id from public.environment_members m where m.environment_id = p_environment_id order by m.user_id for update;
  select count(*), count(*) filter (where m.user_id = actor_id and m.role = 'owner')
    into membership_count, owner_count from public.environment_members m where m.environment_id = p_environment_id;
  perform i.id from public.environment_invitations i where i.environment_id = p_environment_id and i.status = 'pending' order by i.id for update;
  perform c.id from public.environment_invitation_codes c where c.environment_id = p_environment_id order by c.id for update;
  perform r.id from public.environment_join_requests r where r.environment_id = p_environment_id and r.status = 'pending' order by r.id for update;
  update public.environment_invitations set status = 'expired', responded_at = now()
    where environment_id = p_environment_id and status = 'pending' and expires_at <= now();
  update public.environment_join_requests set status = 'expired', responded_at = now()
    where environment_id = p_environment_id and status = 'pending' and expires_at <= now();
  select count(*) into pending_invitation_count from public.environment_invitations
    where environment_id = p_environment_id and status = 'pending' and expires_at > now();
  select count(*) into pending_request_count from public.environment_join_requests
    where environment_id = p_environment_id and status = 'pending' and expires_at > now();
  if environment_row.type = 'shared' and p_target_type = 'personal' and (membership_count <> 1 or owner_count <> 1) then
    raise exception 'Remove all other contributors before changing this Environment to Personal.'
      using errcode = '23514', constraint = 'environment_personal_requires_owner_only_membership';
  end if;
  if environment_row.type = 'shared' and p_target_type = 'personal'
     and (pending_invitation_count > 0 or pending_request_count > 0) then
    raise exception 'Revoke pending invitations and resolve join requests before changing this Environment to Personal.'
      using errcode = '23514', constraint = 'environment_personal_requires_no_open_invitations';
  end if;
  if environment_row.type = 'shared' and p_target_type = 'personal' then
    update public.environment_invitation_codes set revoked_at = now()
      where environment_id = p_environment_id and revoked_at is null;
  end if;
  if environment_row.type is distinct from p_target_type then
    perform pg_catalog.set_config('moseek.environment_type_conversion', p_environment_id::text, true);
    update public.environments e set type = p_target_type where e.id = p_environment_id returning e.* into environment_row;
  end if;
  return next environment_row;
end;
$$;
alter function public.convert_environment_type(uuid, public.environment_type) owner to postgres;
alter function moseek_private.issue_default_environment_code(uuid, uuid, public.environment_role) owner to postgres;
alter function moseek_private.provision_default_environment_code() owner to postgres;
alter function public.list_environment_default_invitation_code(uuid) owner to postgres;
alter function public.reissue_environment_default_invitation_code(uuid) owner to postgres;
alter function public.disable_environment_default_invitation_code(uuid) owner to postgres;
alter function public.list_environment_invitation_codes(uuid) owner to postgres;

do $$ declare signature text;
begin
  foreach signature in array array[
    'public.list_environment_default_invitation_code(uuid)',
    'public.reissue_environment_default_invitation_code(uuid)',
    'public.disable_environment_default_invitation_code(uuid)',
    'public.list_environment_invitation_codes(uuid)',
    'public.convert_environment_type(uuid,public.environment_type)'
  ] loop
    execute format('revoke all on function %s from public, anon', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
end;
$$;
commit;
