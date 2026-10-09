\set ON_ERROR_STOP on

-- Resource count tests run as authenticated roles; all fixtures are rolled back.
begin;
set local client_min_messages = notice;
select gen_random_uuid() owner_id \gset
select gen_random_uuid() viewer_id \gset
select gen_random_uuid() outsider_id \gset
select gen_random_uuid() environment_id \gset
select gen_random_uuid() section_id \gset
select gen_random_uuid() note_id \gset
select gen_random_uuid() link_id \gset
select gen_random_uuid() file_id \gset

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) values
  (:'owner_id','authenticated','authenticated','home-count-owner-'||:'owner_id' || '@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'viewer_id','authenticated','authenticated','home-count-viewer-'||:'viewer_id' || '@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'outsider_id','authenticated','authenticated','home-count-outsider-'||:'outsider_id' || '@example.invalid','',now(),'{}','{}',now(),now(),false,false);
select set_config('moseek.test.owner', :'owner_id', true);
select set_config('moseek.test.viewer', :'viewer_id', true);
select set_config('moseek.test.outsider', :'outsider_id', true);
select set_config('moseek.test.environment', :'environment_id', true);
select set_config('moseek.test.section', :'section_id', true);
select set_config('moseek.test.note', :'note_id', true);
select set_config('moseek.test.link', :'link_id', true);
select set_config('moseek.test.file', :'file_id', true);
create function pg_temp.assume_user(actor uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
end $$;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'ASSERT FAILED: %',message; end if;
  raise notice 'PASS: %',message;
end $$;

set local role authenticated;
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
insert into public.environments (id,name,type,created_by)
values (current_setting('moseek.test.environment')::uuid,'Resource count fixture','shared',auth.uid());
insert into public.environment_members (environment_id,user_id,role)
values (current_setting('moseek.test.environment')::uuid,current_setting('moseek.test.viewer')::uuid,'viewer');
select pg_temp.assert((select resource_count = 0 from public.get_home_environment_resource_counts()
  where environment_id=current_setting('moseek.test.environment')::uuid),
  'Empty Environment reports a zero resource count');

insert into public.sections (id,environment_id,title,x,y,width,height,created_by)
values (current_setting('moseek.test.section')::uuid,current_setting('moseek.test.environment')::uuid,'Section',1,2,300,200,auth.uid());
insert into public.resources (id,environment_id,created_by,type,title,body,url,original_filename,mime_type,file_size,storage_path)
values (current_setting('moseek.test.note')::uuid,current_setting('moseek.test.environment')::uuid,auth.uid(),'note','Note','Body',null,null,null,null,null),
       (current_setting('moseek.test.link')::uuid,current_setting('moseek.test.environment')::uuid,auth.uid(),'link','Link',null,'https://example.invalid',null,null,null,null),
       (current_setting('moseek.test.file')::uuid,current_setting('moseek.test.environment')::uuid,auth.uid(),'file','File',null,null,'brief.pdf','application/pdf',32,
        current_setting('moseek.test.environment')||'/'||current_setting('moseek.test.file')||'/brief.pdf');
select pg_temp.assert((select resource_count = 4 from public.get_home_environment_resource_counts()
  where environment_id=current_setting('moseek.test.environment')::uuid),
  'Section, Note, Link, and File records are counted as persisted canvas cards');

select pg_temp.assume_user(current_setting('moseek.test.viewer')::uuid);
select pg_temp.assert((select resource_count = 4 from public.get_home_environment_resource_counts()
  where environment_id=current_setting('moseek.test.environment')::uuid),
  'Viewer receives the count for an Environment visible through RLS');
select pg_temp.assume_user(current_setting('moseek.test.outsider')::uuid);
select pg_temp.assert(not exists (select 1 from public.get_home_environment_resource_counts()
  where environment_id=current_setting('moseek.test.environment')::uuid),
  'The count RPC does not expose an Environment to a nonmember');

select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
delete from public.resources where id=current_setting('moseek.test.link')::uuid;
select pg_temp.assert((select resource_count = 3 from public.get_home_environment_resource_counts()
  where environment_id=current_setting('moseek.test.environment')::uuid),
  'Deleting a Link reduces the next resource count');
delete from public.resources where environment_id=current_setting('moseek.test.environment')::uuid;
delete from public.sections where id=current_setting('moseek.test.section')::uuid;
select pg_temp.assert((select resource_count = 0 from public.get_home_environment_resource_counts()
  where environment_id=current_setting('moseek.test.environment')::uuid),
  'Deleting the remaining Resources and Section returns the count to zero');

reset role;
rollback;
