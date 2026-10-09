-- Phase 4.5 invitation-code hardening.
-- Newly issued codes use a 32-symbol unambiguous alphabet and always request
-- Owner/Admin approval. Existing 64-character verifiers remain redeemable.
begin;
set local lock_timeout = '5s';

create or replace function moseek_private.generate_shared_invitation_code()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  generated text;
  has_letter boolean;
  has_digit boolean;
  position_index integer;
begin
  loop
    bytes := extensions.gen_random_bytes(7);
    generated := '';
    has_letter := false;
    has_digit := false;
    for position_index in 0..6 loop
      generated := generated || substr(alphabet, (get_byte(bytes, position_index) & 31) + 1, 1);
      has_letter := has_letter or substr(alphabet, (get_byte(bytes, position_index) & 31) + 1, 1) ~ '[A-Z]';
      has_digit := has_digit or substr(alphabet, (get_byte(bytes, position_index) & 31) + 1, 1) ~ '[2-9]';
    end loop;
    if has_letter and has_digit then return generated; end if;
  end loop;
end;
$$;
revoke all on function moseek_private.generate_shared_invitation_code() from public, anon, authenticated;

create or replace function moseek_private.insert_environment_invitation_code(
  target_environment uuid, actor_id uuid, actor_role public.environment_role,
  target_default boolean, target_expiration timestamptz
) returns table(code_id uuid, raw_code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  candidate text;
  attempt integer;
begin
  for attempt in 1..8 loop
    candidate := moseek_private.generate_shared_invitation_code();
    begin
      return query insert into public.environment_invitation_codes
        (environment_id, code_hash, role, approval_required, created_by, created_by_role, expires_at, is_default)
        values (target_environment,
          extensions.digest(convert_to(candidate, 'UTF8'), 'sha256'),
          'editor', true, actor_id, actor_role, target_expiration, target_default)
        returning id, candidate, environment_invitation_codes.expires_at;
      return;
    exception when unique_violation then
      -- The seven-character namespace can collide; retry securely instead of
      -- surfacing a uniqueness oracle or invalidating an existing verifier.
      null;
    end;
  end loop;
  raise exception 'Could not issue a unique invitation code. Try again.' using errcode = '54000';
end;
$$;
revoke all on function moseek_private.insert_environment_invitation_code(uuid, uuid, public.environment_role, boolean, timestamptz)
  from public, anon, authenticated;

create or replace function moseek_private.issue_default_environment_code(
  target_environment uuid, actor_id uuid, actor_role public.environment_role
) returns table(code_id uuid, raw_code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  environment_kind public.environment_type;
  existing_code public.environment_invitation_codes%rowtype;
begin
  select e.type into environment_kind from public.environments e where e.id=target_environment for update;
  if not found or environment_kind <> 'shared' then return; end if;
  select c.* into existing_code from public.environment_invitation_codes c
    where c.environment_id=target_environment and c.is_default and c.revoked_at is null
    order by c.created_at desc limit 1 for update;
  if found and existing_code.expires_at > now() then return; end if;
  if found then update public.environment_invitation_codes set revoked_at=now() where id=existing_code.id; end if;
  return query select issued.code_id, issued.raw_code, issued.expires_at
    from moseek_private.insert_environment_invitation_code(
      target_environment, actor_id, actor_role, true, now()+interval '90 days') issued;
end;
$$;
revoke all on function moseek_private.issue_default_environment_code(uuid, uuid, public.environment_role)
  from public, anon, authenticated;

create or replace function public.create_environment_invitation_code(
  p_environment_id uuid, p_role public.environment_role, p_approval_required boolean default true
) returns table(invitation_code_id uuid, invitation_code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.environment_role;
  environment_kind public.environment_type;
begin
  if actor_id is null then raise exception 'Not authorized to create invitation codes.' using errcode='42501'; end if;
  select e.type into environment_kind from public.environments e where e.id=p_environment_id for update;
  select m.role into actor_role from public.environment_members m
    where m.environment_id=p_environment_id and m.user_id=actor_id;
  if environment_kind is distinct from 'shared' or actor_role is null or actor_role not in ('owner','admin')
     or p_role is distinct from 'editor' then
    raise exception 'Only authorized managers can create Editor invitation codes.' using errcode='42501';
  end if;
  -- p_approval_required remains in the signature for API compatibility but
  -- is deliberately ignored: every new code requires approval.
  return query select issued.code_id, issued.raw_code, issued.expires_at
    from moseek_private.insert_environment_invitation_code(
      p_environment_id, actor_id, actor_role, false, now()+interval '7 days') issued;
end;
$$;

-- Existing codes cannot be recovered from their hashes; retain their codes
-- and expiry, but remove the old direct-join behavior for all active verifiers.
update public.environment_invitation_codes set approval_required=true
  where revoked_at is null and expires_at > now() and approval_required is distinct from true;

create or replace function public.redeem_environment_invitation_code(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  normalized text;
  code_digest bytea;
  code_id uuid;
  target_environment uuid;
  environment_kind public.environment_type;
  code_row public.environment_invitation_codes%rowtype;
  attempts_now integer;
begin
  if actor_id is null then raise exception 'Sign in to use an invitation code.' using errcode='42501'; end if;
  insert into public.environment_invitation_code_attempts as attempt_row(user_id,window_started_at,attempts)
  values(actor_id,now(),1)
  on conflict(user_id) do update set
    window_started_at=case when attempt_row.window_started_at <= now()-interval '15 minutes' then now() else attempt_row.window_started_at end,
    attempts=case when attempt_row.window_started_at <= now()-interval '15 minutes' then 1 else attempt_row.attempts+1 end
  returning attempts into attempts_now;
  if attempts_now > 5 then return 'rate_limited'; end if;

  normalized := upper(btrim(coalesce(p_code,'')));
  if length(normalized)=7 and normalized ~ '^[A-HJ-NP-Z2-9]{7}$'
     and normalized ~ '[A-Z]' and normalized ~ '[2-9]' then
    code_digest := extensions.digest(convert_to(normalized,'UTF8'),'sha256');
  elsif length(normalized)=64 and normalized ~ '^[A-F0-9]{64}$' then
    -- Backward-compatible validation for unrecoverable legacy hex codes.
    code_digest := extensions.digest(convert_to(lower(normalized),'UTF8'),'sha256');
  else
    return 'invalid';
  end if;

  select c.id,c.environment_id into code_id,target_environment
    from public.environment_invitation_codes c where c.code_hash=code_digest;
  if not found then return 'invalid'; end if;
  select e.type into environment_kind from public.environments e where e.id=target_environment for update;
  if not found or environment_kind <> 'shared' then return 'invalid'; end if;
  select c.* into code_row from public.environment_invitation_codes c
    where c.id=code_id and c.environment_id=target_environment for update;
  if not found or code_row.revoked_at is not null or code_row.expires_at <= now()
     or not exists (select 1 from public.environment_members m where m.environment_id=target_environment
       and m.user_id=code_row.created_by and m.role in ('owner','admin')) then return 'invalid'; end if;
  if exists (select 1 from public.environment_members m where m.environment_id=target_environment and m.user_id=actor_id) then
    return 'already_joined';
  end if;

  update public.environment_join_requests set status='expired',responded_at=now(),responded_by=null
    where environment_id=target_environment and user_id=actor_id and status='pending' and expires_at <= now();
  if exists (select 1 from public.environment_join_requests r where r.environment_id=target_environment
    and r.user_id=actor_id and r.status='pending' and r.expires_at > now()) then
    return 'approval_pending';
  end if;
  insert into public.environment_join_requests(environment_id,invitation_code_id,user_id,role,expires_at)
    values(target_environment,code_id,actor_id,code_row.role,least(code_row.expires_at,now()+interval '7 days'));
  return 'approval_pending';
end;
$$;

create or replace function public.list_my_environment_join_requests()
returns table(request_id uuid, environment_id uuid, environment_name text, status text,
  role public.environment_role, created_at timestamptz, expires_at timestamptz, responded_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then return; end if;
  return query select r.id,r.environment_id,e.name,r.status,r.role,r.created_at,r.expires_at,r.responded_at
    from public.environment_join_requests r join public.environments e on e.id=r.environment_id
    where r.user_id=actor_id order by r.created_at desc limit 20;
end;
$$;

-- Keep approval authorization explicit when auth.uid() or the membership role
-- is absent. The prior function's `actor_role NOT IN (...)` evaluated NULL for
-- unauthenticated calls, which could fall through a PL/pgSQL IF condition.
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
  if actor_id is null then
    raise exception 'Not authorized to respond to this join request.' using errcode = '42501';
  end if;
  select r.environment_id into target_environment from public.environment_join_requests r where r.id = p_request_id;
  if not found then return 'unavailable'; end if;
  select e.type into environment_kind from public.environments e where e.id = target_environment for update;
  if not found then return 'unavailable'; end if;
  select m.role into actor_role from public.environment_members m
    where m.environment_id = target_environment and m.user_id = actor_id;
  select r.* into request_row from public.environment_join_requests r where r.id = p_request_id for update;
  if not found or request_row.status <> 'pending' then return 'unavailable'; end if;
  if actor_id = request_row.user_id and not p_approve then
    update public.environment_join_requests set status = 'declined', responded_at = now(), responded_by = actor_id where id = p_request_id;
    return 'declined';
  end if;
  if actor_role is null or actor_role not in ('owner', 'admin')
     or (actor_role = 'admin' and request_row.role not in ('editor', 'viewer')) then
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

alter function moseek_private.generate_shared_invitation_code() owner to postgres;
alter function moseek_private.insert_environment_invitation_code(uuid,uuid,public.environment_role,boolean,timestamptz) owner to postgres;
alter function moseek_private.issue_default_environment_code(uuid,uuid,public.environment_role) owner to postgres;
alter function public.create_environment_invitation_code(uuid,public.environment_role,boolean) owner to postgres;
alter function public.redeem_environment_invitation_code(text) owner to postgres;
alter function public.list_my_environment_join_requests() owner to postgres;
alter function public.respond_to_environment_join_request(uuid,boolean) owner to postgres;

revoke all on function public.create_environment_invitation_code(uuid,public.environment_role,boolean) from public,anon;
grant execute on function public.create_environment_invitation_code(uuid,public.environment_role,boolean) to authenticated;
revoke all on function public.redeem_environment_invitation_code(text) from public,anon;
grant execute on function public.redeem_environment_invitation_code(text) to authenticated;
revoke all on function public.list_my_environment_join_requests() from public,anon;
grant execute on function public.list_my_environment_join_requests() to authenticated;
revoke all on function public.respond_to_environment_join_request(uuid,boolean) from public,anon;
grant execute on function public.respond_to_environment_join_request(uuid,boolean) to authenticated;
commit;
