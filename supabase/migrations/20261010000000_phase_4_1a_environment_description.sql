-- Phase 4.1A: add a bounded Environment description without changing
-- Environment ownership, type immutability, or the existing RLS policy.
begin;
set local lock_timeout = '5s';

alter table public.environments
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.environments'::regclass
      and conname = 'environments_description_length_check'
  ) then
    alter table public.environments
      add constraint environments_description_length_check
      check (description is null or length(description) <= 2000)
      not valid;
  end if;
end;
$$;

alter table public.environments
  validate constraint environments_description_length_check;

-- The existing UPDATE RLS policy already limits Environment edits to
-- Owners/Admins. Grant only the new column in addition to the existing name grant.
grant update (description) on public.environments to authenticated;

commit;
