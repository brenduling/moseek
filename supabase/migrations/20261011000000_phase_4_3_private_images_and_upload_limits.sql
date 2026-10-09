-- Phase 4.3: add safe image Resources and constrain private uploads.
-- File bytes stay private; Storage policies continue to require an exact
-- Resource path and an Owner/Admin/Editor membership for writes.
begin;
set local lock_timeout = '5s';

alter table public.resources drop constraint resources_type_payload;
alter table public.resources add constraint resources_type_payload check (
  (type = 'note' and url is null and provider is null and provider_metadata = '{}'::jsonb
    and original_filename is null and mime_type is null and file_size is null and storage_path is null)
  or
  (type = 'link' and url is not null and url ~* '^https?://[^/[:space:]]+[^[:space:]]*$'
    and length(url) <= 2048 and body is null and original_filename is null and mime_type is null
    and file_size is null and storage_path is null)
  or
  (type = 'file' and body is null and url is null and provider is null and provider_metadata = '{}'::jsonb
    and original_filename is not null and mime_type is not null and file_size is not null
    and storage_path is not null and length(storage_path) <= 600
    and storage_path ~ ('^' || environment_id::text || '/' || id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$'))
  or
  (type = 'image' and body is null and url is null and provider is null and provider_metadata = '{}'::jsonb
    and original_filename is not null and mime_type is not null and file_size is not null
    and storage_path is not null and length(storage_path) <= 600
    and storage_path ~ ('^' || environment_id::text || '/' || id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$'))
) not valid;
alter table public.resources validate constraint resources_type_payload;

alter table public.resources
  add constraint resources_image_payload_check check (
    type <> 'image' or (
      body is null and url is null and provider is null and provider_metadata = '{}'::jsonb
      and original_filename is not null
      and mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
      and file_size between 1 and 26214400
      and storage_path is not null and length(storage_path) <= 600
      and storage_path ~ ('^' || environment_id::text || '/' || id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
      and width between 160 and 720 and height between 100 and 560
    )
  ) not valid;

alter table public.resources
  add constraint resources_file_upload_limits_check check (
    type <> 'file' or (
      mime_type in (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain'
      ) and file_size between 1 and 26214400
    )
  ) not valid;

alter table public.resources validate constraint resources_image_payload_check;
alter table public.resources validate constraint resources_file_upload_limits_check;

do $$
declare bucket_count integer;
begin
  update storage.buckets
  set allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif'
  ]
  where id = 'environment-files' and public = false and file_size_limit = 26214400;
  get diagnostics bucket_count = row_count;
  if bucket_count <> 1 then
    raise exception 'Expected private environment-files bucket with 25 MiB upload limit.';
  end if;
end;
$$;

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
      and r.type in ('file', 'image') and r.storage_path = object_name
      and m.user_id = (select auth.uid())
  );
end;
$$;

create or replace function moseek_private.protect_file_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.type in ('file', 'image') and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'environment-files' and o.name = old.storage_path
  ) then
    raise exception 'Delete the Storage object before deleting its Resource';
  end if;
  return old;
end;
$$;

commit;
