-- Phase 4.1C, stage 3: trusted invitation workflows and conversion gates.
begin;
set local lock_timeout = '5s';

create or replace function public.create_environment_invitation(
  p_environment_id uuid, p_identifier text, p_role public.environment_role
) returns text language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  environment_row public.environments%rowtype;
  actor_role public.environment_role;
  target_user uuid;
  previous_id uuid;
  previous_expiry timestamptz;
  generic_result constant text := 'If that account can be invited, an invitation will appear in its Moseek inbox.';
begin
  if actor_id is null then raise exception 'Not authorized to invite contributors.' using errcode = '42501'; end if;
  select e.* into environment_row from public.environments e where e.id = p_environment_id for update;
  select m.role into actor_role from public.environment_members m where m.environment_id = p_environment_id and m.user_id = actor_id;
  if not found or environment_row.type <> 'shared' or actor_role not in ('owner', 'admin') then
    raise exception 'Not authorized to invite contributors.' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'editor', 'viewer') or (actor_role = 'admin' and p_role not in ('editor', 'viewer')) then
    raise exception 'This role cannot be assigned by your membership role.' using errcode = '42501';
  end if;
  if p_identifier is null or length(btrim(p_identifier)) < 3 or length(btrim(p_identifier)) > 320 then return generic_result; end if;
  if left(btrim(p_identifier), 1) = '@' and position('@' in substr(btrim(p_identifier), 2)) = 0 then
    select p.id into target_user from public.profiles p where p.username = lower(substr(btrim(p_identifier), 2));
  elsif position('@' in btrim(p_identifier)) > 1 then
    select u.id into target_user from auth.users u where lower(u.email) = lower(btrim(p_identifier));
  else
    return generic_result;
  end if;
  if target_user is null or target_user = actor_id or exists (
    select 1 from public.environment_members m where m.environment_id = p_environment_id and m.user_id = target_user
  ) then return generic_result; end if;

  select i.id, i.expires_at into previous_id, previous_expiry
    from public.environment_invitations i
    where i.environment_id = p_environment_id and i.invited_user_id = target_user and i.status = 'pending'
    order by i.created_at desc limit 1 for update;
  if found then
    if previous_expiry <= now() then
      update public.environment_invitations set status = 'expired', responded_at = now() where id = previous_id;
    else
      return generic_result;
    end if;
  end if;
  insert into public.environment_invitations (environment_id, invited_user_id, invited_by, invited_by_role, role, expires_at)
    values (p_environment_id, target_user, actor_id, actor_role, p_role, now() + interval '7 days');
  return generic_result;
end;
$$;

