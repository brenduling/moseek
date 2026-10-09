
import dotenv from 'dotenv'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.rls-test' })

const {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  TEST_A_EMAIL,
  TEST_A_PASSWORD,
  TEST_C_PASSWORD,
} = process.env

// Preserve the previously validated authentication.
const TEST_C_EMAIL = 'moseek2@gmail.com'
const BUCKET = 'environment-files'

let passed = 0
let findings = 0

function check(condition, message, detail = '') {
  if (!condition) {
    throw new Error(
      `${message}${detail ? ` — ${detail}` : ''}`
    )
  }
  passed++
  console.log(`PASS: ${message}`)
}

function finding(condition, safeMessage, riskMessage) {
  if (condition) {
    passed++
    console.log(`PASS: ${safeMessage}`)
  } else {
    findings++
    console.log(`FINDING: ${riskMessage}`)
  }
}

function makeClient() {
  return createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}

async function login(label, email, password) {
  const db = makeClient()
  const { data, error } =
    await db.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

  check(
    !error && Boolean(data?.user),
    `${label} authenticated`,
    error?.message
  )

  return { db, id: data.user.id }
}

async function read(user, table, id) {
  const { data, error } = await user.db
    .from(table)
    .select('*')
    .eq('id', id)
    .single()

  check(
    !error && Boolean(data),
    `Read ${table} ${id}`,
    error?.message
  )

  return data
}

async function createEnvironment(user, name) {
  const id = randomUUID()

  const { error } = await user.db
    .from('environments')
    .insert({
      id,
      name,
      type: 'shared',
      created_by: user.id,
    })

  check(
    !error,
    `Created Environment: ${name}`,
    error?.message
  )

  return id
}

async function createSection(user, environmentId, title) {
  const id = randomUUID()

  const { error } = await user.db
    .from('sections')
    .insert({
      id,
      environment_id: environmentId,
      created_by: user.id,
      title,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    })

  check(
    !error,
    `Created Section: ${title}`,
    error?.message
  )

  return id
}

async function createNote(user, environmentId, title) {
  const id = randomUUID()

  const { error } = await user.db
    .from('resources')
    .insert({
      id,
      environment_id: environmentId,
      created_by: user.id,
      type: 'note',
      title,
      body: 'Original test content',
    })

  check(
    !error,
    `Created Resource: ${title}`,
    error?.message
  )

  return id
}

async function createFile(user, environmentId) {
  const id = randomUUID()
  const filename = `edge-${randomUUID()}.txt`
  const path = `${environmentId}/${id}/${filename}`

  const { error } = await user.db
    .from('resources')
    .insert({
      id,
      environment_id: environmentId,
      created_by: user.id,
      type: 'file',
      title: 'Test 6 File',
      original_filename: filename,
      mime_type: 'text/plain',
      file_size: 24,
      storage_path: path,
    })

  check(
    !error,
    'Created file Resource',
    error?.message
  )

  const { error: uploadError } = await user.db.storage
    .from(BUCKET)
    .upload(
      path,
      new Blob(
        ['Moseek Test 6 original file'],
        { type: 'text/plain' }
      ),
      {
        contentType: 'text/plain',
        upsert: false,
      }
    )

  check(
    !uploadError,
    'Uploaded test file',
    uploadError?.message
  )

  return { id, path, filename }
}

async function attemptUpdate(
  actor,
  owner,
  table,
  id,
  changes,
  field,
  expected
) {
  const { error } = await actor.db
    .from(table)
    .update(changes)
    .eq('id', id)

  // Always inspect persisted state, not just the
  // API response, to detect silent denials.
  const record = await read(owner, table, id)

  const safe = record[field] === expected

  return {
    safe,
    error: error?.message || null,
    actual: record[field],
  }
}

