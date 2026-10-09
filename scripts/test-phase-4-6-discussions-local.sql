\set ON_ERROR_STOP on
begin;
set local client_min_messages = notice;

select gen_random_uuid() as owner_id \gset
select gen_random_uuid() as admin_id \gset
select gen_random_uuid() as editor_id \gset
select gen_random_uuid() as viewer_id \gset
select gen_random_uuid() as outsider_id \gset
select gen_random_uuid() as environment_id \gset
select gen_random_uuid() as personal_environment_id \gset
select gen_random_uuid() as section_id \gset
select gen_random_uuid() as personal_section_id \gset

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) values
  (:'owner_id','authenticated','authenticated','phase46-owner-'||:'owner_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'admin_id','authenticated','authenticated','phase46-admin-'||:'admin_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'editor_id','authenticated','authenticated','phase46-editor-'||:'editor_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'viewer_id','authenticated','authenticated','phase46-viewer-'||:'viewer_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'outsider_id','authenticated','authenticated','phase46-outsider-'||:'outsider_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false);

select set_config('moseek.test.environment', :'environment_id', true);
select set_config('moseek.test.personal_environment', :'personal_environment_id', true);
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
insert into public.environments(id,name,type,created_by)
values (:'environment_id','Phase 4.6 Discussion Fixture','shared',auth.uid());
insert into public.environments(id,name,type,created_by)
values (:'personal_environment_id','Phase 4.6 Personal Fixture','personal',auth.uid());
insert into public.environment_members(environment_id,user_id,role) values
  (:'environment_id',:'admin_id','admin'),(:'environment_id',:'editor_id','editor'),(:'environment_id',:'viewer_id','viewer');
insert into public.sections(id,environment_id,title,x,y,width,height,created_by)
values (:'section_id',:'environment_id','Discussion Section',30,40,660,430,auth.uid()),
  (:'personal_section_id',:'personal_environment_id','Private Section',60,80,660,430,auth.uid());
select set_config('moseek.test.section', :'section_id', true);

select pg_temp.assert(not has_table_privilege('authenticated','public.section_discussions','INSERT')
  and not has_table_privilege('authenticated','public.section_discussions','UPDATE')
  and not has_table_privilege('authenticated','public.section_discussion_messages','INSERT')
  and not has_table_privilege('authenticated','public.section_discussion_messages','DELETE'),
  'Authenticated clients cannot directly write Discussion records or messages');
select pg_temp.assert(has_function_privilege('authenticated','public.create_section_discussion(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.send_section_discussion_message(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.create_section_discussion(uuid,uuid)','EXECUTE'),
  'Only signed-in callers can execute the trusted Discussion operations');
select pg_temp.assert(exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages'
  and policyname='moseek_section_discussion_realtime_member_read' and roles @> array['authenticated']::name[]),
  'Realtime private-topic access has a dedicated authenticated membership policy');

select public.create_section_discussion(:'environment_id'::uuid,:'section_id'::uuid) as discussion_id \gset
select set_config('moseek.test.discussion', :'discussion_id', true);
select pg_temp.assert(:'discussion_id'::uuid is not null
  and public.create_section_discussion(:'environment_id'::uuid,:'section_id'::uuid)=:'discussion_id'::uuid,
  'Owner creates one Discussion Box per Section and repeated creation is idempotent');
reset role;
insert into realtime.messages(topic,extension,payload,event,private)
values ('moseek-section-discussion:'||:'discussion_id','broadcast','{}'::jsonb,'test',true);
set local role authenticated;
select pg_temp.assume_user(:'owner_id'::uuid);
select set_config('realtime.topic','moseek-section-discussion:'||:'discussion_id',true);
select pg_temp.assert((select count(*)=1 from realtime.messages where topic='moseek-section-discussion:'||:'discussion_id'),
  'Environment Owner is authorized for the private Discussion Realtime topic');
select to_jsonb(message_row) as owner_message from public.send_section_discussion_message(:'discussion_id'::uuid,'Owner message') message_row \gset
select (:'owner_message'::jsonb->>'message_id')::bigint as owner_message_id \gset
select set_config('moseek.test.owner_message', :'owner_message_id', true);
select pg_temp.assert((:'owner_message'::jsonb->>'status')='sent', 'Shared Environment Owner can send a message');

select pg_temp.assume_user(:'admin_id'::uuid);
select pg_temp.assert((select count(*)=1 from public.section_discussions where id=:'discussion_id'::uuid),
  'Environment Admin can read its Discussion Box');
select to_jsonb(message_row) as admin_message from public.send_section_discussion_message(:'discussion_id'::uuid,'Admin message') message_row \gset
select (:'admin_message'::jsonb->>'message_id')::bigint as admin_message_id \gset
select set_config('moseek.test.admin_message', :'admin_message_id', true);
select pg_temp.assert((:'admin_message'::jsonb->>'status')='sent', 'Environment Admin can send a message');
do $$ begin
  begin perform public.remove_section_discussion(current_setting('moseek.test.discussion')::uuid);
    raise exception 'ASSERT FAILED: Admin removal unexpectedly succeeded';
  exception when insufficient_privilege then raise notice 'PASS: Admin cannot remove the Owner-managed Discussion Box'; end;
end $$;

select pg_temp.assume_user(:'editor_id'::uuid);
select to_jsonb(message_row) as editor_message from public.send_section_discussion_message(:'discussion_id'::uuid,'Editor message') message_row \gset
select pg_temp.assert((:'editor_message'::jsonb->>'status')='sent', 'Environment Editor can send a message');
do $$ begin
  begin perform public.send_section_discussion_message(current_setting('moseek.test.discussion')::uuid,'');
    raise exception 'ASSERT FAILED: Empty message unexpectedly succeeded';
  exception when sqlstate '22023' then raise notice 'PASS: Empty message is rejected by the database'; end;
