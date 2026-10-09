-- Read-only Phase 3D.2 catalog preflight. Run through an authorized read-only
-- database connection and compare the result with the checked-in foundation.
-- Do not run a migration until every difference has been reviewed.

select current_setting('server_version') as postgres_version;

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('profiles', 'environments', 'environment_members', 'sections', 'resources',
   'environment_color_preferences')
  and c.relkind in ('r', 'p')
order by c.relname;

select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in
  ('environments', 'environment_members', 'sections', 'resources',
   'environment_color_preferences')
order by table_name, ordinal_position;

select c.relname as table_name, con.conname as constraint_name,
  con.contype as constraint_type, pg_catalog.pg_get_constraintdef(con.oid) as definition,
  con.convalidated as validated
from pg_catalog.pg_constraint con
join pg_catalog.pg_class c on c.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('environments', 'environment_members', 'sections', 'resources',
   'environment_color_preferences')
order by c.relname, con.conname;

select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename in
  ('environments', 'environment_members', 'sections', 'resources',
   'environment_color_preferences')
order by tablename, policyname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in
  ('environments', 'environment_members', 'sections', 'resources',
   'environment_color_preferences')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name in
  ('environments', 'environment_members', 'sections', 'resources',
   'environment_color_preferences')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, column_name, grantee, privilege_type;

select c.relname as table_name, t.tgname as trigger_name,
  pg_catalog.pg_get_triggerdef(t.oid) as definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal and c.relname in
  ('environments', 'environment_members', 'sections', 'resources',
   'environment_color_preferences')
order by c.relname, t.tgname;

select 'environments' as table_name, count(*) as row_count from public.environments
union all select 'environment_members', count(*) from public.environment_members
union all select 'sections', count(*) from public.sections
union all select 'resources', count(*) from public.resources;
