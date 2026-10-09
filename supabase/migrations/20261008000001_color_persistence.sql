-- Phase 3D.2. Forward-only, additive color persistence.
-- Apply only after live catalog preflight, disposable database tests, backup,
-- and explicit production approval. The companion validation migration follows.
begin;
set local lock_timeout = '5s';

create table public.environment_color_preferences (
  user_id uuid not null,
  environment_id uuid not null,
  card_color text not null default 'neutral',
  updated_at timestamptz not null default now(),
  constraint environment_color_preferences_pkey primary key (user_id, environment_id),
  constraint environment_color_preferences_membership_fkey
    foreign key (environment_id, user_id)
    references public.environment_members (environment_id, user_id) on delete cascade,
  constraint environment_color_preferences_color_check
    check (card_color in ('neutral', 'sage', 'sand', 'clay', 'mist'))
);
create index environment_color_preferences_by_membership
  on public.environment_color_preferences (environment_id, user_id);
create trigger moseek_set_updated_at before update on public.environment_color_preferences
  for each row execute function moseek_private.set_updated_at();

alter table public.environment_color_preferences enable row level security;
revoke all on public.environment_color_preferences from public, anon, authenticated;
grant select on public.environment_color_preferences to authenticated;
grant insert (user_id, environment_id, card_color)
  on public.environment_color_preferences to authenticated;
grant update (card_color) on public.environment_color_preferences to authenticated;

create policy moseek_environment_colors_select on public.environment_color_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy moseek_environment_colors_insert on public.environment_color_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy moseek_environment_colors_update on public.environment_color_preferences
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.sections add column card_color text not null default 'neutral';
alter table public.sections add constraint moseek_sections_card_color_check
  check (card_color in ('neutral', 'sage', 'sand', 'clay', 'mist')) not valid;
grant update (card_color) on public.sections to authenticated;

alter table public.resources add column card_color text not null default 'neutral';
alter table public.resources add constraint moseek_resources_card_color_check
  check (card_color in ('neutral', 'sage', 'sand', 'clay', 'mist')
    and (type = 'note' or card_color = 'neutral')) not valid;
grant update (card_color) on public.resources to authenticated;

commit;
