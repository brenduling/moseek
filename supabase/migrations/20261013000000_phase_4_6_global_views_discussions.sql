-- Phase 4.6: private Section discussions and membership-filtered Realtime.
begin;
set local lock_timeout = '5s';

create table public.section_discussions (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  section_id uuid not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (environment_id, id),
  unique (section_id),
  constraint section_discussion_section_same_environment foreign key (environment_id, section_id)
    references public.sections(environment_id, id) on delete cascade
);
create index section_discussions_by_environment on public.section_discussions(environment_id, created_at desc);

create table public.section_discussion_messages (
  id bigint generated always as identity primary key,
  environment_id uuid not null references public.environments(id) on delete cascade,
  discussion_id uuid not null,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_name text not null check (length(btrim(sender_name)) between 1 and 80),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  unique (environment_id, id),
  constraint section_discussion_message_same_environment foreign key (environment_id, discussion_id)
    references public.section_discussions(environment_id, id) on delete cascade
);
create index section_discussion_messages_recent
  on public.section_discussion_messages(discussion_id, id desc);

create table public.section_discussion_message_attempts (
  environment_id uuid not null references public.environments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  primary key (environment_id, user_id)
);

create or replace function moseek_private.prevent_personal_discussion_environment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.type is distinct from new.type and new.type = 'personal'
     and exists (select 1 from public.section_discussions d where d.environment_id = new.id) then
    raise exception 'Remove Section Discussions before making this Environment Personal.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger moseek_prevent_personal_discussions before update of type on public.environments
  for each row execute function moseek_private.prevent_personal_discussion_environment();

alter table public.section_discussions enable row level security;
alter table public.section_discussion_messages enable row level security;
alter table public.section_discussion_message_attempts enable row level security;
revoke all on public.section_discussions, public.section_discussion_messages,
  public.section_discussion_message_attempts from public, anon, authenticated;
grant select on public.section_discussions, public.section_discussion_messages to authenticated;

create policy moseek_section_discussion_member_read on public.section_discussions
  for select to authenticated using (
    exists (select 1 from public.environments e where e.id = environment_id and e.type = 'shared')
    and moseek_private.current_environment_role(environment_id) is not null
  );
create policy moseek_section_discussion_message_member_read on public.section_discussion_messages
  for select to authenticated using (
    exists (select 1 from public.environments e where e.id = environment_id and e.type = 'shared')
    and moseek_private.current_environment_role(environment_id) is not null
  );

-- Private Realtime topics are separately authorized; the message table's own
-- RLS policy also filters each postgres_changes payload by current membership.
create policy moseek_section_discussion_realtime_member_read on realtime.messages
  for select to authenticated using (
    split_part(realtime.topic(), ':', 1) = 'moseek-section-discussion'
    and split_part(realtime.topic(), ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.section_discussions d
      where d.id::text = lower(split_part(realtime.topic(), ':', 2))
        and exists (select 1 from public.environments e where e.id = d.environment_id and e.type = 'shared')
        and moseek_private.current_environment_role(d.environment_id) is not null
    )
  );

