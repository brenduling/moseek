\set ON_ERROR_STOP on

-- Controlled local reproduction of authenticated Environment INSERT with
-- and without RETURNING. Each case has an isolated transaction and rolls back.

\echo CASE A: authenticated INSERT without RETURNING
BEGIN;
SELECT gen_random_uuid() AS test_user \gset
SELECT gen_random_uuid() AS test_environment \gset
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
) VALUES (
  :'test_user'::uuid, 'authenticated', 'authenticated',
  'moseek-env-insert-' || :'test_user' || '@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
);
SELECT set_config('moseek.test.user', :'test_user', true);
SELECT set_config('moseek.test.environment', :'test_environment', true);
SELECT set_config('request.jwt.claim.sub', current_setting('moseek.test.user'), true);
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('moseek.test.user'), 'role', 'authenticated'
)::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF auth.uid() <> current_setting('moseek.test.user')::uuid THEN
    RAISE EXCEPTION 'CASE A JWT identity mismatch';
  END IF;
END;
$$;
INSERT INTO public.environments (id, name, type, created_by)
VALUES (current_setting('moseek.test.environment')::uuid,
        'Case A no-return fixture', 'shared', auth.uid());
DO $$
DECLARE
  environment_rows bigint;
  membership_rows bigint;
BEGIN
  SELECT count(*) INTO environment_rows FROM public.environments
  WHERE id = current_setting('moseek.test.environment')::uuid;
  SELECT count(*) INTO membership_rows FROM public.environment_members
  WHERE environment_id = current_setting('moseek.test.environment')::uuid
    AND user_id = auth.uid() AND role = 'owner';
  RAISE NOTICE 'CASE A SQLSTATE=00000 ERROR=none INSERT succeeded';
  RAISE NOTICE 'CASE A authenticated SELECT=% owner membership=%', environment_rows, membership_rows;
  IF environment_rows <> 1 OR membership_rows <> 1 THEN
    RAISE EXCEPTION 'CASE A follow-up visibility or owner membership assertion failed';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

\echo CASE B: authenticated INSERT with RETURNING id
BEGIN;
SELECT gen_random_uuid() AS test_user \gset
SELECT gen_random_uuid() AS test_environment \gset
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
) VALUES (
  :'test_user'::uuid, 'authenticated', 'authenticated',
  'moseek-env-returning-' || :'test_user' || '@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
);
SELECT set_config('moseek.test.user', :'test_user', true);
SELECT set_config('moseek.test.environment', :'test_environment', true);
SELECT set_config('request.jwt.claim.sub', current_setting('moseek.test.user'), true);
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('moseek.test.user'), 'role', 'authenticated'
)::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  returned_id uuid;
  error_state text;
  error_message text;
  environment_rows bigint;
  membership_rows bigint;
BEGIN
  IF auth.uid() <> current_setting('moseek.test.user')::uuid THEN
    RAISE EXCEPTION 'CASE B JWT identity mismatch';
  END IF;
  BEGIN
    INSERT INTO public.environments (id, name, type, created_by)
    VALUES (current_setting('moseek.test.environment')::uuid,
            'Case B returning fixture', 'shared', auth.uid())
    RETURNING id INTO returned_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      error_state = RETURNED_SQLSTATE,
      error_message = MESSAGE_TEXT;
  END;
  SELECT count(*) INTO environment_rows FROM public.environments
  WHERE id = current_setting('moseek.test.environment')::uuid;
  SELECT count(*) INTO membership_rows FROM public.environment_members
  WHERE environment_id = current_setting('moseek.test.environment')::uuid
    AND user_id = auth.uid() AND role = 'owner';
  IF error_state IS NULL THEN
    RAISE NOTICE 'CASE B SQLSTATE=00000 ERROR=none INSERT succeeded returned id=%', returned_id;
  ELSE
    RAISE NOTICE 'CASE B SQLSTATE=% ERROR=%', error_state, error_message;
  END IF;
  RAISE NOTICE 'CASE B authenticated SELECT=% owner membership=%', environment_rows, membership_rows;
  IF error_state IS NULL AND (environment_rows <> 1 OR membership_rows <> 1) THEN
    RAISE EXCEPTION 'CASE B succeeded but visibility or owner membership assertion failed';
  END IF;
  IF error_state IS NOT NULL AND (environment_rows <> 0 OR membership_rows <> 0) THEN
    RAISE EXCEPTION 'CASE B failed but left Environment or owner membership rows';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

\echo CASE cleanup verification
SELECT count(*) AS remaining_synthetic_auth_users FROM auth.users
WHERE email LIKE 'moseek-env-insert-%@example.invalid'
   OR email LIKE 'moseek-env-returning-%@example.invalid';
