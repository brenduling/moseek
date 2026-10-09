-- Phase 4.0: preserve existing member capabilities under the Editor role.
-- Renaming the enum label preserves the existing enum values and all rows.
begin;

do $$
declare
  has_member boolean;
  has_editor boolean;
begin
  select exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.oid = 'public.environment_role'::regtype and e.enumlabel = 'member'
  ) into has_member;
  select exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.oid = 'public.environment_role'::regtype and e.enumlabel = 'editor'
  ) into has_editor;

  if has_member and has_editor then
    raise exception 'Both member and editor role labels exist; inspect the schema before continuing';
  elsif has_member then
    alter type public.environment_role rename value 'member' to 'editor';
  elsif not has_editor then
    raise exception 'Expected either member or editor role label on public.environment_role';
  end if;
end;
$$;

commit;
