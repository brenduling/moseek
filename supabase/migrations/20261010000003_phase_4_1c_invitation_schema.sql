-- Phase 4.1C, stage 2: private invitation, join-request, and code state.
-- Writes are intentionally withheld from the authenticated API; narrow RPCs
-- in the next stage own every state transition.
begin;
set local lock_timeout = '5s';

create table public.environment_invitations (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  invited_by_role public.environment_role not null check (invited_by_role in ('owner', 'admin')),
  role public.environment_role not null check (role in ('admin', 'editor', 'viewer')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index environment_invitations_one_pending_per_user
  on public.environment_invitations (environment_id, invited_user_id)
  where status = 'pending';
create index environment_invitations_by_recipient
  on public.environment_invitations (invited_user_id, created_at desc);
create index environment_invitations_by_environment
  on public.environment_invitations (environment_id, status, expires_at);

create table public.environment_invitation_codes (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  code_hash bytea not null unique check (octet_length(code_hash) = 32),
  role public.environment_role not null check (role in ('editor', 'viewer')),
  approval_required boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_role public.environment_role not null check (created_by_role in ('owner', 'admin')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index environment_invitation_codes_by_environment
  on public.environment_invitation_codes (environment_id, expires_at, revoked_at);

create table public.environment_join_requests (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  invitation_code_id uuid not null references public.environment_invitation_codes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.environment_role not null check (role in ('editor', 'viewer')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references public.profiles(id) on delete set null
);
create unique index environment_join_requests_one_pending_per_user
  on public.environment_join_requests (environment_id, user_id)
  where status = 'pending';
create index environment_join_requests_by_environment
  on public.environment_join_requests (environment_id, status, expires_at);
create index environment_join_requests_by_user
  on public.environment_join_requests (user_id, created_at desc);

-- Authenticated-user scoped brute-force window. Codes have 256 random bits;
-- this additionally limits each account to five redemptions per 15 minutes.
create table public.environment_invitation_code_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);

alter table public.environment_invitations enable row level security;
alter table public.environment_invitation_codes enable row level security;
alter table public.environment_join_requests enable row level security;
alter table public.environment_invitation_code_attempts enable row level security;

revoke all on public.environment_invitations, public.environment_invitation_codes,
  public.environment_join_requests, public.environment_invitation_code_attempts
  from public, anon, authenticated;

-- Recipients can inspect only their own rows. Manager-facing lists use
-- SECURITY DEFINER RPCs that omit email addresses and user IDs.
grant select on public.environment_invitations, public.environment_join_requests to authenticated;
create policy moseek_invitation_recipient_select on public.environment_invitations
  for select to authenticated using (invited_user_id = (select auth.uid()));
create policy moseek_join_request_recipient_select on public.environment_join_requests
  for select to authenticated using (user_id = (select auth.uid()));

commit;