end $$;
do $$ begin
  begin delete from public.sections where id=current_setting('moseek.test.section')::uuid;
    raise exception 'ASSERT FAILED: Editor deleted a Section before its Discussion Box was removed';
  exception when insufficient_privilege then raise notice 'PASS: Section with a Discussion can only be removed by its Owner'; end;
end $$;

select pg_temp.assume_user(:'viewer_id'::uuid);
select pg_temp.assert((select count(*)=3 from public.section_discussion_messages where discussion_id=:'discussion_id'::uuid),
  'Viewer can read messages but receives no write permission');
do $$ begin
  begin perform public.send_section_discussion_message(current_setting('moseek.test.discussion')::uuid,'Viewer message');
    raise exception 'ASSERT FAILED: Viewer send unexpectedly succeeded';
  exception when insufficient_privilege then raise notice 'PASS: Viewer cannot send a message'; end;
end $$;
select pg_temp.assume_user(:'editor_id'::uuid);
do $$ declare i integer; result_status text; begin
  for i in 2..30 loop
    select sent.status into result_status from public.send_section_discussion_message(
      current_setting('moseek.test.discussion')::uuid, 'Rate-limit fixture ' || i) sent;
    if result_status <> 'sent' then raise exception 'ASSERT FAILED: message was rate-limited before attempt 30'; end if;
  end loop;
  select sent.status into result_status from public.send_section_discussion_message(
    current_setting('moseek.test.discussion')::uuid, 'Rate-limit fixture 31') sent;
  if result_status <> 'rate_limited' then raise exception 'ASSERT FAILED: attempt 31 was not rate-limited'; end if;
  raise notice 'PASS: Sender is limited after 30 messages in a one-minute window';
end $$;

select pg_temp.assume_user(:'outsider_id'::uuid);
select set_config('realtime.topic','moseek-section-discussion:'||:'discussion_id',true);
select pg_temp.assert((select count(*)=0 from public.section_discussions where id=:'discussion_id'::uuid)
  and (select count(*)=0 from public.section_discussion_messages where discussion_id=:'discussion_id'::uuid)
  and (select count(*)=0 from realtime.messages where topic='moseek-section-discussion:'||:'discussion_id'),
  'Outsider cannot read Discussion Boxes, messages, or their private Realtime topic');
select set_config('realtime.topic','moseek-section-discussion:not-a-uuid',true);
select pg_temp.assert((select count(*)=0 from realtime.messages),
  'Malformed Discussion Realtime topics are denied safely');
do $$ begin
  begin perform public.list_section_discussion_messages(current_setting('moseek.test.discussion')::uuid,null,30);
    raise exception 'ASSERT FAILED: Outsider message listing unexpectedly succeeded';
  exception when insufficient_privilege then raise notice 'PASS: Outsider cannot read messages through the trusted RPC'; end;
end $$;

select pg_temp.assume_user(:'editor_id'::uuid);
do $$ begin
  begin perform public.delete_section_discussion_message(current_setting('moseek.test.admin_message')::bigint);
    raise exception 'ASSERT FAILED: Non-author Editor message removal unexpectedly succeeded';
  exception when insufficient_privilege then raise notice 'PASS: Editor cannot remove another contributor message'; end;
end $$;
select pg_temp.assert(public.delete_section_discussion_message((:'editor_message'::jsonb->>'message_id')::bigint)='removed',
  'Message author can remove their own message');

select pg_temp.assume_user(:'owner_id'::uuid);
do $$ begin
  begin perform public.create_section_discussion(current_setting('moseek.test.personal_environment')::uuid,
      (select id from public.sections where environment_id=current_setting('moseek.test.personal_environment')::uuid limit 1));
    raise exception 'ASSERT FAILED: Personal Environment discussion unexpectedly succeeded';
  exception when insufficient_privilege then raise notice 'PASS: Personal Environments cannot create Discussion Boxes'; end;
end $$;
do $$ begin
  begin perform public.convert_environment_type(current_setting('moseek.test.environment')::uuid,'personal');
    raise exception 'ASSERT FAILED: Shared-to-Personal conversion with Discussion unexpectedly succeeded';
  exception when check_violation then raise notice 'PASS: Shared-to-Personal conversion is blocked while a Discussion exists'; end;
end $$;
select pg_temp.assert((select count(*)=1 from public.environment_activity where environment_id=:'environment_id'::uuid
  and action='section_discussion_created' and target_id=:'discussion_id'::uuid),
  'Discussion creation records one meaningful Environment activity entry');
select pg_temp.assert((select count(*)=31 from public.section_discussion_messages where discussion_id=:'discussion_id'::uuid),
  'Rate-limited sends are not inserted as messages');

select pg_temp.assert((select count(*)=1 from public.list_section_discussion_messages(:'discussion_id'::uuid,null,50)
  where message_id=:'owner_message_id'::bigint), 'Trusted message pagination returns authorized history');
select public.remove_section_discussion(:'discussion_id'::uuid) as remove_result \gset
select pg_temp.assert(:'remove_result'='removed' and not exists(select 1 from public.section_discussions where id=:'discussion_id'::uuid)
  and not exists(select 1 from public.section_discussion_messages where discussion_id=:'discussion_id'::uuid),
  'Owner removes a Discussion Box and its messages together');
select pg_temp.assert((select count(*)=1 from public.environment_activity where environment_id=:'environment_id'::uuid
  and action='section_discussion_deleted' and target_id=:'discussion_id'::uuid),
  'Discussion removal records one meaningful Environment activity entry');

reset role;
rollback;
