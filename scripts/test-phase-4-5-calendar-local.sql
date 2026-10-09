\set ON_ERROR_STOP on
begin;
set local client_min_messages = notice;
select gen_random_uuid() as owner_id \gset
select gen_random_uuid() as editor_id \gset
select gen_random_uuid() as viewer_id \gset
select gen_random_uuid() as outsider_id \gset
select gen_random_uuid() as environment_id \gset
select gen_random_uuid() as private_environment_id \gset
select gen_random_uuid() as section_id \gset
select gen_random_uuid() as resource_id \gset
select gen_random_uuid() as event_id \gset
select gen_random_uuid() as allday_id \gset
select gen_random_uuid() as task_id \gset
insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) values
  (:'owner_id','authenticated','authenticated','phase45-calendar-owner-'||:'owner_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'editor_id','authenticated','authenticated','phase45-calendar-editor-'||:'editor_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'viewer_id','authenticated','authenticated','phase45-calendar-viewer-'||:'viewer_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'outsider_id','authenticated','authenticated','phase45-calendar-outsider-'||:'outsider_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false);
select set_config('moseek.test.environment',:'environment_id',true);
select set_config('moseek.test.outsider',:'outsider_id',true);
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
insert into public.environments (id,name,type,created_by) values
  (:'environment_id','Calendar collaboration fixture','shared',auth.uid()),
  (:'private_environment_id','Calendar private fixture','personal',auth.uid());
insert into public.environment_members (environment_id,user_id,role) values
  (:'environment_id',:'editor_id','editor'),(:'environment_id',:'viewer_id','viewer');
insert into public.sections (id,environment_id,title,x,y,width,height,created_by)
values (:'section_id',:'environment_id','Planning',0,0,660,430,auth.uid());
insert into public.resources (id,environment_id,section_id,created_by,type,title,x,y,body)
values (:'resource_id',:'environment_id',:'section_id',auth.uid(),'note','Brief',10,20,'');
select pg_temp.assume_user(:'editor_id'::uuid);
insert into public.environment_calendar_items (id,environment_id,item_type,title,description,starts_at,ends_at,due_at,status,
  assigned_to,section_id,resource_id,created_by)
values (:'event_id',:'environment_id','event','Planning session','A short shared session',
  '2026-10-20 09:00:00+08','2026-10-20 10:00:00+08','2026-10-19 17:00:00+08','event',
  auth.uid(),:'section_id',:'resource_id',auth.uid());
insert into public.environment_calendar_items (id,environment_id,item_type,title,all_day,all_day_start,all_day_end,status,created_by)
values (:'allday_id',:'environment_id','event','All-day review',true,'2026-10-21','2026-10-21','event',auth.uid());
insert into public.environment_calendar_items (id,environment_id,item_type,title,due_at,status,assigned_to,section_id,created_by)
values (:'task_id',:'environment_id','task','Share a draft','2026-10-22 17:00:00+08','open',auth.uid(),:'section_id',auth.uid());
select pg_temp.assert((select count(*)=3 from public.environment_calendar_items where environment_id=:'environment_id'::uuid),
  'Editor creates Events, all-day dates, and Tasks');
select pg_temp.assert((select starts_at='2026-10-20 01:00:00+00'::timestamptz and ends_at='2026-10-20 02:00:00+00'::timestamptz
  and due_at='2026-10-19 09:00:00+00'::timestamptz from public.environment_calendar_items where id=:'event_id'::uuid),
  'Timed Events and deadlines are stored as absolute instants across time zones');
select pg_temp.assert((select all_day_start='2026-10-21'::date and all_day_end='2026-10-21'::date and starts_at is null
  from public.environment_calendar_items where id=:'allday_id'::uuid),
  'All-day Events retain calendar dates without time-zone shifting');
select pg_temp.assert((select assigned_to=auth.uid() and section_id=:'section_id'::uuid and resource_id=:'resource_id'::uuid
  from public.environment_calendar_items where id=:'event_id'::uuid),
  'Calendar item assignment and links remain within the same Environment');
