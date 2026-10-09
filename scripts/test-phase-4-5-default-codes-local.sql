\set ON_ERROR_STOP on
begin;
set local client_min_messages = notice;
select gen_random_uuid() as owner_id \gset
select gen_random_uuid() as admin_id \gset
select gen_random_uuid() as editor_id \gset
select gen_random_uuid() as viewer_id \gset
select gen_random_uuid() as outsider_id \gset
select gen_random_uuid() as shared_id \gset
select gen_random_uuid() as personal_id \gset
select gen_random_uuid() as conversion_id \gset
insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) values
  (:'owner_id','authenticated','authenticated','phase45-owner-'||:'owner_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'admin_id','authenticated','authenticated','phase45-admin-'||:'admin_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'editor_id','authenticated','authenticated','phase45-editor-'||:'editor_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'viewer_id','authenticated','authenticated','phase45-viewer-'||:'viewer_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'outsider_id','authenticated','authenticated','phase45-outsider-'||:'outsider_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false);
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
  (:'shared_id','Phase 4.5 shared code fixture','shared',auth.uid()),
  (:'personal_id','Phase 4.5 personal code fixture','personal',auth.uid()),
  (:'conversion_id','Phase 4.5 conversion fixture','shared',auth.uid());
select set_config('moseek.test.shared',:'shared_id',true);
select set_config('moseek.test.conversion',:'conversion_id',true);
select pg_temp.assert((select count(*)=1 from public.list_environment_default_invitation_code(:'shared_id'::uuid)
  where state='active' and role='editor' and approval_required and expires_at>now()),
  'Shared Environment creation provisions one active Editor code with approval required');
select pg_temp.assert((select count(*)=0 from public.list_environment_default_invitation_code(:'personal_id'::uuid)),
  'Personal Environment has no sharing code');
select pg_temp.assert((select count(*)=1 from public.list_environment_default_invitation_code(:'conversion_id'::uuid)
  where state='active'), 'Second Shared Environment receives its own default code');
insert into public.environment_members (environment_id,user_id,role) values
  (:'shared_id',:'admin_id','admin'),(:'shared_id',:'editor_id','editor'),(:'shared_id',:'viewer_id','viewer');
select pg_temp.assume_user(:'editor_id'::uuid);
do $$ begin
  begin perform * from public.reissue_environment_default_invitation_code(current_setting('moseek.test.shared')::uuid);
    raise exception 'ASSERT FAILED: Editor reissued default code';
  exception when insufficient_privilege then raise notice 'PASS: Editor cannot reissue a sharing code'; end;
end $$;
select pg_temp.assume_user(:'viewer_id'::uuid);
do $$ begin
  begin perform * from public.disable_environment_default_invitation_code(current_setting('moseek.test.shared')::uuid);
    raise exception 'ASSERT FAILED: Viewer disabled default code';
  exception when insufficient_privilege then raise notice 'PASS: Viewer cannot disable a sharing code'; end;
end $$;
select pg_temp.assume_user(:'outsider_id'::uuid);
do $$ begin
  begin perform * from public.list_environment_default_invitation_code(current_setting('moseek.test.shared')::uuid);
    raise exception 'ASSERT FAILED: Outsider read default code metadata';
  exception when insufficient_privilege then raise notice 'PASS: Outsider cannot read sharing-code metadata'; end;
end $$;
select pg_temp.assume_user(:'admin_id'::uuid);
select * from public.reissue_environment_default_invitation_code(:'shared_id'::uuid) \gset
select pg_temp.assert(length(:'invitation_code')=7 and :'invitation_code' ~ '^[A-HJ-NP-Z2-9]{7}$'
  and :'invitation_code' ~ '[A-Z]' and :'invitation_code' ~ '[2-9]',
  'Authorized Admin receives a seven-character cryptographically random code once');
select set_config('moseek.test.shared',:'shared_id',true) as ignored \gset
select set_config('moseek.test.code',:'invitation_code',true) as ignored \gset
reset role;
select pg_temp.assert((select c.code_hash=extensions.digest(convert_to(current_setting('moseek.test.code'),'UTF8'),'sha256')
  and c.role='editor' and c.approval_required and c.is_default
  from public.environment_invitation_codes c where c.environment_id=current_setting('moseek.test.shared')::uuid
  and c.revoked_at is null), 'Only the SHA-256 verifier is stored, with fixed Editor role and approval required');
select pg_temp.assert((select count(*)=1 from public.environment_invitation_codes
  where environment_id=current_setting('moseek.test.shared')::uuid and is_default and revoked_at is null),
  'Reissue leaves only one active default code');
set local role authenticated;
select pg_temp.assume_user(:'outsider_id'::uuid);
select pg_temp.assert((select public.redeem_environment_invitation_code(current_setting('moseek.test.code'))='approval_pending'),
  'Default code redemption creates an approval-required join request');
select id as request_id from public.environment_join_requests where environment_id=current_setting('moseek.test.shared')::uuid and user_id=auth.uid() and status='pending' \gset
select public.respond_to_environment_join_request(:'request_id'::uuid,false);
select pg_temp.assume_user(:'owner_id'::uuid);
select pg_temp.assert((select public.disable_environment_default_invitation_code(:'shared_id'::uuid)='disabled'),
  'Owner can disable the default code');
select pg_temp.assert((select state='disabled' from public.list_environment_default_invitation_code(:'shared_id'::uuid)),
  'Disabled default code is visible as disabled and cannot be recovered');
select pg_temp.assert((select count(*)=1 from public.reissue_environment_default_invitation_code(:'conversion_id'::uuid)),
  'Owner can issue a fresh one-time default code');
select * from public.create_environment_invitation_code(:'conversion_id'::uuid,'editor',true) \gset manual_
select * from public.convert_environment_type(:'conversion_id'::uuid,'personal');
select pg_temp.assert((select type='personal' from public.environments where id=:'conversion_id'::uuid),
  'Shared-to-Personal conversion succeeds for sole Owner');
reset role;
select pg_temp.assert((select count(*)=0 from public.environment_invitation_codes
  where environment_id=:'conversion_id'::uuid and revoked_at is null),
  'Shared-to-Personal conversion revokes every active default and manual code');
rollback;