async function main() {
  console.log('\nMOSEEK TEST 6: SECURITY EDGE CASES')
  console.log('===================================')

  for (const key of [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'TEST_A_EMAIL',
    'TEST_A_PASSWORD',
    'TEST_C_PASSWORD',
  ]) {
    check(
      Boolean(process.env[key]),
      `${key} configured`
    )
  }

  const a = await login(
    'User A',
    TEST_A_EMAIL,
    TEST_A_PASSWORD
  )

  const c = await login(
    'User C',
    TEST_C_EMAIL,
    TEST_C_PASSWORD
  )

  check(a.id !== c.id, 'Distinct test users')

  // Two separate Environments.
  const sharedEnv = await createEnvironment(
    a,
    'Moseek Test 6 Shared'
  )

  const privateEnv = await createEnvironment(
    a,
    'Moseek Test 6 Isolated'
  )

  // C joins only the first Environment.
  const { error: membershipError } = await a.db
    .from('environment_members')
    .insert({
      environment_id: sharedEnv,
      user_id: c.id,
      role: 'editor',
    })

  check(
    !membershipError,
    'User C joins shared Environment',
    membershipError?.message
  )

  // =====================================
  // 6A: CREATOR ATTRIBUTION
  // =====================================

  console.log('\n--- 6A: Creator Attribution ---')

  const sectionId = await createSection(
    a,
    sharedEnv,
    'Creator Protection Section'
  )

  const noteId = await createNote(
    a,
    sharedEnv,
    'Creator Protection Note'
  )

  // User C attempts to replace User A's creator ID
  // with their own ID.
  const sectionSpoof = await attemptUpdate(
    c,
    a,
    'sections',
    sectionId,
    { created_by: c.id },
    'created_by',
    a.id
  )

  finding(
    sectionSpoof.safe,
    'Section creator attribution protected',
    'Member changed Section created_by'
  )

  const resourceSpoof = await attemptUpdate(
    c,
    a,
    'resources',
    noteId,
    { created_by: c.id },
    'created_by',
    a.id
  )

  finding(
    resourceSpoof.safe,
    'Resource creator attribution protected',
    'Member changed Resource created_by'
  )

  // =====================================
  // 6B: CROSS-ENVIRONMENT MOVEMENT
  // =====================================

  console.log('\n--- 6B: Cross-Environment Movement ---')

  const moveSectionId = await createSection(
    a,
    sharedEnv,
    'Movement Test Section'
  )

  const moveNoteId = await createNote(
    a,
    sharedEnv,
    'Movement Test Resource'
  )

  const sectionMove = await attemptUpdate(
    c,
    a,
    'sections',
    moveSectionId,
    { environment_id: privateEnv },
    'environment_id',
    sharedEnv
  )

  finding(
    sectionMove.safe,
    'Member cannot move Section to inaccessible Environment',
    'Member moved Section into inaccessible Environment'
  )

  const resourceMove = await attemptUpdate(
    c,
    a,
    'resources',
    moveNoteId,
    { environment_id: privateEnv },
    'environment_id',
    sharedEnv
  )

  finding(
    resourceMove.safe,
    'Member cannot move Resource to inaccessible Environment',
    'Member moved Resource into inaccessible Environment'
  )

  // =====================================
  // 6C: FILE RESOURCE METADATA
  // =====================================

  console.log('\n--- 6C: File Path and Metadata ---')

  const file = await createFile(a, sharedEnv)

  const replacementPath =
    `${sharedEnv}/${file.id}/changed-${randomUUID()}.txt`

  const pathChange = await attemptUpdate(
    c,
    a,
    'resources',
    file.id,
    { storage_path: replacementPath },
    'storage_path',
    file.path
  )

  finding(
    pathChange.safe,
    'File storage_path protected from member changes',
    'Member changed storage_path of an existing file Resource'
  )

  // Restore the original path if the attempted change
  // succeeded, so subsequent checks use the original file.
  if (!pathChange.safe) {
    const { error: restoreError } = await a.db
      .from('resources')
      .update({ storage_path: file.path })
      .eq('id', file.id)

    check(
      !restoreError,
      'Restored original file Resource path',
      restoreError?.message
    )
  }

  const typeChange = await attemptUpdate(
    c,
    a,
    'resources',
    file.id,
    { type: 'note' },
    'type',
    'file'
  )

  finding(
    typeChange.safe,
    'File Resource type protected from member changes',
    'Member changed existing file Resource type'
  )

  if (!typeChange.safe) {
    const { error: restoreTypeError } = await a.db
      .from('resources')
      .update({ type: 'file' })
      .eq('id', file.id)

    check(
      !restoreTypeError,
      'Restored original file Resource type',
      restoreTypeError?.message
    )
  }

  // Verify file remains accessible after restoration.
  const { data: downloadData, error: downloadError } =
    await a.db.storage
      .from(BUCKET)
      .download(file.path)

  check(
    !downloadError && Boolean(downloadData),
    'Owner can still download original file',
    downloadError?.message
  )

  // =====================================
  // SUMMARY
  // =====================================

  console.log('\n===================================')
  console.log('MOSEEK TEST 6 RESULTS')
  console.log(`Passed checks: ${passed}`)
  console.log(`Security findings: ${findings}`)
  console.log(`Shared Environment: ${sharedEnv}`)
  console.log(`Isolated Environment: ${privateEnv}`)

  if (findings === 0) {
    console.log('RESULT: TEST 6 PASSED')
  } else {
    console.log(
      'RESULT: TEST 6 IDENTIFIED SECURITY FINDINGS'
    )
    console.log(
      'Review findings before production deployment.'
    )
  }
}

main().catch((error) => {
  console.error('\nFAIL:', error.message)
  console.error(`Passed checks before failure: ${passed}`)
  console.error(`Security findings so far: ${findings}`)
  process.exitCode = 1
})
