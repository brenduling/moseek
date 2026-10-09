\set ON_ERROR_STOP on
begin;
set local client_min_messages = notice;
select gen_random_uuid() as owner_id \gset
select gen_random_uuid() as editor_id \gset
select gen_random_uuid() as viewer_id \gset
select gen_random_uuid() as outsider_id \gset
select gen_random_uuid() as environment_id \gset
select gen_random_uuid() as section_id \gset
select gen_random_uuid() as note_id \gset
select gen_random_uuid() as file_id \gset
insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) values
  (:'owner_id','authenticated','authenticated','phase45-activity-owner-'||:'owner_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'editor_id','authenticated','authenticated','phase45-activity-editor-'||:'editor_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'viewer_id','authenticated','authenticated','phase45-activity-viewer-'||:'viewer_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'outsider_id','authenticated','authenticated','phase45-activity-outsider-'||:'outsider_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false);
select set_config('moseek.test.environment',:'environment_id',true);
select set_config('moseek.test.section',:'section_id',true);
select set_config('moseek.test.note',:'note_id',true);
select set_config('moseek.test.file',:'file_id',true);
create function pg_temp.assume_user(actor uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
end $$;
create function pg_temp.assert(ok boolean,message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'ASSERT FAILED: %',message; end if;
  raise notice 'PASS: %',message;
end $$;
set local role authenticated;
select pg_temp.assume_user(:'owner_id'::uuid);
insert into public.environments (id,name,type,created_by) values (:'environment_id','Activity test space','shared',auth.uid());
select pg_temp.assert((select count(*)=1 from public.environment_activity where environment_id=:'environment_id'::uuid
  and action='environment_created' and actor_id=auth.uid() and actor_name <> '' and occurred_at <= clock_timestamp()),
  'Environment creation records the authenticated actor and server timestamp');
insert into public.environment_members (environment_id,user_id,role) values
  (:'environment_id',:'editor_id','editor'),(:'environment_id',:'viewer_id','viewer');
insert into public.sections (id,environment_id,title,x,y,width,height,created_by)
values (:'section_id',:'environment_id','Reading room',100,100,660,430,auth.uid());
insert into public.resources (id,environment_id,section_id,created_by,type,title,x,y,body)
values (:'note_id',:'environment_id',:'section_id',auth.uid(),'note','Research notes',300,320,'Test note body');
select pg_temp.assert((select count(*)=1 from public.environment_activity where environment_id=:'environment_id'::uuid
  and target_id=:'note_id'::uuid and action='resource_created' and target_label='Research notes'
  and metadata::text not like '%Test note body%' and target_label <> 'Test note body'),
  'Note history records its title without storing the Note body');
select id as section_id,updated_at as section_updated_at from public.sections where id=:'section_id'::uuid \gset
select pg_temp.assert(public.move_section_group(:'environment_id'::uuid,:'section_id'::uuid,150,170,660,430,:'section_updated_at'::timestamptz) is not null,
  'Section group movement uses its trusted atomic operation');
select pg_temp.assert((select count(*)=1 from public.environment_activity where environment_id=:'environment_id'::uuid
  and action='section_moved' and target_id=:'section_id'::uuid)
  and not exists (select 1 from public.environment_activity where environment_id=:'environment_id'::uuid
    and action='resource_moved' and target_id=:'note_id'::uuid),
  'A Section group drag creates one meaningful history entry, not one per contained Resource');
update public.resources set section_id=null where id=:'note_id'::uuid;
update public.resources set section_id=:'section_id'::uuid where id=:'note_id'::uuid;
select pg_temp.assert((select count(*)=1 from public.environment_activity where target_id=:'note_id'::uuid and action='resource_detached')
  and (select count(*)=1 from public.environment_activity where target_id=:'note_id'::uuid and action='resource_attached'),
  'Resource attachment and detachment create separate activity entries');

update public.environment_members set role='viewer' where environment_id=:'environment_id' and user_id=:'editor_id';
select pg_temp.assert((select count(*)=1 from public.environment_activity where environment_id=:'environment_id'::uuid
  and target_id=:'editor_id'::uuid and action='contributor_role_changed' and metadata->>'to_role'='viewer'),
  'Contributor role changes record the acting Owner and role change only');
delete from public.environment_members where environment_id=:'environment_id' and user_id=:'editor_id';
delete from public.environment_members where environment_id=:'environment_id' and user_id=auth.uid();
select pg_temp.assert(exists(select 1 from public.environment_members where environment_id=:'environment_id'::uuid and user_id=auth.uid() and role='owner'),
  'The protected Owner membership cannot be removed by an activity operation');

insert into public.resources (id,environment_id,created_by,type,title,original_filename,mime_type,file_size,storage_path,x,y)
values (:'file_id',:'environment_id',auth.uid(),'file','Plan','plan.pdf','application/pdf',64,
  :'environment_id'||'/'||:'file_id'||'/opaque.pdf',0,0);
insert into storage.objects (bucket_id,name,owner,owner_id,metadata) values
  ('environment-files',:'environment_id'||'/'||:'file_id'||'/opaque.pdf',auth.uid(),auth.uid()::text,'{"mimetype":"application/pdf","size":64}'::jsonb);
select pg_temp.assert(public.record_environment_resource_upload(:'file_id'::uuid)='recorded',
  'Completed Storage upload writes its history entry only after the exact object exists');
select pg_temp.assert((select count(*)=1 from public.environment_activity where target_id=:'file_id'::uuid
  and action='file_uploaded' and target_label='Plan'), 'Upload activity contains safe file label without Storage path');

select pg_temp.assert(not has_table_privilege('authenticated','public.environment_activity','INSERT')
  and not has_table_privilege('authenticated','public.environment_activity','UPDATE')
  and not has_table_privilege('authenticated','public.environment_activity','DELETE'),
  'Authenticated clients have read-only access to the append-only history table');
do $$ begin
  begin insert into public.environment_activity(environment_id,actor_id,actor_name,action,target_type)
    values (current_setting('moseek.test.environment')::uuid,auth.uid(),'Forged','resource_created','resource');
    raise exception 'ASSERT FAILED: direct history INSERT succeeded';
  exception when insufficient_privilege then raise notice 'PASS: direct client history insertion is denied'; end;
end $$;
do $$ declare rollback_id uuid := gen_random_uuid(); begin
  begin
    insert into public.sections(id,environment_id,title,x,y,width,height,created_by)
    values(rollback_id,current_setting('moseek.test.environment')::uuid,'Rolled back',0,0,400,240,auth.uid());
    raise exception 'ROLLBACK TEST';
  exception when others then if sqlerrm <> 'ROLLBACK TEST' then raise; end if; end;
  if exists(select 1 from public.environment_activity where target_id=rollback_id) then
    raise exception 'ASSERT FAILED: rolled-back Section left a history row';
  end if;
  raise notice 'PASS: failed transaction rolls back its activity entry';
end $$;

select pg_temp.assume_user(:'viewer_id'::uuid);
select pg_temp.assert((select count(*)>0 from public.environment_activity where environment_id=:'environment_id'::uuid),
  'Environment Viewer can read activity history');
select pg_temp.assume_user(:'outsider_id'::uuid);
select pg_temp.assert((select count(*)=0 from public.environment_activity where environment_id=:'environment_id'::uuid),
  'Outsider cannot read Environment activity history');
reset role;
rollback;
