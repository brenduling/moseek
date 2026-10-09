-- Phase 4.1C, stage 1: permission-aware Home counts and optional usernames.
begin;
set local lock_timeout = '5s';

alter table public.profiles add column if not exists username text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles add constraint profiles_username_format_check
      check (username is null or (username = lower(username)
        and username ~ '^[a-z0-9][a-z0-9_.-]{2,29}$')) not valid;
  end if;
end;
$$;

alter table public.profiles validate constraint profiles_username_format_check;
create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username)) where username is not null;
grant update (username) on public.profiles to authenticated;

-- Sections are real canvas cards; decorative React Flow nodes are not stored
-- here and are deliberately excluded. Resource rows are restricted to the
-- supported Note, Link, and File kinds. SECURITY INVOKER preserves all table
-- grants and RLS policies for the signed-in user.
create or replace function public.get_home_environment_resource_counts()
returns table(environment_id uuid, resource_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id,
    (select count(*) from public.sections s where s.environment_id = e.id)
      + (select count(*) from public.resources r
         where r.environment_id = e.id and r.type in ('note', 'link', 'file'))
  from public.environments e
$$;

revoke all on function public.get_home_environment_resource_counts() from public, anon;
grant execute on function public.get_home_environment_resource_counts() to authenticated;

commit;
