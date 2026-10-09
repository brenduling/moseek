import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expectedProjectId = 'moseek'
const databaseContainer = 'supabase_db_moseek'
const kongContainer = 'supabase_kong_moseek'
const authContainer = 'supabase_auth_moseek'
const localApi = 'http://127.0.0.1:54321'
const localEnvPath = resolve(projectRoot, '.env.local-test')
const higherPriorityLocalEnvPath = resolve(projectRoot, '.env.local-test.local')
const relevantViteKeys = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SERVER_COLORS_ENABLED',
]
const activityActions = [
  'environment_created','environment_updated','environment_type_changed','contributor_added','contributor_removed',
  'contributor_role_changed','contributor_invited','invitation_accepted','invitation_declined','invitation_revoked',
  'invitation_expired','join_request_created','join_request_accepted','join_request_declined','join_request_revoked',
  'join_request_expired','section_created','section_renamed','section_deleted','resource_created','resource_updated',
  'resource_deleted','file_uploaded','image_uploaded','calendar_item_created','calendar_item_updated',
  'calendar_item_deleted','calendar_status_changed','section_discussion_created','section_discussion_deleted',
]

function run(command, args) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function docker(args) {
  return run('docker', args)
}

function readContainerEnvironment(containerName) {
  const output = docker([
    'inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', containerName,
  ])
  return Object.fromEntries(output.split(/\r?\n/).filter(Boolean).map((entry) => {
    const equals = entry.indexOf('=')
    return [entry.slice(0, equals), entry.slice(equals + 1)]
  }))
}

function psql(sql) {
  return docker([
    'exec', databaseContainer, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql,
  ])
}

function extractPublishableKey(kongConfig) {
  return kongConfig.match(/(?:headers\.apikey|query_params\.apikey)\s*==\s*'(sb_publishable_[^']+)'/)?.[1]
}

