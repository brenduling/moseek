\set ON_ERROR_STOP on

-- Local-only Phase 3D.2 RLS and constraint regression suite.
-- Run through scripts/run-color-rls-local.ps1. Every database change is
-- inside one transaction that is explicitly rolled back at the end.

BEGIN;
SET LOCAL client_min_messages = notice;

SELECT gen_random_uuid() AS user_a \gset
SELECT gen_random_uuid() AS user_b \gset
SELECT gen_random_uuid() AS user_c \gset

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
) VALUES
  (:'user_a'::uuid, 'authenticated', 'authenticated',
   'moseek-color-regression-' || :'user_a' || '@example.invalid', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'user_b'::uuid, 'authenticated', 'authenticated',
   'moseek-color-regression-' || :'user_b' || '@example.invalid', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), false, false),
  (:'user_c'::uuid, 'authenticated', 'authenticated',
   'moseek-color-regression-' || :'user_c' || '@example.invalid', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now(), false, false);

SELECT set_config('moseek.test.user_a', :'user_a', true);
SELECT set_config('moseek.test.user_b', :'user_b', true);
SELECT set_config('moseek.test.user_c', :'user_c', true);

-- Exercise Environment creation as User A through the authenticated role.
SELECT set_config('request.jwt.claim.sub', current_setting('moseek.test.user_a'), true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('moseek.test.user_a'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF auth.uid() <> current_setting('moseek.test.user_a')::uuid THEN
    RAISE EXCEPTION 'ASSERT FAILED: authenticated User A identity was not applied';
  END IF;
  RAISE NOTICE 'PASS: distinct authenticated User A identity';
END;
$$;

SELECT gen_random_uuid() AS shared_environment \gset
SELECT set_config('moseek.test.environment', :'shared_environment', true);
-- Match src/pages/Home.jsx: plain insert, with no RETURNING representation.
INSERT INTO public.environments (id, name, type, created_by)
VALUES (:'shared_environment'::uuid, 'Phase 3D.2 color regression fixture', 'shared', auth.uid());

DO $$
BEGIN
  IF (SELECT count(*) FROM public.environments
      WHERE id = current_setting('moseek.test.environment')::uuid) <> 1
     OR (SELECT count(*) FROM public.environment_members
         WHERE environment_id = current_setting('moseek.test.environment')::uuid
           AND user_id = auth.uid() AND role = 'owner') <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAILED: owner membership or Environment visibility missing after plain INSERT';
  END IF;
  RAISE NOTICE 'PASS: plain authenticated Environment INSERT creates visible Environment and owner membership';
END;
$$;

RESET ROLE;

-- User B is an Editor; User C remains an outsider.
INSERT INTO public.environment_members (environment_id, user_id, role)
VALUES (current_setting('moseek.test.environment')::uuid,
        current_setting('moseek.test.user_b')::uuid, 'editor');

-- Build isolated Section and Resource fixtures. The file row has no Storage
-- object; this suite never creates or touches Storage objects.
INSERT INTO public.sections (id, environment_id, title, width, height, created_by)
VALUES (gen_random_uuid(), current_setting('moseek.test.environment')::uuid,
        'Phase 3D.2 color regression section', 400, 300,
        current_setting('moseek.test.user_a')::uuid)
RETURNING id AS test_section \gset
SELECT set_config('moseek.test.section', :'test_section', true);

INSERT INTO public.resources (id, environment_id, created_by, type, title, body)
VALUES (gen_random_uuid(), current_setting('moseek.test.environment')::uuid,
        current_setting('moseek.test.user_a')::uuid, 'note',
        'Phase 3D.2 color regression note', 'Temporary regression fixture')
RETURNING id AS test_note \gset
SELECT set_config('moseek.test.note', :'test_note', true);

INSERT INTO public.resources (id, environment_id, created_by, type, title, url)
VALUES (gen_random_uuid(), current_setting('moseek.test.environment')::uuid,
        current_setting('moseek.test.user_a')::uuid, 'link',
        'Phase 3D.2 color regression link', 'https://example.invalid/test')
RETURNING id AS test_link \gset
SELECT set_config('moseek.test.link', :'test_link', true);

-- The File Resource key matches its Resource ID. No Storage object is needed.
SELECT gen_random_uuid() AS test_file \gset
INSERT INTO public.resources (
  id, environment_id, created_by, type, title, original_filename,
  mime_type, file_size, storage_path
) VALUES (
  :'test_file'::uuid, current_setting('moseek.test.environment')::uuid,
  current_setting('moseek.test.user_a')::uuid, 'file',
  'Phase 3D.2 color regression file', 'regression.txt', 'text/plain', 1,
  current_setting('moseek.test.environment') || '/' || :'test_file' || '/regression.txt'
);
SELECT set_config('moseek.test.file', :'test_file', true);

-- User A can create, read, and update a personal Environment color.
SELECT set_config('request.jwt.claim.sub', current_setting('moseek.test.user_a'), true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('moseek.test.user_a'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

INSERT INTO public.environment_color_preferences (user_id, environment_id, card_color)
VALUES (auth.uid(), current_setting('moseek.test.environment')::uuid, 'sage');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.environment_color_preferences
      WHERE user_id = auth.uid()
        AND environment_id = current_setting('moseek.test.environment')::uuid
        AND card_color = 'sage') <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAILED: User A could not read their inserted preference';
  END IF;
  RAISE NOTICE 'PASS: User A inserts and reads own Environment color preference';
END;
$$;

UPDATE public.environment_color_preferences
SET card_color = 'mist'
WHERE user_id = auth.uid()
  AND environment_id = current_setting('moseek.test.environment')::uuid;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.environment_color_preferences
      WHERE user_id = auth.uid()
        AND environment_id = current_setting('moseek.test.environment')::uuid
        AND card_color = 'mist') <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAILED: User A could not update own preference';
  END IF;
  RAISE NOTICE 'PASS: User A updates own Environment color preference';
END;
$$;

-- Unrecognized personal colors must be rejected by the database constraint.
DO $$
BEGIN
  BEGIN
    UPDATE public.environment_color_preferences
    SET card_color = 'ultraviolet'
    WHERE user_id = auth.uid()
      AND environment_id = current_setting('moseek.test.environment')::uuid;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invalid personal color rejected';
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERT FAILED: invalid personal color was accepted';
END;
$$;

RESET ROLE;

-- User B gets a personal preference while a member of the Environment.
SELECT set_config('request.jwt.claim.sub', current_setting('moseek.test.user_b'), true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('moseek.test.user_b'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

INSERT INTO public.environment_color_preferences (user_id, environment_id, card_color)
VALUES (auth.uid(), current_setting('moseek.test.environment')::uuid, 'sand');

DO $$
DECLARE
  changed_rows bigint;
BEGIN
  IF (SELECT count(*) FROM public.environment_color_preferences
      WHERE user_id = current_setting('moseek.test.user_a')::uuid
        AND environment_id = current_setting('moseek.test.environment')::uuid) <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: User B read User A personal preference';
  END IF;
  UPDATE public.environment_color_preferences
  SET card_color = 'clay'
  WHERE user_id = current_setting('moseek.test.user_a')::uuid
    AND environment_id = current_setting('moseek.test.environment')::uuid;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: User B updated User A personal preference';
  END IF;
  RAISE NOTICE 'PASS: User B cannot read or update User A personal preference';

  UPDATE public.environment_color_preferences
  SET card_color = 'mist'
  WHERE user_id = auth.uid()
    AND environment_id = current_setting('moseek.test.environment')::uuid;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAILED: User B could not update own preference';
  END IF;
  RAISE NOTICE 'PASS: User B can update own personal preference';
END;
$$;

-- The foreign key ties personal preferences to membership. A User C insert
-- for their own account reaches the FK but cannot pass it as a nonmember.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('moseek.test.user_c'), true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('moseek.test.user_c'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.environment_color_preferences (user_id, environment_id, card_color)
    VALUES (auth.uid(), current_setting('moseek.test.environment')::uuid, 'sage');
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: nonmember cannot create an Environment color preference';
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERT FAILED: nonmember created an Environment color preference';
END;
$$;

-- A member can update shared Section and Note colors.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('moseek.test.user_b'), true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('moseek.test.user_b'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

UPDATE public.sections SET card_color = 'sage'
WHERE id = current_setting('moseek.test.section')::uuid;
UPDATE public.resources SET card_color = 'clay'
WHERE id = current_setting('moseek.test.note')::uuid AND type = 'note';

DO $$
BEGIN
  IF (SELECT card_color FROM public.sections
      WHERE id = current_setting('moseek.test.section')::uuid) <> 'sage' THEN
    RAISE EXCEPTION 'ASSERT FAILED: authorized member could not update shared Section color';
  END IF;
  IF (SELECT card_color FROM public.resources
      WHERE id = current_setting('moseek.test.note')::uuid) <> 'clay' THEN
    RAISE EXCEPTION 'ASSERT FAILED: authorized member could not update shared Note color';
  END IF;
  RAISE NOTICE 'PASS: Environment member updates shared Section and Note colors';
END;
$$;

-- Link and File Resource colors must remain neutral.
DO $$
BEGIN
  BEGIN
    UPDATE public.resources SET card_color = 'sage'
    WHERE id = current_setting('moseek.test.link')::uuid;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: Link Resource rejects non-neutral color';
    BEGIN
      UPDATE public.resources SET card_color = 'mist'
      WHERE id = current_setting('moseek.test.file')::uuid;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'PASS: File Resource rejects non-neutral color';
      RETURN;
    END;
    RAISE EXCEPTION 'ASSERT FAILED: File Resource accepted non-neutral color';
  END;
  RAISE EXCEPTION 'ASSERT FAILED: Link Resource accepted non-neutral color';
END;
$$;

-- Shared color checks also reject palette values outside the allowlist.
DO $$
BEGIN
  BEGIN
    UPDATE public.sections SET card_color = 'ultraviolet'
    WHERE id = current_setting('moseek.test.section')::uuid;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invalid shared Section color rejected';
    BEGIN
      UPDATE public.resources SET card_color = 'ultraviolet'
      WHERE id = current_setting('moseek.test.note')::uuid;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'PASS: invalid shared Note color rejected';
      RETURN;
    END;
    RAISE EXCEPTION 'ASSERT FAILED: invalid shared Note color was accepted';
  END;
  RAISE EXCEPTION 'ASSERT FAILED: invalid shared Section color was accepted';
END;
$$;

-- Ownership fields are not update-granted to authenticated users.
DO $$
BEGIN
  BEGIN
    UPDATE public.environment_color_preferences
    SET user_id = current_setting('moseek.test.user_a')::uuid
    WHERE user_id = auth.uid()
      AND environment_id = current_setting('moseek.test.environment')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: authenticated user cannot change preference user_id';
    BEGIN
      UPDATE public.environment_color_preferences
      SET environment_id = gen_random_uuid()
      WHERE user_id = auth.uid()
        AND environment_id = current_setting('moseek.test.environment')::uuid;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: authenticated user cannot change preference environment_id';
      RETURN;
    END;
    RAISE EXCEPTION 'ASSERT FAILED: authenticated user changed preference environment_id';
  END;
  RAISE EXCEPTION 'ASSERT FAILED: authenticated user changed preference user_id';
END;
$$;

-- The legacy Environment role policy remains stricter than shared content:
-- a member can edit shared colors, but only owner/admin can rename an Environment.
DO $$
DECLARE
  changed_rows bigint;
BEGIN
  UPDATE public.environments SET name = 'Unauthorized member rename'
  WHERE id = current_setting('moseek.test.environment')::uuid;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: regular member renamed an Environment';
  END IF;
  RAISE NOTICE 'PASS: regular member cannot update Environment';
END;
$$;

RESET ROLE;

-- User A, as owner, can update the Environment.
SELECT set_config('request.jwt.claim.sub', current_setting('moseek.test.user_a'), true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('moseek.test.user_a'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;
UPDATE public.environments SET name = 'Phase 3D.2 color regression owner update'
WHERE id = current_setting('moseek.test.environment')::uuid;

DO $$
BEGIN
  IF (SELECT name FROM public.environments
      WHERE id = current_setting('moseek.test.environment')::uuid)
      <> 'Phase 3D.2 color regression owner update' THEN
    RAISE EXCEPTION 'ASSERT FAILED: Environment owner could not update Environment';
  END IF;
  RAISE NOTICE 'PASS: Environment owner retains Environment update access';
END;
$$;

RESET ROLE;

-- User C is not a member: Environment, Section, and Resources remain hidden;
-- updates/deletes affect no rows and content inserts are rejected.
SELECT set_config('request.jwt.claim.sub', current_setting('moseek.test.user_c'), true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('moseek.test.user_c'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  affected bigint;
BEGIN
  IF (SELECT count(*) FROM public.environments
      WHERE id = current_setting('moseek.test.environment')::uuid) <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: outsider read Environment';
  END IF;
  IF (SELECT count(*) FROM public.sections
      WHERE id = current_setting('moseek.test.section')::uuid) <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: outsider read Section';
  END IF;
  IF (SELECT count(*) FROM public.resources
      WHERE id IN (current_setting('moseek.test.note')::uuid,
                   current_setting('moseek.test.link')::uuid,
                   current_setting('moseek.test.file')::uuid)) <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: outsider read Resources';
  END IF;
  RAISE NOTICE 'PASS: outsider cannot read Environment, Section, or Resources';

  UPDATE public.sections SET title = 'Outsider change'
  WHERE id = current_setting('moseek.test.section')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: outsider updated Section'; END IF;
  UPDATE public.resources SET title = 'Outsider change'
  WHERE id = current_setting('moseek.test.note')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: outsider updated Resource'; END IF;
  UPDATE public.environments SET name = 'Outsider change'
  WHERE id = current_setting('moseek.test.environment')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: outsider updated Environment'; END IF;
  RAISE NOTICE 'PASS: outsider cannot update Environment, Section, or Resource';

  UPDATE public.sections SET card_color = 'mist'
  WHERE id = current_setting('moseek.test.section')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: outsider updated shared Section color'; END IF;
  UPDATE public.resources SET card_color = 'sage'
  WHERE id = current_setting('moseek.test.note')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: outsider updated shared Note color'; END IF;
  RAISE NOTICE 'PASS: outsider cannot update shared Section or Note colors';

  DELETE FROM public.sections WHERE id = current_setting('moseek.test.section')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: outsider deleted Section'; END IF;
  DELETE FROM public.resources WHERE id = current_setting('moseek.test.note')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: outsider deleted Resource'; END IF;
  DELETE FROM public.environments WHERE id = current_setting('moseek.test.environment')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: outsider deleted Environment'; END IF;
  RAISE NOTICE 'PASS: outsider cannot delete Environment, Section, or Resource';
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.sections (environment_id, title, width, height, created_by)
    VALUES (current_setting('moseek.test.environment')::uuid,
            'Outsider Section', 100, 100, auth.uid());
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: outsider cannot insert Section into Environment';
    BEGIN
      INSERT INTO public.resources (environment_id, created_by, type, title, body)
      VALUES (current_setting('moseek.test.environment')::uuid,
              auth.uid(), 'note', 'Outsider Resource', 'Denied');
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: outsider cannot insert Resource into Environment';
      BEGIN
        INSERT INTO public.environments (name, type, created_by)
        VALUES ('Outsider spoofed Environment', 'shared',
                current_setting('moseek.test.user_a')::uuid);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS: Environment insert cannot spoof another owner';
        RETURN;
      END;
      RAISE EXCEPTION 'ASSERT FAILED: outsider spoofed another Environment owner';
    END;
    RAISE EXCEPTION 'ASSERT FAILED: outsider inserted Resource into Environment';
  END;
  RAISE EXCEPTION 'ASSERT FAILED: outsider inserted Section into Environment';
END;
$$;

RESET ROLE;

-- Revoking User B's membership cascades their personal preference.
DELETE FROM public.environment_members
WHERE environment_id = current_setting('moseek.test.environment')::uuid
  AND user_id = current_setting('moseek.test.user_b')::uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.environment_color_preferences
    WHERE user_id = current_setting('moseek.test.user_b')::uuid
      AND environment_id = current_setting('moseek.test.environment')::uuid
  ) THEN
    RAISE EXCEPTION 'ASSERT FAILED: membership removal did not cascade personal preference';
  END IF;
  RAISE NOTICE 'PASS: membership removal cascades associated personal preference';
END;
$$;

ROLLBACK;

SELECT NOT EXISTS (
  SELECT 1 FROM auth.users
  WHERE id IN (:'user_a'::uuid, :'user_b'::uuid, :'user_c'::uuid)
) AND NOT EXISTS (
  SELECT 1 FROM public.environments
  WHERE id = :'shared_environment'::uuid
) AS test_cleanup_ok \gset
\if :test_cleanup_ok
  \echo PASS: all synthetic database fixtures cleaned by transaction rollback
\else
  \echo FAIL: synthetic fixtures remain after rollback
  \quit 1
\endif
