import { randomUUID, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const container = 'supabase_db_moseek'
const kong = 'supabase_kong_moseek'
const auth = 'supabase_auth_moseek'
const apiUrl = 'http://127.0.0.1:54321'

function dockerOutput(args) {
  return execFileSync('docker', args, { encoding: 'utf8', windowsHide: true }).trim()
}

function containerEnv(name) {
  const envText = dockerOutput(['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', name])
  return Object.fromEntries(envText.split(/\r?\n/).filter(Boolean).map((line) => {
    const splitAt = line.indexOf('=')
    return [line.slice(0, splitAt), line.slice(splitAt + 1)]
  }))
}

function signLocalAuthenticatedJwt(userId, secret) {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    aud: 'authenticated',
    role: 'authenticated',
    sub: userId,
    iat: now,
    exp: now + 300,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    aal: 'aal1',
    is_anonymous: false,
  })}`
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

function psql(sql) {
  return dockerOutput([
    'exec', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql,
  ])
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function main() {
  const running = dockerOutput(['ps', '--format', '{{.Names}}']).split(/\r?\n/)
  if (!running.includes(container) || !running.includes(kong) || !running.includes(auth)) {
    throw new Error('Stopped: the expected local Supabase database, Kong, and Auth containers must all be running.')
  }

  const authEnv = containerEnv(auth)
  const jwtSecret = authEnv.GOTRUE_JWT_SECRET
  if (!jwtSecret) throw new Error('Stopped: local Auth JWT signing key was unavailable.')

  const kongEnv = containerEnv(kong)
  const configPath = kongEnv.KONG_DECLARATIVE_CONFIG
  if (!configPath) throw new Error('Stopped: local Kong configuration path was unavailable.')
  const kongConfig = dockerOutput(['exec', kong, 'cat', configPath])
  const anonKey = kongConfig.match(/(?:headers\.apikey|query_params\.apikey)\s*==\s*'(sb_publishable_[^']+)'/)?.[1]
  if (!anonKey) throw new Error('Stopped: local publishable API key could not be read from Kong configuration.')

  const userId = randomUUID()
  const environmentName = `Local API RLS reproduction ${userId}`
  const email = `moseek-local-api-${userId}@example.invalid`
  const userLiteral = quoteLiteral(userId)
  const emailLiteral = quoteLiteral(email)
  const nameLiteral = quoteLiteral(environmentName)
  let insertError = null
  let readError = null
  let readRows = 0
  let membershipCount = 0
  let cleanupError = null

  try {
    psql(`insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous) values (${userLiteral}::uuid, 'authenticated', 'authenticated', ${emailLiteral}, now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), false, false);`)

    const accessToken = signLocalAuthenticatedJwt(userId, jwtSecret)
    const db = createClient(apiUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    // This is the same insert shape used in src/pages/Home.jsx. It deliberately
    // does not request a representation with .select() or RETURNING.
    const inserted = await db.from('environments').insert({
      name: environmentName,
      type: 'shared',
      created_by: userId,
    })
    if (inserted.error) insertError = `${inserted.error.code || 'unknown'} ${inserted.error.message}`

    if (!insertError) {
      const fetched = await db.from('environments')
        .select('id, name, type, created_at')
        .eq('created_by', userId)
        .eq('name', environmentName)
      if (fetched.error) readError = `${fetched.error.code || 'unknown'} ${fetched.error.message}`
      else {
        readRows = fetched.data?.length ?? 0
      }

      membershipCount = Number(psql(
        `select count(*) from public.environment_members where environment_id in (select id from public.environments where created_by = ${userLiteral}::uuid and name = ${nameLiteral}) and user_id = ${userLiteral}::uuid and role = 'owner';`,
      ))
    }
  } finally {
    try {
      // Restrict cleanup to the one fresh synthetic user and its Environment.
      psql(`delete from public.environments where created_by = ${userLiteral}::uuid; delete from auth.users where id = ${userLiteral}::uuid;`)
    } catch (error) {
      cleanupError = error.message
    }
  }

  const leftovers = Number(psql(
    `select (select count(*) from auth.users where id = ${userLiteral}::uuid) + (select count(*) from public.environments where created_by = ${userLiteral}::uuid);`,
  ))

  console.log('CASE C target: local Supabase API http://127.0.0.1:54321 via local Kong/PostgREST')
  console.log('CASE C request: same Supabase client insert shape as src/pages/Home.jsx, then Home-style Environment SELECT')
  console.log(`CASE C INSERT: ${insertError ? `failed (${insertError})` : 'succeeded'}`)
  console.log(`CASE C SELECT: ${readError ? `failed (${readError})` : `succeeded (${readRows} row${readRows === 1 ? '' : 's'})`}`)
  console.log(`CASE C owner membership rows: ${membershipCount}`)
  console.log(`CASE C cleanup: ${cleanupError ? `FAILED (${cleanupError})` : leftovers === 0 ? 'verified clean' : `FAILED (${leftovers} synthetic rows remain)`}`)

  if (cleanupError || leftovers !== 0) process.exitCode = 2
}

main().catch((error) => {
  // Never print local JWT secrets, publishable keys, or generated bearer tokens.
  console.error(`Local API reproduction stopped: ${error.message}`)
  process.exitCode = 1
})