async function requireLocalAuthAndApi(apiKey) {
  const health = await fetch(`${localApi}/auth/v1/health`)
  if (!health.ok) throw new Error(`Local Auth health check failed with HTTP ${health.status}.`)

  const createdUserIds = []
  try {
    for (const label of ['a', 'b']) {
      const client = createClient(localApi, apiKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const email = `moseek-color-browser-${label}-${randomUUID()}@example.invalid`
      const password = `Msk-${randomUUID()}-${randomUUID().slice(0, 8)}`
      const { data, error } = await client.auth.signUp({ email, password })
      if (data?.user?.id) createdUserIds.push(data.user.id)
      if (error || !data?.user?.id || !data?.session) {
        const details = error
          ? `HTTP ${error.status ?? 'unknown'}, ${error.code ?? 'no error code'}: ${error.message}`
          : `user returned=${Boolean(data?.user?.id)}, session returned=${Boolean(data?.session)}`
        throw new Error(`Local Auth synthetic sign-up check failed (${details}).`)
      }
      if (label === 'a') await verifyLocalHomeApi(client, data.user.id)
    }

    if (new Set(createdUserIds).size !== 2) {
      throw new Error('Local Auth did not return two distinct synthetic user identities.')
    }
  } finally {
    if (createdUserIds.length) {
      const ids = createdUserIds.map((id) => `'${id}'::uuid`).join(', ')
      psql(`delete from public.environments where created_by in (${ids}); delete from auth.users where id in (${ids});`)
      const leftovers = Number(psql(`select count(*) from auth.users where id in (${ids});`))
      if (leftovers !== 0) throw new Error('Synthetic Auth account cleanup could not be verified.')
    }
  }
}

function requireRequest(result, label) {
  if (result.error) {
    const detail = [result.error.code, result.error.message].filter(Boolean).join(': ')
    throw new Error(`Local API smoke check failed for ${label}${detail ? ` (${detail})` : ''}.`)
  }
  return result.data
}

async function verifyLocalHomeApi(client, userId) {
  const environmentId = randomUUID()
  const sectionId = randomUUID()
  const resourceId = randomUUID()
  const calendarId = randomUUID()
  const now = new Date()
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const after = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  requireRequest(await client.from('environments').insert({
    id: environmentId, name: 'Local Home API smoke test', type: 'personal', created_by: userId,
  }), 'authenticated Environment creation')
  requireRequest(await client.from('sections').insert({
    id: sectionId, environment_id: environmentId, title: 'Local count Section', x: 20, y: 30,
    width: 500, height: 320, created_by: userId,
  }), 'authenticated Section creation')
  requireRequest(await client.from('resources').insert({
    id: resourceId, environment_id: environmentId, created_by: userId, type: 'note',
    title: 'Local count Note', body: 'Temporary API smoke fixture', x: 60, y: 80,
  }), 'authenticated Note creation')
  requireRequest(await client.from('environment_calendar_items').insert({
    id: calendarId, environment_id: environmentId, item_type: 'task', title: 'Local calendar smoke test',
    status: 'open', due_at: tomorrow, created_by: userId,
  }), 'authenticated Calendar fixture creation')

  const environments = requireRequest(await client.from('environments')
    .select('id,name,description,type,created_at').order('created_at', { ascending: true }), 'Home Environment query')
  if (!environments.some((row) => row.id === environmentId)) throw new Error('Local Home Environment query omitted the synthetic Environment.')
  const counts = requireRequest(await client.rpc('get_home_environment_resource_counts'), 'Home resource-count RPC')
  if (Number(counts.find((row) => row.environment_id === environmentId)?.resource_count) !== 2) {
    throw new Error('Local Home resource-count RPC returned an unexpected count for the synthetic Environment.')
  }
  const upcoming = requireRequest(await client.rpc('get_home_upcoming_calendar_items', { p_local_date: localDate }), 'Home upcoming-calendar RPC')
  if (!upcoming.some((item) => item.item_id === calendarId)) throw new Error('Home upcoming-calendar RPC omitted its synthetic due task.')

  const activity = requireRequest(await client.from('environment_activity')
    .select('id,environment_id,actor_name,action,target_label,metadata,occurred_at,environments!inner(name)')
    .in('action', activityActions).order('occurred_at', { ascending: false })
    .order('id', { ascending: false }).range(0, 24), 'Global Activity query')
  if (!activity.some((row) => row.environment_id === environmentId)) {
    throw new Error('Local Activity query did not return the synthetic Environment history.')
  }

  const calendarFields = 'id,environment_id,item_type,title,description,starts_at,ends_at,due_at,all_day,all_day_start,all_day_end,status,environments!inner(name)'
  const [timed, allDay, due, undated] = await Promise.all([
    client.from('environment_calendar_items').select(calendarFields)
      .lt('starts_at', after.toISOString()).or(`ends_at.gte.${first.toISOString()},starts_at.gte.${first.toISOString()}`),
    client.from('environment_calendar_items').select(calendarFields).lt('all_day_start', `${after.getFullYear()}-${String(after.getMonth() + 1).padStart(2, '0')}-01`)
      .or(`all_day_end.gte.${localDate.slice(0, 7)}-01,and(all_day_end.is.null,all_day_start.gte.${localDate.slice(0, 7)}-01)`),
    client.from('environment_calendar_items').select(calendarFields)
      .gte('due_at', first.toISOString()).lt('due_at', after.toISOString()),
    client.from('environment_calendar_items').select(calendarFields).eq('item_type', 'task').is('due_at', null)
      .order('created_at', { ascending: false }).limit(100),
  ])
  requireRequest(timed, 'Global Calendar timed events query')
  requireRequest(allDay, 'Global Calendar all-day events query')
  requireRequest(due, 'Global Calendar dated tasks query')
  requireRequest(undated, 'Global Calendar undated tasks query')
  if (!due.data.some((row) => row.id === calendarId)) throw new Error('Local Calendar due-date query omitted its synthetic task.')
}

function loadModeEnvironmentWithoutInheritedOverrides() {
  const saved = new Map()
  for (const key of relevantViteKeys) {
    if (Object.hasOwn(process.env, key)) saved.set(key, process.env[key])
    delete process.env[key]
  }
  try {
    return loadEnv('local-test', projectRoot, 'VITE_')
  } finally {
    for (const [key, value] of saved) process.env[key] = value
  }
}

async function prepare() {
  if (existsSync(higherPriorityLocalEnvPath)) {
    throw new Error('Remove .env.local-test.local before testing; it can override the verified local settings.')
  }

  const config = readFileSync(resolve(projectRoot, 'supabase/config.toml'), 'utf8')
  const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
  const apiPort = config.match(/^port\s*=\s*(\d+)/m)?.[1]
  if (projectId !== expectedProjectId || apiPort !== '54321') {
    throw new Error('Stopped: local Supabase config does not match project moseek and API port 54321.')
  }

  const running = docker(['ps', '--format', '{{.Names}}']).split(/\r?\n/)
  for (const name of [databaseContainer, kongContainer, authContainer]) {
    if (!running.includes(name)) throw new Error(`Stopped: expected local container ${name} is not running.`)
  }

  const version = psql("select current_setting('server_version_num');")
  if (!version.startsWith('17')) throw new Error('Stopped: local database is not PostgreSQL 17.')

  const requiredMigrations = [
    '20261008000000','20261008000001','20261008000002',
    '20261009000000','20261009000001','20261009000002',
    '20261010000000','20261010000001','20261010000002','20261010000003','20261010000004',
    '20261011000000','20261011000001','20261011000002',
    '20261012000000','20261012000001','20261012000002','20261012000003','20261012000004','20261012000005','20261012000006',
    '20261013000000',
  ]
  const quotedVersions = requiredMigrations.map((version) => `'${version}'`).join(',')
  const migrations = psql(`select version from supabase_migrations.schema_migrations where version in (${quotedVersions}) order by version;`)
  if (migrations.split(/\r?\n/).join(',') !== requiredMigrations.join(',')) {
    throw new Error('Stopped: the required local Moseek schema and Phase 4.6 migrations are not all applied.')
  }
  const schemaObjects = psql("select (to_regprocedure('public.get_home_environment_resource_counts()') is not null)::int || ':' || (to_regprocedure('public.get_home_upcoming_calendar_items(date)') is not null)::int || ':' || (to_regclass('public.environment_activity') is not null)::int || ':' || (to_regclass('public.environment_calendar_items') is not null)::int || ':' || (to_regclass('public.section_discussions') is not null)::int || ':' || (to_regclass('public.section_discussion_messages') is not null)::int;")
  if (schemaObjects !== '1:1:1:1:1:1') throw new Error('Stopped: a required Home, Activity, Calendar, or Discussion schema object is missing locally.')

  const authEnvironment = readContainerEnvironment(authContainer)
  if (authEnvironment.GOTRUE_DISABLE_SIGNUP === 'true'
    || authEnvironment.GOTRUE_MAILER_AUTOCONFIRM !== 'true') {
    throw new Error('Stopped: local Auth must allow sign-up and auto-confirm synthetic accounts for this workflow.')
  }

  const kongEnvironment = readContainerEnvironment(kongContainer)
  if (!kongEnvironment.KONG_DECLARATIVE_CONFIG) {
    throw new Error('Stopped: local Kong configuration path is unavailable.')
  }
  const kongConfig = docker([
    'exec', kongContainer, 'cat', kongEnvironment.KONG_DECLARATIVE_CONFIG,
  ])
  const publishableKey = extractPublishableKey(kongConfig)
  if (!publishableKey) throw new Error('Stopped: the local publishable key could not be located.')

  writeFileSync(localEnvPath, [
    `VITE_SUPABASE_URL=${localApi}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
    'VITE_SERVER_COLORS_ENABLED=true',
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 })

  const resolved = loadModeEnvironmentWithoutInheritedOverrides()
  if (resolved.VITE_SUPABASE_URL !== localApi
    || resolved.VITE_SUPABASE_PUBLISHABLE_KEY !== publishableKey
    || resolved.VITE_SERVER_COLORS_ENABLED !== 'true') {
    throw new Error('Stopped: Vite local-test mode did not resolve to the verified local settings.')
  }
  const parsedUrl = new URL(resolved.VITE_SUPABASE_URL)
  if (parsedUrl.origin !== localApi || parsedUrl.username || parsedUrl.password) {
    throw new Error('Stopped: Vite resolved a non-local Supabase URL.')
  }

  await requireLocalAuthAndApi(publishableKey)

  console.log(`Local target preflight: PASS (project moseek, loopback API, PostgreSQL 17, ${requiredMigrations.length} required migrations).`)
  console.log('Local schema preflight: PASS (Home counts, upcoming Calendar, global Activity, and Section Discussion objects exist).')
  console.log('Vite mode preflight: PASS (local-test resolves to 127.0.0.1:54321; server colors enabled).')
  console.log('Local API smoke checks: PASS (Home Environment/counts, Activity query, Home Calendar, and four Global Calendar queries).')
  console.log('Local Auth preflight: PASS (two synthetic accounts created, confirmed, distinct, and removed).')
  console.log('Local environment file: .env.local-test (ignored; .env.local was not changed).')
}

async function main() {
  await prepare()
  if (process.argv.includes('--preflight-only')) return

  const childEnvironment = { ...process.env }
  for (const key of relevantViteKeys) delete childEnvironment[key]

  const viteCli = resolve(projectRoot, 'node_modules/vite/bin/vite.js')
  const server = spawn(process.execPath, [viteCli, '--mode', 'local-test', '--host', '127.0.0.1'], {
    cwd: projectRoot,
    env: childEnvironment,
    stdio: 'inherit',
    windowsHide: false,
  })
  server.on('error', (error) => {
    console.error(`Could not start the local Vite server: ${error.message}`)
    process.exitCode = 1
  })
  server.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
  })
}

main().catch((error) => {
  // The publishable key and synthetic credentials must never appear in output.
  console.error(`Local color browser workflow stopped: ${error.message}`)
  process.exitCode = 1
})
