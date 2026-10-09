\set ON_ERROR_STOP on

-- Authenticated role/RLS regression checks for upload metadata, private object
-- access, image constraints, Section attachment, and atomic group movement.
begin;
set local client_min_messages = notice;
select gen_random_uuid() owner_id \gset
select gen_random_uuid() admin_id \gset
select gen_random_uuid() editor_id \gset
select gen_random_uuid() viewer_id \gset
select gen_random_uuid() outsider_id \gset
select gen_random_uuid() environment_id \gset
select gen_random_uuid() other_environment_id \gset
select gen_random_uuid() section_id \gset
select gen_random_uuid() other_section_id \gset
select gen_random_uuid() note_id \gset
select gen_random_uuid() file_id \gset
select gen_random_uuid() image_id \gset

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) values
  (:'owner_id','authenticated','authenticated','file-image-owner-'||:'owner_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'admin_id','authenticated','authenticated','file-image-admin-'||:'admin_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'editor_id','authenticated','authenticated','file-image-editor-'||:'editor_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'viewer_id','authenticated','authenticated','file-image-viewer-'||:'viewer_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'outsider_id','authenticated','authenticated','file-image-outsider-'||:'outsider_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false);
select set_config('moseek.test.owner', :'owner_id', true);
select set_config('moseek.test.admin', :'admin_id', true);
select set_config('moseek.test.editor', :'editor_id', true);
select set_config('moseek.test.viewer', :'viewer_id', true);
select set_config('moseek.test.outsider', :'outsider_id', true);
select set_config('moseek.test.environment', :'environment_id', true);
select set_config('moseek.test.other_environment', :'other_environment_id', true);
select set_config('moseek.test.section', :'section_id', true);
select set_config('moseek.test.other_section', :'other_section_id', true);
select set_config('moseek.test.note', :'note_id', true);
select set_config('moseek.test.file', :'file_id', true);
select set_config('moseek.test.image', :'image_id', true);

create function pg_temp.assume_user(actor uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'ASSERT FAILED: %', message; end if;
  raise notice 'PASS: %', message;
end $$;

-- Bucket configuration is deployment metadata, not visible to authenticated
-- users through the Storage API. Inspect it under the local test runner role.
select pg_temp.assert((select not public from storage.buckets where id='environment-files'
  and file_size_limit=26214400 and cardinality(allowed_mime_types)=9),
  'Private bucket retains its 25 MiB cap and explicit nine-type MIME allowlist');

set local role authenticated;
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
insert into public.environments (id,name,type,created_by) values
  (current_setting('moseek.test.environment')::uuid,'Files and sections fixture','shared',auth.uid()),
  (current_setting('moseek.test.other_environment')::uuid,'Separate fixture','shared',auth.uid());
insert into public.sections (id,environment_id,title,x,y,width,height,created_by) values
  (current_setting('moseek.test.section')::uuid,current_setting('moseek.test.environment')::uuid,'Container',100,100,660,430,auth.uid()),
  (current_setting('moseek.test.other_section')::uuid,current_setting('moseek.test.other_environment')::uuid,'Other Environment Section',0,0,660,430,auth.uid());
insert into public.environment_members (environment_id,user_id,role) values
  (current_setting('moseek.test.environment')::uuid,current_setting('moseek.test.admin')::uuid,'admin'),
  (current_setting('moseek.test.environment')::uuid,current_setting('moseek.test.editor')::uuid,'editor'),
  (current_setting('moseek.test.environment')::uuid,current_setting('moseek.test.viewer')::uuid,'viewer');
insert into public.resources (id,environment_id,section_id,created_by,type,title,x,y,body)
values (current_setting('moseek.test.note')::uuid,current_setting('moseek.test.environment')::uuid,
  current_setting('moseek.test.section')::uuid,auth.uid(),'note','Contained note',450,480,'Note body');
insert into public.resources (id,environment_id,section_id,created_by,type,title,original_filename,mime_type,file_size,storage_path,x,y)
values (current_setting('moseek.test.file')::uuid,current_setting('moseek.test.environment')::uuid,current_setting('moseek.test.section')::uuid,auth.uid(),'file','Document','brief.pdf',
  'application/pdf',128,current_setting('moseek.test.environment')||'/'||current_setting('moseek.test.file')||'/doc.pdf',500,500);
insert into public.resources (id,environment_id,section_id,created_by,type,title,original_filename,mime_type,file_size,storage_path,x,y,width,height)
values (current_setting('moseek.test.image')::uuid,current_setting('moseek.test.environment')::uuid,
  current_setting('moseek.test.section')::uuid,auth.uid(),'image','Image','preview.png','image/png',256,
  current_setting('moseek.test.environment')||'/'||current_setting('moseek.test.image')||'/preview.png',550,520,320,240);

select pg_temp.assert((select count(*)=1 from public.resources where id=current_setting('moseek.test.image')::uuid
  and type='image' and width=320 and height=240), 'Image Resource stores safe MIME, size, private path, and dimensions');
do $$ begin
  begin
    update public.resources set width=900,height=240
      where id=current_setting('moseek.test.image')::uuid;
    raise exception 'ASSERT FAILED: unsafe image dimensions were accepted';
  exception when check_violation then raise notice 'PASS: image dimensions stay within the supported bounds'; end;
end $$;

do $$ begin
  begin
    insert into public.resources (environment_id,created_by,type,title,original_filename,mime_type,file_size,storage_path,width,height)
    values (current_setting('moseek.test.environment')::uuid,auth.uid(),'image','Bad image','bad.svg','image/svg+xml',12,
      current_setting('moseek.test.environment')||'/'||gen_random_uuid()||'/bad.svg',320,240);
    raise exception 'ASSERT FAILED: SVG image was accepted';
  exception when check_violation then raise notice 'PASS: SVG and other non-allowlisted image MIME types are rejected'; end;
end $$;
do $$ begin
  begin
    insert into public.resources (environment_id,created_by,type,title,original_filename,mime_type,file_size,storage_path)
    values (current_setting('moseek.test.environment')::uuid,auth.uid(),'file','Bad document','bad.exe','application/octet-stream',8,
      current_setting('moseek.test.environment')||'/'||gen_random_uuid()||'/bad.exe');
    raise exception 'ASSERT FAILED: unsupported document MIME was accepted';
  exception when check_violation then raise notice 'PASS: unsupported document MIME types are rejected'; end;
end $$;

select pg_temp.assume_user(current_setting('moseek.test.editor')::uuid);
insert into storage.objects (bucket_id,name,owner,owner_id,metadata) values
  ('environment-files',current_setting('moseek.test.environment')||'/'||current_setting('moseek.test.file')||'/doc.pdf',
    auth.uid(),auth.uid()::text,'{"mimetype":"application/pdf","size":128}'::jsonb),
  ('environment-files',current_setting('moseek.test.environment')||'/'||current_setting('moseek.test.image')||'/preview.png',
    auth.uid(),auth.uid()::text,'{"mimetype":"image/png","size":256}'::jsonb);
select pg_temp.assert((select count(*)=2 from storage.objects where bucket_id='environment-files'
  and name like current_setting('moseek.test.environment')||'/%'),
  'Editor can upload private File and Image objects registered to exact Resource paths');

select pg_temp.assume_user(current_setting('moseek.test.viewer')::uuid);
select pg_temp.assert((select count(*)=2 from storage.objects where bucket_id='environment-files'
  and name like current_setting('moseek.test.environment')||'/%'), 'Viewer can read authorized private file and image objects');
select pg_temp.assert(not moseek_private.can_manage_file_path(current_setting('moseek.test.environment')||'/'||
  current_setting('moseek.test.file')||'/doc.pdf'), 'Viewer cannot upload, replace, or remove a private file');
update public.resources set width=400,height=300 where id=current_setting('moseek.test.image')::uuid;
select pg_temp.assert((select width=320 and height=240 from public.resources where id=current_setting('moseek.test.image')::uuid),
  'Viewer cannot resize an Image Resource');
do $$ begin
  begin
    insert into storage.objects (bucket_id,name,owner,owner_id,metadata)
    values ('environment-files',current_setting('moseek.test.environment')||'/'||current_setting('moseek.test.image')||'/viewer.png',
      auth.uid(),auth.uid()::text,'{"mimetype":"image/png","size":1}'::jsonb);
    raise exception 'ASSERT FAILED: Viewer uploaded an image';
  exception when insufficient_privilege then raise notice 'PASS: Viewer cannot upload private images'; end;
end $$;
do $$ begin
  begin perform * from public.move_section_group(current_setting('moseek.test.environment')::uuid,
    current_setting('moseek.test.section')::uuid,160,190,660,430,(select updated_at from public.sections where id=current_setting('moseek.test.section')::uuid));
    raise exception 'ASSERT FAILED: Viewer moved a Section group';
  exception when insufficient_privilege then raise notice 'PASS: Viewer cannot move Sections or contained Resources'; end;
end $$;
select pg_temp.assert(not exists (select 1 from storage.objects where bucket_id='environment-files'
  and name like current_setting('moseek.test.environment')||'/%/viewer.png'), 'Viewer upload attempt created no object');

select pg_temp.assume_user(current_setting('moseek.test.outsider')::uuid);
select pg_temp.assert((select count(*)=0 from storage.objects where bucket_id='environment-files'
  and name like current_setting('moseek.test.environment')||'/%'), 'Outsider cannot read private File or Image objects');
do $$ begin
  begin
    insert into storage.objects (bucket_id,name,owner,owner_id,metadata)
    values ('environment-files',current_setting('moseek.test.environment')||'/'||current_setting('moseek.test.image')||'/outsider.png',
      auth.uid(),auth.uid()::text,'{"mimetype":"image/png","size":1}'::jsonb);
    raise exception 'ASSERT FAILED: Outsider uploaded an image';
  exception when insufficient_privilege then raise notice 'PASS: Outsider cannot upload private images'; end;
end $$;

select pg_temp.assume_user(current_setting('moseek.test.editor')::uuid);
select pg_temp.assert(moseek_private.can_manage_file_path(current_setting('moseek.test.environment')||'/'||
  current_setting('moseek.test.file')||'/doc.pdf'), 'Editor is authorized for Storage writes on a registered File path');
select id as section_id, updated_at as section_updated_at from public.sections where id=current_setting('moseek.test.section')::uuid \gset
select set_config('moseek.test.section_updated_at', :'section_updated_at', true);
select pg_temp.assert((select jsonb_array_length(public.move_section_group(current_setting('moseek.test.environment')::uuid,
  :'section_id'::uuid,160,190,660,430,:'section_updated_at'::timestamptz)->'resources')=3),
  'Editor moves the Section and all assigned Resources through one atomic RPC');
select pg_temp.assert((select x=160 and y=190 from public.sections where id=:'section_id'::uuid)
  and (select x=510 and y=570 from public.resources where id=current_setting('moseek.test.note')::uuid)
  and (select x=560 and y=590 from public.resources where id=current_setting('moseek.test.file')::uuid)
  and (select x=610 and y=610 from public.resources where id=current_setting('moseek.test.image')::uuid),
  'Grouped movement preserves every Resource position relative to its Section');
update public.resources set section_id=null where id=current_setting('moseek.test.note')::uuid;
select pg_temp.assert((select section_id is null and x=510 and y=570
  from public.resources where id=current_setting('moseek.test.note')::uuid)
  and (select x=560 and y=590 from public.resources where id=current_setting('moseek.test.file')::uuid),
  'Moving one Note out of a Section preserves its position and leaves other resources in place');
update public.resources set section_id=:'section_id'::uuid where id=current_setting('moseek.test.note')::uuid;
update public.resources set x=x+40,y=y+30,width=400,height=300
  where id=current_setting('moseek.test.image')::uuid;
select pg_temp.assert((select x=650 and y=640 and width=400 and height=300
  from public.resources where id=current_setting('moseek.test.image')::uuid)
  and (select x=510 and y=570 from public.resources where id=current_setting('moseek.test.note')::uuid),
  'Editor can resize and move one Image without moving other Section contents');
do $$ begin
  begin perform * from public.move_section_group(current_setting('moseek.test.environment')::uuid,
    current_setting('moseek.test.section')::uuid,200,220,8000,430,(select updated_at from public.sections where id=current_setting('moseek.test.section')::uuid));
    raise exception 'ASSERT FAILED: unsafe Section dimensions were accepted';
  exception when invalid_parameter_value then raise notice 'PASS: unsafe grouped dimensions are rejected'; end;
end $$;
select pg_temp.assert((select x=160 and y=190 and width=660 from public.sections where id=:'section_id'::uuid),
  'Failed grouped movement leaves all Section positions unchanged');
do $$ begin
  begin
    update public.resources set section_id=current_setting('moseek.test.other_section')::uuid
      where id=current_setting('moseek.test.note')::uuid;
    raise exception 'ASSERT FAILED: cross-Environment Section assignment succeeded';
  exception when foreign_key_violation then raise notice 'PASS: Resource cannot attach to a Section in another Environment'; end;
end $$;
select pg_temp.assert((select section_id=current_setting('moseek.test.section')::uuid
  from public.resources where id=current_setting('moseek.test.note')::uuid), 'Rejected cross-Environment assignment preserves existing containment');

-- A stale Section move must fail rather than overwrite a newer layout.
do $$ begin
  begin perform * from public.move_section_group(current_setting('moseek.test.environment')::uuid,
    current_setting('moseek.test.section')::uuid,170,200,660,430,current_setting('moseek.test.section_updated_at')::timestamptz-interval '1 second');
    raise exception 'ASSERT FAILED: stale grouped move overwrote a newer position';
  exception when serialization_failure then raise notice 'PASS: stale grouped movement is rejected by updated_at'; end;
end $$;

-- The Storage API owns object removal. This SQL test only verifies that the
-- database guard refuses metadata deletion while the private object remains.
do $$ declare blocked boolean := false; failure text; begin
  begin
    delete from public.resources where id=current_setting('moseek.test.file')::uuid;
  exception when sqlstate 'P0001' then
    get stacked diagnostics failure = message_text;
    if failure = 'Delete the Storage object before deleting its Resource' then blocked := true;
    else raise; end if;
  end;
  if not blocked then raise exception 'ASSERT FAILED: Resource deletion bypassed Storage-first cleanup'; end if;
  raise notice 'PASS: File Resource cannot be deleted before its Storage object';
end $$;
select pg_temp.assert(exists (select 1 from storage.objects where bucket_id='environment-files'
  and name=current_setting('moseek.test.environment')||'/'||current_setting('moseek.test.file')||'/doc.pdf')
  and exists (select 1 from public.resources where id=current_setting('moseek.test.file')::uuid),
  'Rejected metadata deletion preserves both the exact private object and its Resource');
delete from public.sections where id=:'section_id'::uuid;
select pg_temp.assert((select count(*)=3 from public.resources where environment_id=current_setting('moseek.test.environment')::uuid
  and section_id is null), 'Deleting a Section preserves its Notes, Files, and Images and detaches them');
select pg_temp.assert((select count(*)=2 from storage.objects where bucket_id='environment-files'
  and name like current_setting('moseek.test.environment')||'/%'), 'Deleting a Section leaves its private Storage objects intact');

reset role;
rollback;
