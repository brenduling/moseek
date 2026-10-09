\set ON_ERROR_STOP on

-- Authenticated invitation and code workflows. Synthetic identities and rows
-- are transaction-scoped; no Storage objects or real mail are created.
begin;
set local client_min_messages = notice;
select gen_random_uuid() owner_id \gset
select gen_random_uuid() admin_id \gset
select gen_random_uuid() editor_id \gset
select gen_random_uuid() viewer_id \gset
select gen_random_uuid() outsider_id \gset
select gen_random_uuid() email_target_id \gset
select gen_random_uuid() username_target_id \gset
select gen_random_uuid() reject_target_id \gset
select gen_random_uuid() revoke_target_id \gset
select gen_random_uuid() code_target_id \gset
select gen_random_uuid() direct_code_target_id \gset
select gen_random_uuid() expired_code_target_id \gset
select gen_random_uuid() revoked_code_target_id \gset
select gen_random_uuid() brute_target_id \gset
select gen_random_uuid() gate_target_id \gset
select gen_random_uuid() legacy_target_id \gset
select gen_random_uuid() admin_target_id \gset
select gen_random_uuid() environment_id \gset
select gen_random_uuid() gate_environment_id \gset

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) values
  (:'owner_id','authenticated','authenticated','invite-owner-'||:'owner_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'admin_id','authenticated','authenticated','invite-admin-'||:'admin_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'editor_id','authenticated','authenticated','invite-editor-'||:'editor_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'viewer_id','authenticated','authenticated','invite-viewer-'||:'viewer_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'outsider_id','authenticated','authenticated','invite-outsider-'||:'outsider_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'email_target_id','authenticated','authenticated','existing-email-'||:'email_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'username_target_id','authenticated','authenticated','existing-username-'||:'username_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'reject_target_id','authenticated','authenticated','reject-target-'||:'reject_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'revoke_target_id','authenticated','authenticated','revoke-target-'||:'revoke_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'code_target_id','authenticated','authenticated','code-target-'||:'code_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'direct_code_target_id','authenticated','authenticated','direct-code-target-'||:'direct_code_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'expired_code_target_id','authenticated','authenticated','expired-code-target-'||:'expired_code_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'revoked_code_target_id','authenticated','authenticated','revoked-code-target-'||:'revoked_code_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'brute_target_id','authenticated','authenticated','brute-target-'||:'brute_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'gate_target_id','authenticated','authenticated','gate-target-'||:'gate_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false),
  (:'legacy_target_id','authenticated','authenticated','legacy-target-'||:'legacy_target_id'||'@example.invalid','',now(),'{}','{}',now(),now(),false,false);

select set_config('moseek.test.owner', :'owner_id', true);
select set_config('moseek.test.admin', :'admin_id', true);
select set_config('moseek.test.editor', :'editor_id', true);
select set_config('moseek.test.viewer', :'viewer_id', true);
select set_config('moseek.test.outsider', :'outsider_id', true);
select set_config('moseek.test.email_target', :'email_target_id', true);
select set_config('moseek.test.username_target', :'username_target_id', true);
select set_config('moseek.test.reject_target', :'reject_target_id', true);
select set_config('moseek.test.revoke_target', :'revoke_target_id', true);
select set_config('moseek.test.code_target', :'code_target_id', true);
select set_config('moseek.test.direct_code_target', :'direct_code_target_id', true);
select set_config('moseek.test.expired_code_target', :'expired_code_target_id', true);
select set_config('moseek.test.revoked_code_target', :'revoked_code_target_id', true);
select set_config('moseek.test.legacy_target', :'legacy_target_id', true);
select set_config('moseek.test.brute_target', :'brute_target_id', true);
select set_config('moseek.test.gate_target', :'gate_target_id', true);
select set_config('moseek.test.environment', :'environment_id', true);
select set_config('moseek.test.gate_environment', :'gate_environment_id', true);

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
values (current_setting('moseek.test.environment')::uuid,'Invitation fixture','shared',auth.uid());
insert into public.environments (id,name,type,created_by)
values (current_setting('moseek.test.gate_environment')::uuid,'Invitation gate fixture','shared',auth.uid());
insert into public.environment_members (environment_id,user_id,role) values
  (current_setting('moseek.test.environment')::uuid,current_setting('moseek.test.admin')::uuid,'admin'),
  (current_setting('moseek.test.environment')::uuid,current_setting('moseek.test.editor')::uuid,'editor'),
  (current_setting('moseek.test.environment')::uuid,current_setting('moseek.test.viewer')::uuid,'viewer');

select pg_temp.assume_user(current_setting('moseek.test.username_target')::uuid);
update public.profiles set username='moseek_handle' where id=auth.uid();
select pg_temp.assert((select username='moseek_handle' from public.profiles where id=auth.uid()),
  'User can claim an optional normalized username');

select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select public.create_environment_invitation(current_setting('moseek.test.environment')::uuid,
  'existing-email-'||current_setting('moseek.test.email_target')||'@example.invalid','admin') as invite_message \gset
select pg_temp.assert(:'invite_message' like 'If that account can be invited,%',
  'Owner can create an existing-user email invitation with a generic response');
select invitation_id as owner_admin_invite from public.list_environment_invitations(current_setting('moseek.test.environment')::uuid) \gset
select pg_temp.assert((select count(*)=1 from public.list_environment_invitations(current_setting('moseek.test.environment')::uuid)),
  'Owner sees pending invitations without receiving the target email or user ID');

select pg_temp.assume_user(current_setting('moseek.test.email_target')::uuid);
select pg_temp.assert((select count(*)=1 from public.list_my_environment_invitations()),
  'Only the addressed existing user sees the email invitation in their inbox');
select public.respond_to_environment_invitation(:'owner_admin_invite'::uuid,true) as invite_accept \gset
select pg_temp.assert(:'invite_accept'='accepted' and exists (select 1 from public.environment_members
  where environment_id=current_setting('moseek.test.environment')::uuid
  and user_id=current_setting('moseek.test.email_target')::uuid and role='admin'),
  'Invitee accepts an Owner-issued Admin invitation and receives the assigned role');

select pg_temp.assume_user(current_setting('moseek.test.admin')::uuid);
select public.create_environment_invitation(current_setting('moseek.test.environment')::uuid,'@moseek_handle','viewer');
select public.create_environment_invitation(current_setting('moseek.test.environment')::uuid,'@moseek_handle','viewer');
select pg_temp.assert((select count(*)=1 from public.list_environment_invitations(current_setting('moseek.test.environment')::uuid)),
  'Admin can invite by username and duplicate pending invitations are prevented');
select invitation_id as username_invite from public.list_environment_invitations(current_setting('moseek.test.environment')::uuid) \gset
do $$ begin
  begin perform public.create_environment_invitation(current_setting('moseek.test.environment')::uuid,'@moseek_handle','admin');
    raise exception 'ASSERT FAILED: Admin invited another Admin';
  exception when insufficient_privilege then raise notice 'PASS: Admin cannot invite an Admin'; end;
end $$;
select pg_temp.assume_user(current_setting('moseek.test.username_target')::uuid);
select public.respond_to_environment_invitation(:'username_invite'::uuid,true) as username_accept \gset
select pg_temp.assert(:'username_accept'='accepted' and exists (select 1 from public.environment_members
  where environment_id=current_setting('moseek.test.environment')::uuid and user_id=auth.uid() and role='viewer'),
  'An existing user can accept an invitation addressed by username');

select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select public.create_environment_invitation(current_setting('moseek.test.environment')::uuid,
  'reject-target-'||current_setting('moseek.test.reject_target')||'@example.invalid','viewer');
select invitation_id as reject_invite from public.list_environment_invitations(current_setting('moseek.test.environment')::uuid) \gset
select pg_temp.assume_user(current_setting('moseek.test.reject_target')::uuid);
select pg_temp.assert(public.respond_to_environment_invitation(:'reject_invite'::uuid,false)='declined',
  'Invitee can reject an email invitation');
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select public.create_environment_invitation(current_setting('moseek.test.environment')::uuid,
  'revoke-target-'||current_setting('moseek.test.revoke_target')||'@example.invalid','editor');
select invitation_id as revoke_invite from public.list_environment_invitations(current_setting('moseek.test.environment')::uuid) \gset
select pg_temp.assert(public.revoke_environment_invitation(:'revoke_invite'::uuid)='revoked',
  'Owner can revoke a pending invitation');
select pg_temp.assume_user(current_setting('moseek.test.revoke_target')::uuid);
select pg_temp.assert(public.respond_to_environment_invitation(:'revoke_invite'::uuid,true)='unavailable',
  'Revoked invitation cannot be accepted');

select pg_temp.assume_user(current_setting('moseek.test.editor')::uuid);
do $$ begin
  begin perform public.create_environment_invitation(current_setting('moseek.test.environment')::uuid,'nobody@example.invalid','viewer');
    raise exception 'ASSERT FAILED: Editor created invitation';
  exception when insufficient_privilege then raise notice 'PASS: Editor cannot create invitations'; end;
end $$;
select pg_temp.assume_user(current_setting('moseek.test.viewer')::uuid);
do $$ begin
  begin perform public.create_environment_invitation(current_setting('moseek.test.environment')::uuid,'nobody@example.invalid','viewer');
    raise exception 'ASSERT FAILED: Viewer created invitation';
  exception when insufficient_privilege then raise notice 'PASS: Viewer cannot create invitations'; end;
end $$;
select pg_temp.assume_user(current_setting('moseek.test.reject_target')::uuid);
do $$ begin
  begin perform public.create_environment_invitation(current_setting('moseek.test.environment')::uuid,'nobody@example.invalid','viewer');
    raise exception 'ASSERT FAILED: outsider created invitation';
  exception when insufficient_privilege then raise notice 'PASS: outsider cannot create invitations'; end;
end $$;

select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select invitation_code_id as approval_code_id, invitation_code as approval_code
  from public.create_environment_invitation_code(current_setting('moseek.test.environment')::uuid,'editor') \gset
select pg_temp.assert(length(:'approval_code')=7 and :'approval_code' ~ '^[A-HJ-NP-Z2-9]{7}$'
  and :'approval_code' ~ '[A-Z]' and :'approval_code' ~ '[2-9]',
  'New invitation code is seven unambiguous uppercase letters and digits with both types present');
select pg_temp.assert((select approval_required and role='editor' from public.list_environment_invitation_codes(current_setting('moseek.test.environment')::uuid)
  where code_id=:'approval_code_id'::uuid), 'New code defaults to approval required and grants only its selected Editor role');
do $$ begin
  begin perform * from public.create_environment_invitation_code(current_setting('moseek.test.environment')::uuid,'admin');
    raise exception 'ASSERT FAILED: invitation code granted Admin';
  exception when insufficient_privilege then raise notice 'PASS: invitation codes cannot grant Admin'; end;
end $$;
create temporary table generated_code_sample(code text primary key) on commit drop;
do $$
declare generated text;
begin
  for i in 1..50 loop
    select invitation_code into generated from public.create_environment_invitation_code(
      current_setting('moseek.test.environment')::uuid,'editor');
    insert into generated_code_sample values(generated);
  end loop;
end $$;
select pg_temp.assert((select count(*)=50 and bool_and(code ~ '^[A-HJ-NP-Z2-9]{7}$'
  and code ~ '[A-Z]' and code ~ '[2-9]') from generated_code_sample),
  'Repeated secure generation produces unique codes with the required seven-character format');
reset role;
select pg_temp.assert((select code_hash=extensions.digest(convert_to(:'approval_code','UTF8'),'sha256')
  from public.environment_invitation_codes where id=:'approval_code_id'::uuid),
  'Invitation code is stored only as a SHA-256 hash');
set local role authenticated;
select pg_temp.assume_user(current_setting('moseek.test.code_target')::uuid);
select pg_temp.assert(public.redeem_environment_invitation_code(:'approval_code')='approval_pending',
  'Valid code creates a pending join request when approval is required');
select pg_temp.assert(public.redeem_environment_invitation_code(:'approval_code')='approval_pending'
  and (select count(*)=1 from public.environment_join_requests where environment_id=current_setting('moseek.test.environment')::uuid
    and user_id=auth.uid() and status='pending'),
  'Duplicate code redemption does not create a second pending request');
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select request_id as approval_request_id from public.list_environment_join_requests(current_setting('moseek.test.environment')::uuid) \gset
select public.respond_to_environment_join_request(:'approval_request_id'::uuid,true) as approval_result \gset
\echo Join request response: :approval_result
select pg_temp.assert(:'approval_result'='accepted' and exists (select 1 from public.environment_members where environment_id=current_setting('moseek.test.environment')::uuid
    and user_id=current_setting('moseek.test.code_target')::uuid and role='editor'),
  'Owner approves a code request and the requester joins as Editor');

select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select invitation_code as admin_approval_code from public.create_environment_invitation_code(
  current_setting('moseek.test.environment')::uuid,'editor') \gset
select pg_temp.assume_user(current_setting('moseek.test.reject_target')::uuid);
select pg_temp.assert(public.redeem_environment_invitation_code(lower(:'admin_approval_code'))='approval_pending',
  'Redemption consistently normalizes lowercase input');
select pg_temp.assume_user(current_setting('moseek.test.admin')::uuid);
select request_id as admin_approval_request from public.list_environment_join_requests(
  current_setting('moseek.test.environment')::uuid) \gset
select public.respond_to_environment_join_request(:'admin_approval_request'::uuid,true) as admin_approval_result \gset
select pg_temp.assert(:'admin_approval_result'='accepted'
  and exists(select 1 from public.environment_members where environment_id=current_setting('moseek.test.environment')::uuid
    and user_id=current_setting('moseek.test.reject_target')::uuid and role='editor'),
  'Authorized Admin approves a request and grants Editor membership');

select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select invitation_code as restricted_approval_code from public.create_environment_invitation_code(
  current_setting('moseek.test.environment')::uuid,'editor') \gset
select pg_temp.assume_user(current_setting('moseek.test.expired_code_target')::uuid);
select public.redeem_environment_invitation_code(:'restricted_approval_code');
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select request_id as restricted_approval_request from public.list_environment_join_requests(
  current_setting('moseek.test.environment')::uuid) \gset
select set_config('moseek.test.restricted_request', :'restricted_approval_request', true);
select pg_temp.assume_user(current_setting('moseek.test.viewer')::uuid);
do $$ begin
  begin perform public.respond_to_environment_join_request(current_setting('moseek.test.restricted_request')::uuid,true);
    raise exception 'ASSERT FAILED: Viewer approved a code request';
  exception when insufficient_privilege then raise notice 'PASS: Viewer cannot approve a code request'; end;
end $$;
select pg_temp.assume_user(current_setting('moseek.test.outsider')::uuid);
do $$ begin
  begin perform public.respond_to_environment_join_request(current_setting('moseek.test.restricted_request')::uuid,true);
    raise exception 'ASSERT FAILED: outsider approved a code request';
  exception when insufficient_privilege then raise notice 'PASS: outsider cannot approve a code request'; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$ begin
  begin perform public.respond_to_environment_join_request(current_setting('moseek.test.restricted_request')::uuid,true);
    raise exception 'ASSERT FAILED: unauthenticated caller approved a code request';
  exception when insufficient_privilege then raise notice 'PASS: request approval rejects missing authenticated identity'; end;
end $$;
select pg_temp.assert(not exists(select 1 from public.environment_members where environment_id=current_setting('moseek.test.environment')::uuid
  and user_id=current_setting('moseek.test.expired_code_target')::uuid),
  'Unauthorized approval attempts create no membership');
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select public.respond_to_environment_join_request(:'restricted_approval_request'::uuid,false);

select invitation_code_id as direct_code_id, invitation_code as direct_code
  from public.create_environment_invitation_code(current_setting('moseek.test.environment')::uuid,'editor',false) \gset
select pg_temp.assume_user(current_setting('moseek.test.direct_code_target')::uuid);
select public.redeem_environment_invitation_code(:'direct_code') as direct_code_result \gset
select pg_temp.assert(:'direct_code_result'='approval_pending'
  and not exists (select 1 from public.environment_members where environment_id=current_setting('moseek.test.environment')::uuid
    and user_id=auth.uid()),
  'Passing approval_required=false cannot bypass approval or create membership');
select pg_temp.assert(public.redeem_environment_invitation_code(:'direct_code')='approval_pending'
  and (select count(*)=1 from public.environment_join_requests where environment_id=current_setting('moseek.test.environment')::uuid
    and user_id=auth.uid() and status='pending'),
  'Repeated code redemption keeps one Pending request and no membership');
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select request_id as direct_approval_request from public.list_environment_join_requests(current_setting('moseek.test.environment')::uuid) \gset
select public.respond_to_environment_join_request(:'direct_approval_request'::uuid,true) as direct_approval_result \gset
select pg_temp.assert(:'direct_approval_result'='accepted' and exists (select 1 from public.environment_members
  where environment_id=current_setting('moseek.test.environment')::uuid
    and user_id=current_setting('moseek.test.direct_code_target')::uuid and role='editor'),
  'Authorized Owner approval grants the intended Editor membership');

-- Simulate a pre-migration 64-character code whose plaintext was only ever
-- held by its recipient; legacy codes remain valid but now require approval.
reset role;
insert into public.environment_invitation_codes(environment_id,code_hash,role,approval_required,created_by,created_by_role,expires_at,is_default)
values(current_setting('moseek.test.environment')::uuid,extensions.digest(convert_to(repeat('a',64),'UTF8'),'sha256'),
  'viewer',false,current_setting('moseek.test.owner')::uuid,'owner',now()+interval '7 days',false);
set local role authenticated;
select pg_temp.assume_user(current_setting('moseek.test.legacy_target')::uuid);
select pg_temp.assert(public.redeem_environment_invitation_code(repeat('A',64))='approval_pending'
  and not exists(select 1 from public.environment_members where environment_id=current_setting('moseek.test.environment')::uuid and user_id=auth.uid()),
  'Legacy 64-character code stays valid but cannot join before approval');
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select request_id as legacy_approval_request from public.list_environment_join_requests(current_setting('moseek.test.environment')::uuid) \gset
select public.respond_to_environment_join_request(:'legacy_approval_request'::uuid,true) as legacy_approval_result \gset
\echo Legacy request response: :legacy_approval_result
select pg_temp.assert(:'legacy_approval_result'='accepted'
  and exists(select 1 from public.environment_members where environment_id=current_setting('moseek.test.environment')::uuid
    and user_id=current_setting('moseek.test.legacy_target')::uuid and role='viewer'),
  'Approved legacy code retains its original Viewer role');
select pg_temp.assume_user(current_setting('moseek.test.outsider')::uuid);
select pg_temp.assert(public.redeem_environment_invitation_code('AAAAAAA')='invalid'
  and public.redeem_environment_invitation_code('2222222')='invalid'
  and public.redeem_environment_invitation_code('O7AAAAA')='invalid',
  'Invalid, digit-free, letter-free, and ambiguous seven-character values are rejected');

select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select invitation_code_id as expired_code_id, invitation_code as expired_code
  from public.create_environment_invitation_code(current_setting('moseek.test.environment')::uuid,'editor',false) \gset
reset role;
update public.environment_invitation_codes set expires_at=now()-interval '1 second' where id=:'expired_code_id'::uuid;
set local role authenticated;
select pg_temp.assume_user(current_setting('moseek.test.expired_code_target')::uuid);
select pg_temp.assert(public.redeem_environment_invitation_code(:'expired_code')='invalid',
  'Expired invitation code cannot be redeemed');
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select invitation_code_id as revoked_code_id, invitation_code as revoked_code
  from public.create_environment_invitation_code(current_setting('moseek.test.environment')::uuid,'editor',false) \gset
select pg_temp.assert(public.revoke_environment_invitation_code(:'revoked_code_id'::uuid)='revoked',
  'Owner can revoke an active code');
select pg_temp.assume_user(current_setting('moseek.test.revoked_code_target')::uuid);
select pg_temp.assert(public.redeem_environment_invitation_code(:'revoked_code')='invalid',
  'Revoked invitation code cannot be redeemed');
select pg_temp.assume_user(current_setting('moseek.test.brute_target')::uuid);
select pg_temp.assert(public.redeem_environment_invitation_code('invalid')='invalid'
  and public.redeem_environment_invitation_code('invalid')='invalid'
  and public.redeem_environment_invitation_code('invalid')='invalid'
  and public.redeem_environment_invitation_code('invalid')='invalid'
  and public.redeem_environment_invitation_code('invalid')='invalid'
  and public.redeem_environment_invitation_code('invalid')='rate_limited',
  'Invitation code redemption is limited to five attempts per user per 15 minutes');

-- Pending invitations and unresolved join requests block Shared -> Personal.
-- Active codes are revoked atomically once those blockers are resolved.
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
select public.create_environment_invitation(current_setting('moseek.test.gate_environment')::uuid,
  'gate-target-'||current_setting('moseek.test.gate_target')||'@example.invalid','viewer');
do $$ begin
  begin perform * from public.convert_environment_type(current_setting('moseek.test.gate_environment')::uuid,'personal');
    raise exception 'ASSERT FAILED: pending email invitation did not block conversion';
  exception when check_violation then raise notice 'PASS: pending invitation blocks Shared to Personal'; end;
end $$;
select invitation_id as gate_invitation from public.list_environment_invitations(current_setting('moseek.test.gate_environment')::uuid) \gset
select public.revoke_environment_invitation(:'gate_invitation'::uuid);
select invitation_code_id as gate_code_id, invitation_code as gate_code
  from public.create_environment_invitation_code(current_setting('moseek.test.gate_environment')::uuid,'editor') \gset
select pg_temp.assume_user(current_setting('moseek.test.gate_target')::uuid);
select pg_temp.assert(public.redeem_environment_invitation_code(:'gate_code')='approval_pending',
  'Approval-required code creates a join request for conversion-gate coverage');
select pg_temp.assume_user(current_setting('moseek.test.owner')::uuid);
do $$ begin
  begin perform * from public.convert_environment_type(current_setting('moseek.test.gate_environment')::uuid,'personal');
    raise exception 'ASSERT FAILED: unresolved request did not block conversion';
  exception when check_violation then raise notice 'PASS: unresolved join request blocks Shared to Personal'; end;
end $$;
select request_id as gate_request from public.list_environment_join_requests(current_setting('moseek.test.gate_environment')::uuid) \gset
select public.respond_to_environment_join_request(:'gate_request'::uuid,false);
select pg_temp.assert((select type='personal' from public.convert_environment_type(current_setting('moseek.test.gate_environment')::uuid,'personal')),
  'Owner converts to Personal after pending invitations and join requests are explicitly resolved');

reset role;
select pg_temp.assert((select count(*)=0 from public.environment_invitation_codes
  where environment_id=current_setting('moseek.test.gate_environment')::uuid and revoked_at is null),
  'Personal conversion automatically revokes all previously active invitation codes');
rollback;