create or replace function public.list_environment_invitations(p_environment_id uuid)
returns table(invitation_id uuid, invitee_name text, role public.environment_role, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (select 1 from public.environment_members m
    where m.environment_id = p_environment_id and m.user_id = actor_id and m.role in ('owner', 'admin')) then
    raise exception 'Not authorized to view invitations.' using errcode = '42501';
  end if;
  return query select i.id, coalesce(p.display_name, 'Moseek member'), i.role, i.expires_at
    from public.environment_invitations i left join public.profiles p on p.id = i.invited_user_id
    where i.environment_id = p_environment_id and i.status = 'pending' and i.expires_at > now()
    order by i.created_at;
end;
$$;

create or replace function public.list_my_environment_invitations()
returns table(invitation_id uuid, environment_id uuid, environment_name text, inviter_name text,
  role public.environment_role, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then return; end if;
  return query select i.id, i.environment_id, e.name, coalesce(p.display_name, 'Moseek member'), i.role, i.expires_at
    from public.environment_invitations i join public.environments e on e.id = i.environment_id and e.type = 'shared'
    left join public.profiles p on p.id = i.invited_by
    where i.invited_user_id = actor_id and i.status = 'pending' and i.expires_at > now()
    order by i.created_at desc;
end;
$$;

create or replace function public.respond_to_environment_invitation(p_invitation_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_environment uuid;
  environment_kind public.environment_type;
  invite public.environment_invitations%rowtype;
begin
  if actor_id is null then raise exception 'Invitation is unavailable.' using errcode = '42501'; end if;
  select i.environment_id into target_environment from public.environment_invitations i
    where i.id = p_invitation_id and i.invited_user_id = actor_id;
  if not found then raise exception 'Invitation is unavailable.' using errcode = '42501'; end if;
  select e.type into environment_kind from public.environments e where e.id = target_environment for update;
  select i.* into invite from public.environment_invitations i
    where i.id = p_invitation_id and i.invited_user_id = actor_id for update;
  if not found or invite.status <> 'pending' then return 'unavailable'; end if;
  if invite.expires_at <= now() then
    update public.environment_invitations set status = 'expired', responded_at = now() where id = p_invitation_id;
    return 'expired';
  end if;
  if not p_accept then
    update public.environment_invitations set status = 'declined', responded_at = now() where id = p_invitation_id;
    return 'declined';
  end if;
  if environment_kind <> 'shared' or invite.invited_by is null or not exists (
    select 1 from public.environment_members m where m.environment_id = target_environment
      and m.user_id = invite.invited_by and m.role in ('owner', 'admin')
  ) or (invite.invited_by_role = 'admin' and invite.role = 'admin') then
    update public.environment_invitations set status = 'revoked', responded_at = now() where id = p_invitation_id;
    return 'revoked';
  end if;
  if not exists (select 1 from public.environment_members m where m.environment_id = target_environment and m.user_id = actor_id) then
    insert into public.environment_members (environment_id, user_id, role) values (target_environment, actor_id, invite.role);
  end if;
  update public.environment_invitations set status = 'accepted', responded_at = now() where id = p_invitation_id;
  return 'accepted';
end;
$$;

create or replace function public.revoke_environment_invitation(p_invitation_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_environment uuid;
  actor_role public.environment_role;
  invite public.environment_invitations%rowtype;
begin
  select i.environment_id into target_environment from public.environment_invitations i where i.id = p_invitation_id;
  if not found then return 'unavailable'; end if;
  perform 1 from public.environments e where e.id = target_environment for update;
  select m.role into actor_role from public.environment_members m where m.environment_id = target_environment and m.user_id = actor_id;
  if actor_id is null or actor_role not in ('owner', 'admin') then
    raise exception 'Not authorized to revoke this invitation.' using errcode = '42501';
  end if;
  select i.* into invite from public.environment_invitations i where i.id = p_invitation_id for update;
  if not found or invite.status <> 'pending' or (actor_role = 'admin' and invite.role not in ('editor', 'viewer')) then
    return 'unavailable';
  end if;
  update public.environment_invitations set status = 'revoked', responded_at = now() where id = p_invitation_id;
  return 'revoked';
end;
$$;

create or replace function public.create_environment_invitation_code(
  p_environment_id uuid, p_role public.environment_role, p_approval_required boolean default true
) returns table(invitation_code_id uuid, invitation_code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  environment_kind public.environment_type;
  actor_role public.environment_role;
  raw_code text;
  new_id uuid;
  expiration timestamptz := now() + interval '7 days';
begin
  if actor_id is null then raise exception 'Not authorized to create invitation codes.' using errcode = '42501'; end if;
  select e.type into environment_kind from public.environments e where e.id = p_environment_id for update;
  select m.role into actor_role from public.environment_members m where m.environment_id = p_environment_id and m.user_id = actor_id;
  if environment_kind <> 'shared' or actor_role not in ('owner', 'admin') or p_role not in ('editor', 'viewer') then
    raise exception 'Not authorized to create this invitation code.' using errcode = '42501';
  end if;
  raw_code := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.environment_invitation_codes
    (environment_id, code_hash, role, approval_required, created_by, created_by_role, expires_at)
  values (p_environment_id, extensions.digest(convert_to(raw_code, 'UTF8'), 'sha256'), p_role,
    coalesce(p_approval_required, true), actor_id, actor_role, expiration)
  returning id into new_id;
  return query select new_id, raw_code, expiration;
end;
$$;

create or replace function public.list_environment_invitation_codes(p_environment_id uuid)
returns table(code_id uuid, role public.environment_role, approval_required boolean,
  expires_at timestamptz, revoked_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (select 1 from public.environment_members m where m.environment_id = p_environment_id
    and m.user_id = actor_id and m.role in ('owner', 'admin')) then
    raise exception 'Not authorized to view invitation codes.' using errcode = '42501';
  end if;
  return query select c.id, c.role, c.approval_required, c.expires_at, c.revoked_at, c.created_at
    from public.environment_invitation_codes c where c.environment_id = p_environment_id order by c.created_at desc;
end;
$$;

create or replace function public.revoke_environment_invitation_code(p_code_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_environment uuid;
  actor_role public.environment_role;
  code_row public.environment_invitation_codes%rowtype;
begin
  select c.environment_id into target_environment from public.environment_invitation_codes c where c.id = p_code_id;
  if not found then return 'unavailable'; end if;
  perform 1 from public.environments e where e.id = target_environment for update;
  select m.role into actor_role from public.environment_members m where m.environment_id = target_environment and m.user_id = actor_id;
  if actor_id is null or actor_role not in ('owner', 'admin') then
    raise exception 'Not authorized to revoke this invitation code.' using errcode = '42501';
  end if;
  select c.* into code_row from public.environment_invitation_codes c where c.id = p_code_id for update;
  if not found or (actor_role = 'admin' and code_row.role not in ('editor', 'viewer')) then return 'unavailable'; end if;
  update public.environment_invitation_codes set revoked_at = coalesce(revoked_at, now()) where id = p_code_id;
  update public.environment_join_requests set status = 'revoked', responded_at = now(), responded_by = actor_id
    where invitation_code_id = p_code_id and status = 'pending';
  return 'revoked';
end;
$$;

create or replace function public.redeem_environment_invitation_code(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  code_digest bytea;
  code_id uuid;
  target_environment uuid;
  environment_kind public.environment_type;
  code_row public.environment_invitation_codes%rowtype;
  attempts_now integer;
begin
  if actor_id is null then raise exception 'Sign in to use an invitation code.' using errcode = '42501'; end if;
  insert into public.environment_invitation_code_attempts as attempt_row (user_id, window_started_at, attempts)
  values (actor_id, now(), 1)
  on conflict (user_id) do update set
    window_started_at = case when attempt_row.window_started_at <= now() - interval '15 minutes'
      then now() else attempt_row.window_started_at end,
    attempts = case when attempt_row.window_started_at <= now() - interval '15 minutes'
      then 1 else attempt_row.attempts + 1 end
  returning attempts into attempts_now;
  if attempts_now > 5 then return 'rate_limited'; end if;
  if p_code is null or length(btrim(p_code)) <> 64 or btrim(p_code) !~ '^[A-Fa-f0-9]{64}$' then return 'invalid'; end if;

  code_digest := extensions.digest(convert_to(lower(btrim(p_code)), 'UTF8'), 'sha256');
  select c.id, c.environment_id into code_id, target_environment
    from public.environment_invitation_codes c where c.code_hash = code_digest;
  if not found then return 'invalid'; end if;
  select e.type into environment_kind from public.environments e where e.id = target_environment for update;
  if not found or environment_kind <> 'shared' then return 'invalid'; end if;
  select c.* into code_row from public.environment_invitation_codes c where c.id = code_id and c.environment_id = target_environment for update;
  if not found or code_row.revoked_at is not null or code_row.expires_at <= now()
     or not exists (select 1 from public.environment_members m where m.environment_id = target_environment
       and m.user_id = code_row.created_by and m.role in ('owner', 'admin')) then return 'invalid'; end if;
  if exists (select 1 from public.environment_members m where m.environment_id = target_environment and m.user_id = actor_id) then
    return 'already_joined';
  end if;
  if code_row.approval_required then
    if exists (select 1 from public.environment_join_requests r where r.environment_id = target_environment
      and r.user_id = actor_id and r.status = 'pending' and r.expires_at > now()) then return 'approval_pending'; end if;
    insert into public.environment_join_requests (environment_id, invitation_code_id, user_id, role, expires_at)
      values (target_environment, code_id, actor_id, code_row.role, code_row.expires_at);
    return 'approval_pending';
  end if;
  insert into public.environment_members (environment_id, user_id, role) values (target_environment, actor_id, code_row.role);
  return 'joined';
end;
$$;

create or replace function public.list_environment_join_requests(p_environment_id uuid)
returns table(request_id uuid, requester_name text, role public.environment_role, created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (select 1 from public.environment_members m where m.environment_id = p_environment_id
    and m.user_id = actor_id and m.role in ('owner', 'admin')) then
    raise exception 'Not authorized to view join requests.' using errcode = '42501';
  end if;
  return query select r.id, coalesce(p.display_name, 'Moseek member'), r.role, r.created_at, r.expires_at
    from public.environment_join_requests r left join public.profiles p on p.id = r.user_id
    where r.environment_id = p_environment_id and r.status = 'pending' and r.expires_at > now() order by r.created_at;
end;
$$;

create or replace function public.respond_to_environment_join_request(p_request_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_environment uuid;
  actor_role public.environment_role;
  environment_kind public.environment_type;
  request_row public.environment_join_requests%rowtype;
  code_row public.environment_invitation_codes%rowtype;
begin
  select r.environment_id into target_environment from public.environment_join_requests r where r.id = p_request_id;
  if not found then return 'unavailable'; end if;
  select e.type into environment_kind from public.environments e where e.id = target_environment for update;
  select m.role into actor_role from public.environment_members m where m.environment_id = target_environment and m.user_id = actor_id;
  select r.* into request_row from public.environment_join_requests r where r.id = p_request_id for update;
  if not found or request_row.status <> 'pending' then return 'unavailable'; end if;
  if actor_id = request_row.user_id and not p_approve then
    update public.environment_join_requests set status = 'declined', responded_at = now(), responded_by = actor_id where id = p_request_id;
    return 'declined';
  end if;
  if actor_role not in ('owner', 'admin') or (actor_role = 'admin' and request_row.role not in ('editor', 'viewer')) then
    raise exception 'Not authorized to respond to this join request.' using errcode = '42501';
  end if;
  if request_row.expires_at <= now() or environment_kind <> 'shared' then
    update public.environment_join_requests set status = 'expired', responded_at = now(), responded_by = actor_id where id = p_request_id;
    return 'expired';
  end if;
  if not p_approve then
    update public.environment_join_requests set status = 'declined', responded_at = now(), responded_by = actor_id where id = p_request_id;
    return 'declined';
  end if;
  select c.* into code_row from public.environment_invitation_codes c where c.id = request_row.invitation_code_id for update;
  if not found or code_row.revoked_at is not null or code_row.expires_at <= now()
     or not exists (select 1 from public.environment_members m where m.environment_id = target_environment
       and m.user_id = code_row.created_by and m.role in ('owner', 'admin')) then
    update public.environment_join_requests set status = 'revoked', responded_at = now(), responded_by = actor_id where id = p_request_id;
    return 'revoked';
  end if;
  if not exists (select 1 from public.environment_members m where m.environment_id = target_environment and m.user_id = request_row.user_id) then
    insert into public.environment_members (environment_id, user_id, role) values (target_environment, request_row.user_id, request_row.role);
  end if;
  update public.environment_join_requests set status = 'accepted', responded_at = now(), responded_by = actor_id where id = p_request_id;
  return 'accepted';
end;
$$;

-- Extend Shared -> Personal conversion to serialize against and require
-- explicit resolution of pending invitations, active codes, and join requests.
create or replace function public.convert_environment_type(
  p_environment_id uuid, p_target_type public.environment_type
) returns setof public.environments
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  environment_row public.environments%rowtype;
  membership_count bigint;
  owner_count bigint;
  pending_invitation_count bigint;
  active_code_count bigint;
  pending_request_count bigint;
begin
  if actor_id is null then raise exception 'Not authorized to change this Environment.' using errcode = '42501'; end if;
  select e.* into environment_row from public.environments e where e.id = p_environment_id for update;
  if not found or environment_row.created_by <> actor_id or not exists (
    select 1 from public.environment_members m where m.environment_id = p_environment_id and m.user_id = actor_id and m.role = 'owner'
  ) then raise exception 'Not authorized to change this Environment.' using errcode = '42501'; end if;

  perform m.user_id from public.environment_members m where m.environment_id = p_environment_id order by m.user_id for update;
  select count(*), count(*) filter (where m.user_id = actor_id and m.role = 'owner') into membership_count, owner_count
    from public.environment_members m where m.environment_id = p_environment_id;
  perform i.id from public.environment_invitations i where i.environment_id = p_environment_id and i.status = 'pending' order by i.id for update;
  perform c.id from public.environment_invitation_codes c where c.environment_id = p_environment_id order by c.id for update;
  perform r.id from public.environment_join_requests r where r.environment_id = p_environment_id and r.status = 'pending' order by r.id for update;

  update public.environment_invitations set status = 'expired', responded_at = now()
    where environment_id = p_environment_id and status = 'pending' and expires_at <= now();
  update public.environment_join_requests set status = 'expired', responded_at = now()
    where environment_id = p_environment_id and status = 'pending' and expires_at <= now();
  select count(*) into pending_invitation_count from public.environment_invitations
    where environment_id = p_environment_id and status = 'pending' and expires_at > now();
  select count(*) into active_code_count from public.environment_invitation_codes
    where environment_id = p_environment_id and revoked_at is null and expires_at > now();
  select count(*) into pending_request_count from public.environment_join_requests
    where environment_id = p_environment_id and status = 'pending' and expires_at > now();

  if environment_row.type = 'shared' and p_target_type = 'personal' and (membership_count <> 1 or owner_count <> 1) then
    raise exception 'Remove all other contributors before changing this Environment to Personal.'
      using errcode = '23514', constraint = 'environment_personal_requires_owner_only_membership';
  end if;
  if environment_row.type = 'shared' and p_target_type = 'personal'
     and (pending_invitation_count > 0 or active_code_count > 0 or pending_request_count > 0) then
    raise exception 'Revoke pending invitations, active invitation codes, and unresolved join requests before changing this Environment to Personal.'
      using errcode = '23514', constraint = 'environment_personal_requires_no_open_invitations';
  end if;
  if environment_row.type is distinct from p_target_type then
    perform pg_catalog.set_config('moseek.environment_type_conversion', p_environment_id::text, true);
    update public.environments e set type = p_target_type where e.id = p_environment_id returning e.* into environment_row;
  end if;
  return next environment_row;
end;
$$;

alter function public.convert_environment_type(uuid, public.environment_type) owner to postgres;

do $$
declare signature text;
begin
  foreach signature in array array[
    'public.create_environment_invitation(uuid,text,public.environment_role)',
    'public.list_environment_invitations(uuid)',
    'public.list_my_environment_invitations()',
    'public.respond_to_environment_invitation(uuid,boolean)',
    'public.revoke_environment_invitation(uuid)',
    'public.create_environment_invitation_code(uuid,public.environment_role,boolean)',
    'public.list_environment_invitation_codes(uuid)',
    'public.revoke_environment_invitation_code(uuid)',
    'public.redeem_environment_invitation_code(text)',
    'public.list_environment_join_requests(uuid)',
    'public.respond_to_environment_join_request(uuid,boolean)',
    'public.convert_environment_type(uuid,public.environment_type)'
  ] loop
    execute format('revoke all on function %s from public, anon', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
end;
$$;

commit;