create or replace function public.create_section_discussion(p_environment_id uuid, p_section_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  environment_kind public.environment_type;
  actor_role public.environment_role;
  discussion_id uuid;
begin
  if actor is null then raise exception 'Only the Owner can add a Discussion Box.' using errcode = '42501'; end if;
  select e.type into environment_kind from public.environments e where e.id = p_environment_id for update;
  if not found then raise exception 'This Section is unavailable.' using errcode = '42501'; end if;
  select m.role into actor_role from public.environment_members m
    where m.environment_id = p_environment_id and m.user_id = actor;
  if environment_kind <> 'shared' or actor_role is distinct from 'owner' then
    raise exception 'Only the Owner of a Shared Environment can add a Discussion Box.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sections s where s.environment_id = p_environment_id and s.id = p_section_id) then
    raise exception 'This Section is unavailable.' using errcode = '42501';
  end if;
  select d.id into discussion_id from public.section_discussions d
    where d.environment_id = p_environment_id and d.section_id = p_section_id;
  if discussion_id is not null then return discussion_id; end if;
  insert into public.section_discussions(environment_id, section_id, created_by)
    values (p_environment_id, p_section_id, actor) returning id into discussion_id;
  return discussion_id;
end;
$$;

create or replace function public.remove_section_discussion(p_discussion_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_environment uuid;
  environment_kind public.environment_type;
  actor_role public.environment_role;
begin
  if actor is null then raise exception 'Only the Owner can remove a Discussion Box.' using errcode = '42501'; end if;
  select d.environment_id into target_environment from public.section_discussions d where d.id = p_discussion_id;
  if not found then return 'unavailable'; end if;
  select e.type into environment_kind from public.environments e where e.id = target_environment for update;
  select m.role into actor_role from public.environment_members m
    where m.environment_id = target_environment and m.user_id = actor;
  if environment_kind <> 'shared' or actor_role is distinct from 'owner' then
    raise exception 'Only the Owner of a Shared Environment can remove a Discussion Box.' using errcode = '42501';
  end if;
  delete from public.section_discussions where id = p_discussion_id;
  return 'removed';
end;
$$;

create or replace function public.list_section_discussion_messages(
  p_discussion_id uuid, p_before_id bigint default null, p_limit integer default 30
) returns table(message_id bigint, discussion_id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_environment uuid;
  environment_kind public.environment_type;
  actor_role public.environment_role;
  page_size integer := greatest(1, least(coalesce(p_limit, 30), 50));
begin
  if actor is null then raise exception 'Sign in to read this Discussion.' using errcode = '42501'; end if;
  select d.environment_id into target_environment from public.section_discussions d where d.id = p_discussion_id;
  if not found then return; end if;
  select e.type into environment_kind from public.environments e where e.id = target_environment;
  select m.role into actor_role from public.environment_members m
    where m.environment_id = target_environment and m.user_id = actor;
  if environment_kind <> 'shared' or actor_role is null then
    raise exception 'This Discussion is unavailable.' using errcode = '42501';
  end if;
  return query
    select page.id, page.discussion_id, page.sender_id, page.sender_name, page.body, page.created_at
    from (
      select m.id, m.discussion_id, m.sender_id, m.sender_name, m.body, m.created_at
      from public.section_discussion_messages m
      where m.environment_id = target_environment and m.discussion_id = p_discussion_id
        and (p_before_id is null or m.id < p_before_id)
      order by m.id desc limit page_size
    ) page order by page.id;
end;
$$;

create or replace function public.send_section_discussion_message(p_discussion_id uuid, p_body text)
returns table(message_id bigint, discussion_id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, status text)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_environment uuid;
  environment_kind public.environment_type;
  actor_role public.environment_role;
  attempts_now integer;
  actor_label text;
  inserted public.section_discussion_messages%rowtype;
begin
  if actor is null then raise exception 'Sign in to send a message.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Messages must contain 1 to 2,000 characters.' using errcode = '22023';
  end if;
  select d.environment_id into target_environment from public.section_discussions d where d.id = p_discussion_id;
  if not found then raise exception 'This Discussion is unavailable.' using errcode = '42501'; end if;
  perform 1 from public.environments e where e.id = target_environment for update;
  select d.environment_id into target_environment from public.section_discussions d where d.id = p_discussion_id for update;
  if not found then raise exception 'This Discussion is unavailable.' using errcode = '42501'; end if;
  select e.type into environment_kind from public.environments e where e.id = target_environment;
  select m.role into actor_role from public.environment_members m
    where m.environment_id = target_environment and m.user_id = actor;
  if environment_kind <> 'shared' or actor_role is null or actor_role not in ('owner','admin','editor') then
    raise exception 'You cannot send messages in this Discussion.' using errcode = '42501';
  end if;
  insert into public.section_discussion_message_attempts(environment_id, user_id, window_started_at, attempts)
    values (target_environment, actor, now(), 1)
  on conflict (environment_id, user_id) do update set
    window_started_at = case when section_discussion_message_attempts.window_started_at <= now() - interval '1 minute'
      then now() else section_discussion_message_attempts.window_started_at end,
    attempts = case when section_discussion_message_attempts.window_started_at <= now() - interval '1 minute'
      then 1 else section_discussion_message_attempts.attempts + 1 end
  returning attempts into attempts_now;
  if attempts_now > 30 then
    return query select null::bigint, p_discussion_id, actor, null::text, null::text, null::timestamptz, 'rate_limited'::text;
    return;
  end if;
  select coalesce(p.display_name, 'Moseek member') into actor_label from public.profiles p where p.id = actor;
  insert into public.section_discussion_messages(environment_id, discussion_id, sender_id, sender_name, body)
    values (target_environment, p_discussion_id, actor, coalesce(actor_label, 'Moseek member'), btrim(p_body))
    returning * into inserted;
  update public.section_discussions set last_message_at = inserted.created_at where id = p_discussion_id;
  return query select inserted.id, inserted.discussion_id, inserted.sender_id, inserted.sender_name,
    inserted.body, inserted.created_at, 'sent'::text;
end;
$$;

create or replace function public.delete_section_discussion_message(p_message_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_environment uuid;
  actor_role public.environment_role;
  message_row public.section_discussion_messages%rowtype;
begin
  if actor is null then raise exception 'Sign in to remove a message.' using errcode = '42501'; end if;
  select m.environment_id into target_environment from public.section_discussion_messages m where m.id = p_message_id;
  if not found then return 'unavailable'; end if;
  perform 1 from public.environments e where e.id = target_environment for update;
  select m.* into message_row from public.section_discussion_messages m where m.id = p_message_id for update;
  if not found then return 'unavailable'; end if;
  select m.role into actor_role from public.environment_members m
    where m.environment_id = target_environment and m.user_id = actor;
  if actor_role is null or (message_row.sender_id is distinct from actor and actor_role <> 'owner') then
    raise exception 'Only the message author or Environment Owner can remove this message.' using errcode = '42501';
  end if;
  delete from public.section_discussion_messages where id = p_message_id;
  update public.section_discussions d set last_message_at = (
    select max(m.created_at) from public.section_discussion_messages m where m.discussion_id = d.id
  ) where d.id = message_row.discussion_id;
  return 'removed';
end;
$$;

create or replace function moseek_private.protect_discussion_section_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.section_discussions d where d.environment_id = old.environment_id and d.section_id = old.id)
     and exists (select 1 from public.environments e where e.id = old.environment_id)
     and moseek_private.current_environment_role(old.environment_id) is distinct from 'owner' then
    raise exception 'The Environment Owner must remove this Section Discussion before deleting its Section.' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger moseek_protect_discussion_section_delete before delete on public.sections
  for each row execute function moseek_private.protect_discussion_section_delete();

create or replace function moseek_private.record_section_discussion_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); actor_label text; section_label text;
  chosen public.section_discussions%rowtype;
begin
  if actor is null then return null; end if;
  if tg_op = 'DELETE' then chosen := old; else chosen := new; end if;
  if tg_op = 'INSERT' then
    select s.title into section_label from public.sections s where s.environment_id = chosen.environment_id and s.id = chosen.section_id;
  else
    section_label := 'Section discussion';
  end if;
  select coalesce(p.display_name, 'Moseek member') into actor_label from public.profiles p where p.id = actor;
  insert into public.environment_activity(environment_id, actor_id, actor_name, action, target_type, target_id, target_label)
  values (chosen.environment_id, actor, coalesce(actor_label, 'Moseek member'),
    case when tg_op = 'INSERT' then 'section_discussion_created' else 'section_discussion_deleted' end,
    'section_discussion', chosen.id, left(coalesce(section_label, 'Section discussion'), 200));
  return null;
end;
$$;
create trigger moseek_record_section_discussion_activity after insert or delete on public.section_discussions
  for each row execute function moseek_private.record_section_discussion_activity();

alter function public.create_section_discussion(uuid,uuid) owner to postgres;
alter function public.remove_section_discussion(uuid) owner to postgres;
alter function public.list_section_discussion_messages(uuid,bigint,integer) owner to postgres;
alter function public.send_section_discussion_message(uuid,text) owner to postgres;
alter function public.delete_section_discussion_message(bigint) owner to postgres;
alter function moseek_private.protect_discussion_section_delete() owner to postgres;
alter function moseek_private.prevent_personal_discussion_environment() owner to postgres;
alter function moseek_private.record_section_discussion_activity() owner to postgres;

revoke all on function public.create_section_discussion(uuid,uuid) from public, anon;
grant execute on function public.create_section_discussion(uuid,uuid) to authenticated;
revoke all on function public.remove_section_discussion(uuid) from public, anon;
grant execute on function public.remove_section_discussion(uuid) to authenticated;
revoke all on function public.list_section_discussion_messages(uuid,bigint,integer) from public, anon;
grant execute on function public.list_section_discussion_messages(uuid,bigint,integer) to authenticated;
revoke all on function public.send_section_discussion_message(uuid,text) from public, anon;
grant execute on function public.send_section_discussion_message(uuid,text) to authenticated;
revoke all on function public.delete_section_discussion_message(bigint) from public, anon;
grant execute on function public.delete_section_discussion_message(bigint) to authenticated;
revoke all on function moseek_private.protect_discussion_section_delete() from public, anon, authenticated;
revoke all on function moseek_private.prevent_personal_discussion_environment() from public, anon, authenticated;
revoke all on function moseek_private.record_section_discussion_activity() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'section_discussion_messages') then
    execute 'alter publication supabase_realtime add table public.section_discussion_messages';
  end if;
end $$;

commit;