do $$ begin
  begin
    insert into public.environment_calendar_items (environment_id,item_type,title,starts_at,ends_at,status,created_by)
    values (current_setting('moseek.test.environment')::uuid,'event','Invalid timing','2026-10-22 10:00+00','2026-10-22 09:00+00','event',auth.uid());
    raise exception 'ASSERT FAILED: event end before start was accepted';
  exception when check_violation then raise notice 'PASS: Event date ordering is validated'; end;
end $$;
do $$ begin
  begin
    insert into public.environment_calendar_items (environment_id,item_type,title,status,assigned_to,created_by)
    values (current_setting('moseek.test.environment')::uuid,'task','Cross Environment assignment','open',
      current_setting('moseek.test.outsider')::uuid,auth.uid());
    raise exception 'ASSERT FAILED: nonmember assignment was accepted';
  exception when foreign_key_violation then raise notice 'PASS: Assignment requires a member of the same Environment'; end;
end $$;
update public.environment_calendar_items set status='done' where id=:'task_id'::uuid;
select pg_temp.assert((select status='done' from public.environment_calendar_items where id=:'task_id'::uuid),
  'Editor updates Task progress');
select pg_temp.assert((select count(*)=4 from public.environment_activity where environment_id=:'environment_id'::uuid
  and action in ('calendar_item_created','calendar_status_changed')),
  'Calendar creation and status changes create server-authored history');
select pg_temp.assert((select count(*)>=2 from public.get_home_upcoming_calendar_items(current_date)
  where environment_id=:'environment_id'::uuid), 'Home upcoming query returns actual future items');
select pg_temp.assert(not exists(select 1 from public.get_home_upcoming_calendar_items(current_date)
  where item_id=:'task_id'::uuid), 'Completed future Tasks do not remain in Home upcoming items');

select pg_temp.assume_user(:'viewer_id'::uuid);
select pg_temp.assert((select count(*)=3 from public.environment_calendar_items where environment_id=:'environment_id'::uuid),
  'Viewer can read Environment calendar items');
do $$ begin
  begin
    insert into public.environment_calendar_items (environment_id,item_type,title,starts_at,status,created_by)
    values (current_setting('moseek.test.environment')::uuid,'event','Denied Viewer event','2026-10-23 12:00+00','event',auth.uid());
    raise exception 'ASSERT FAILED: Viewer calendar INSERT succeeded';
  exception when insufficient_privilege then raise notice 'PASS: Viewer cannot create calendar items'; end;
end $$;
select pg_temp.assert((select count(*)=3 from public.environment_calendar_items where environment_id=:'environment_id'::uuid),
  'Viewer insert attempt leaves no calendar item');
update public.environment_calendar_items set title='Viewer edit' where id=:'event_id'::uuid;
select pg_temp.assert((select title='Planning session' from public.environment_calendar_items where id=:'event_id'::uuid),
  'Viewer cannot edit calendar items');
delete from public.environment_calendar_items where id=:'event_id'::uuid;
select pg_temp.assert((select count(*)=1 from public.environment_calendar_items where id=:'event_id'::uuid),
  'Viewer cannot delete calendar items');
select pg_temp.assume_user(:'outsider_id'::uuid);
select pg_temp.assert((select count(*)=0 from public.environment_calendar_items where environment_id=:'environment_id'::uuid)
  and (select count(*)=0 from public.get_home_upcoming_calendar_items(current_date) where environment_id=:'environment_id'::uuid),
  'Outsider cannot read Environment calendar or Home upcoming items');
select pg_temp.assume_user(:'owner_id'::uuid);
select pg_temp.assert((select count(*)=0 from public.environment_calendar_items where environment_id=:'private_environment_id'::uuid),
  'Personal Environment calendar stays private and empty until real items are added');
reset role;
rollback;
