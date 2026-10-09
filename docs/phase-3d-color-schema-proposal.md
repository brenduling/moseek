# Phase 3D color persistence proposal — review draft, not applied

`MOSEEK_DESIGN.md` remains the design authority: color is restrained, named, and secondary to the user's work. This proposal keeps `neutral` as the default and uses the existing Phase 3D choices: `neutral`, `sage`, `sand`, `clay`, and `mist`.

## Ownership and current state

| Item | Owner of the color | Proposed storage |
| --- | --- | --- |
| Environment card on Home | Each user separately | `public.environment_color_preferences` |
| Section | Shared with all Environment members | `public.sections.card_color` |
| Note | Shared with all Environment members | `public.resources.card_color`, only when `type = 'note'` |
| Link or File | Neutral | `resources.card_color = 'neutral'` constraint |

The checked-in foundation has no color column on Environments or Sections. Notes cannot use `resources.provider_metadata`: the Note payload check requires `{}`. Current Phase 3D code stores colors in `localStorage` under `moseek:color:v1:<user-id>:<kind>:<item-id>`. The checked-in RLS permits owner and admin to update Environments, and **owner, admin, and member to update Sections and Resources**. That existing member permission is the intended permission for shared Section and Note colors. No `environments.card_color` column or grant is proposed.

This was compared with the checked-in migration, not the live catalog. This workspace has a publishable key and test-account configuration, but no read-only database catalog connection or database inspection tool. Before approval to execute, verify the deployed columns, triggers, constraints, grants, policies, and PostgreSQL version; stop if they differ.

## Candidate schema and permissions

This SQL is a **review draft only**. It must be converted into a reviewed migration after live preflight. Do not run it from this document.

```sql
begin;
set local lock_timeout = '5s';

-- One row per user and Environment, created only after an explicit color choice.
-- The composite FK proves current membership and removes the preference when
-- membership is removed; Environment deletion cascades through memberships.
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

-- Separate validation after the short DDL transaction and row-count check:
alter table public.sections validate constraint moseek_sections_card_color_check;
alter table public.resources validate constraint moseek_resources_card_color_check;
```

The new preference table's primary key isolates a user's choice; its membership foreign key prevents orphan or non-member preferences and removes a preference when membership ends. RLS prevents a signed-in user from reading or editing another user's choice. Only `card_color` can be updated by the authenticated database role; identity and `updated_at` are not client-writable. An absent preference row means the neutral default. Selecting Neutral explicitly creates or updates a neutral row, which distinguishes a deliberate choice from an untouched default. No client `DELETE` permission is needed.

The existing Section and Resource RLS policies remain in force. Any current member may change shared colors; this is a product decision, not a new RLS exception. Link and File rows cannot receive a non-neutral color even through a direct API call. Existing records read as neutral after the additive migration; existing insert flows may omit `card_color` and receive the default. New color choices are made after creation, so no `INSERT(card_color)` grant is needed on Sections or Resources.

## Frontend work required with the migration

1. Home reads visible Environments and the signed-in user's `environment_color_preferences` rows, joins by Environment ID in memory, and treats the server row as authoritative. The Environment picker writes only that user's row. Insert a row when absent; update the existing row scoped by both keys. Do not use a generic upsert that may attempt to update key columns without permission. On a uniqueness race, re-read and offer retry.
2. The Environment loader selects `card_color` and `updated_at` for Sections and Resources. Note and Section pickers use the existing `updateCanvasRow` path, scoped by Environment ID and row ID. The Resource check keeps Link and File neutral. Keep current member editing access; no role-based hiding is required for Section and Note colors.
3. Confirm a write before showing a saved state. For concurrent edits, compare the `updated_at` value read with the row and re-read on a zero-row conditional update rather than silently replacing another device's change. This may also flag an unrelated row edit, which is safer than silent replacement.
4. Distinguish load failures from a true neutral default. Never fall back to a stale local color after a server error. Keep the existing local keys unused during initial rollout so a client rollback remains possible.
5. Extend focused tests for mapping, RLS-visible per-user rows, shared member writes, neutral defaults, invalid values, Link/File rejection, refresh and account switching, conflicts, and membership removal. Verify color contrast in Light, Dark, and System modes.

## Existing local colors

Do **not** auto-import localStorage colors. Legacy entries contain a color but no trustworthy time or record of whether a newer server choice was intentional. Show a small, optional “Review colors saved on this device” action after server data loads, or let users reselect colors through the existing picker. Review each choice against the server value. A personal Environment color affects only the current user's row; importing a Section or Note color affects everyone in that Environment and must be explicit. Re-read immediately before applying a choice and use a conditional write; if the server changed, show its latest color and ask the user to decide again. Mark a local choice reviewed only after the server confirms the user's explicit choice, and retain dormant local keys through the rollback period. Do not silently prefer local color over server color.

## Deployment and rollback

1. Read-only live preflight: compare `pg_catalog` or Dashboard schema and grants with the checked-in migration, confirm no later color columns or policy drift, check table sizes and PostgreSQL version, and take a recoverable backup. Do not use service-role credentials in the frontend.
2. Review and apply the additive database migration in a controlled window. The constant default avoids a row-by-row backfill, but DDL takes locks. Named `NOT VALID` checks allow validation separately while enforcing future writes. Abort on lock timeout or any unexpected catalog state.
3. Validate constraints; test authenticated owner, admin, member, non-member, and second-user behavior before releasing the client. Check that preference rows disappear after membership deletion and that existing Environment deletion safeguards still work.
4. Deploy the client with server-authoritative reads and writes, then verify across two devices and light/dark themes. Keep local keys available for explicit review and rollback; do not bulk-write them.
5. If the client must roll back, revert the client first and leave the additive database objects in place. Export saved colors before any later database rollback. Only after no deployed client depends on them should a separately approved rollback revoke the new grants and drop the preference table and color columns; dropping them loses saved choices.

## Remaining approval boundary

The personal-versus-shared ownership model and current member editing rights are resolved by the product direction above. Approval is still required for the actual database migration and client rollout after live-catalog verification. Operational choices to confirm during that review are the deployment window and whether to offer the optional guided review of legacy local colors immediately or in a later release. This document makes no database change.
