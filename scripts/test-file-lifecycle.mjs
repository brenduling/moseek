
import dotenv from 'dotenv'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.rls-test' })

const {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  TEST_A_EMAIL,
  TEST_A_PASSWORD,
} = process.env

const BUCKET = 'environment-files'

let passed = 0
let findings = 0
const createdEnvironments = []

function pass(condition, message, detail = '') {
  if (!condition) {
    throw new Error(
      `${message}${detail ? ` — ${detail}` : ''}`
    )
  }

  passed++
  console.log(`PASS: ${message}`)
}

function observe(condition, safeMessage, findingMessage) {
  if (condition) {
    passed++
    console.log(`PASS: ${safeMessage}`)
  } else {
    findings++
    console.log(`FINDING: ${findingMessage}`)
  }
}

function createSupabaseClient() {
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

async function authenticate() {
  const db = createSupabaseClient()

  const { data, error } =
    await db.auth.signInWithPassword({
      email: TEST_A_EMAIL.trim(),
      password: TEST_A_PASSWORD,
    })

  pass(
    !error && Boolean(data?.user),
    'User A authenticated',
    error?.message
  )

  return {
    db,
    id: data.user.id,
  }
}

async function createEnvironment(user, label) {
  const id = randomUUID()

  const { error } = await user.db
    .from('environments')
    .insert({
      id,
      name: `Moseek Test 7 ${label}`,
      type: 'shared',
      created_by: user.id,
    })

  pass(
    !error,
    `Created Environment: ${label}`,
    error?.message
  )

  createdEnvironments.push(id)

  return id
}

async function createFileResource(
  user,
  environmentId,
  label
) {
  const id = randomUUID()
  const filename = `lifecycle-${randomUUID()}.txt`
  const path = `${environmentId}/${id}/${filename}`

  const { error } = await user.db
    .from('resources')
    .insert({
      id,
      environment_id: environmentId,
      created_by: user.id,
      type: 'file',
      title: label,
      original_filename: filename,
      mime_type: 'text/plain',
      file_size: 32,
      storage_path: path,
    })

  pass(
    !error,
    `Created file Resource: ${label}`,
    error?.message
  )

  return {
    id,
    path,
  }
}

async function uploadFile(user, path, label) {
  return user.db.storage
    .from(BUCKET)
    .upload(
      path,
      new Blob(
        [`Moseek lifecycle validation: ${label}`],
        { type: 'text/plain' }
      ),
      {
        contentType: 'text/plain',
        upsert: false,
      }
    )
}

async function downloadFile(user, path) {
  return user.db.storage
    .from(BUCKET)
    .download(path)
}

async function removeFile(user, path) {
  return user.db.storage
    .from(BUCKET)
    .remove([path])
}

async function deleteResource(user, id) {
  return user.db
    .from('resources')
    .delete()
    .eq('id', id)
    .select('id')
}

async function resourceExists(user, id) {
  const { data, error } = await user.db
    .from('resources')
    .select('id')
    .eq('id', id)

  pass(
    !error,
    'Resource existence query succeeded',
    error?.message
  )

  return data.some((row) => row.id === id)
}

async function environmentExists(user, id) {
  const { data, error } = await user.db
    .from('environments')
    .select('id')
    .eq('id', id)

  pass(
    !error,
    'Environment existence query succeeded',
    error?.message
  )

  return data.some((row) => row.id === id)
}

function removalConfirmed(result, path) {
  if (result.error) return false

  return (
    Array.isArray(result.data) &&
    result.data.some(
      (item) =>
        item.name === path ||
        path.endsWith(`/${item.name}`)
    )
  )
}

async function safeDeleteFile(user, file, label) {
  const removal = await removeFile(
    user,
    file.path
  )

  pass(
    removalConfirmed(removal, file.path),
    `${label}: Storage object removed`,
    removal.error?.message
  )

  const deletion = await deleteResource(
    user,
    file.id
  )

  pass(
    !deletion.error &&
      deletion.data?.length === 1,
    `${label}: Resource removed`,
    deletion.error?.message
  )

  pass(
    !(await resourceExists(user, file.id)),
    `${label}: Resource no longer exists`
  )
}

// ========================================
// TEST 7A: RESOURCE-FIRST PROTECTION
// ========================================

async function testResourceFirst(user) {
  console.log('\n--- 7A: Resource-First Protection ---')

  const env = await createEnvironment(
    user,
    'Resource First'
  )

  const file = await createFileResource(
    user,
    env,
    'Protected File'
  )

  const upload = await uploadFile(
    user,
    file.path,
    'Protected file'
  )

  pass(
    !upload.error,
    'Uploaded protected file',
    upload.error?.message
  )

  const before = await downloadFile(
    user,
    file.path
  )

  pass(
    !before.error && Boolean(before.data),
    'File accessible before deletion attempt',
    before.error?.message
  )

  const unsafeDeletion = await deleteResource(
    user,
    file.id
  )

  pass(
    Boolean(unsafeDeletion.error),
    'Database rejects Resource-first deletion'
  )

  console.log(
    `OBSERVATION: ${unsafeDeletion.error.message}`
  )

  pass(
    await resourceExists(user, file.id),
    'Resource remains after rejected deletion'
  )

  const after = await downloadFile(
    user,
    file.path
  )

  pass(
    !after.error && Boolean(after.data),
    'Storage file remains accessible'
  )

  await safeDeleteFile(
    user,
    file,
    'Protected file cleanup'
  )

  return env
}

// ========================================
// TEST 7B: STORAGE-FIRST DELETION
// ========================================

async function testStorageFirst(user) {
  console.log('\n--- 7B: Storage-First Deletion ---')

  const env = await createEnvironment(
    user,
    'Storage First'
  )

  const file = await createFileResource(
    user,
    env,
    'Storage First File'
  )

  const upload = await uploadFile(
    user,
    file.path,
    'Storage-first file'
  )

  pass(
    !upload.error,
    'Uploaded Storage-first file',
    upload.error?.message
  )

  await safeDeleteFile(
    user,
    file,
    'Storage-first deletion'
  )

  return env
}

// ========================================
// TEST 7C: FAILED UPLOAD RECOVERY
// ========================================

async function testFailedUpload(user) {
  console.log('\n--- 7C: Failed Upload Recovery ---')

  const env = await createEnvironment(
    user,
    'Failed Upload'
  )

  const file = await createFileResource(
    user,
    env,
    'Failed Upload Resource'
  )

  // Valid UUID-based shape, but no matching
  // Resource exists for this alternate path.
  const invalidPath =
    `${env}/${randomUUID()}/invalid.txt`

  const attemptedUpload = await uploadFile(
    user,
    invalidPath,
    'Invalid path'
  )

  pass(
    Boolean(attemptedUpload.error),
    'Upload without matching Resource rejected'
  )

  pass(
    await resourceExists(user, file.id),
    'Original Resource remains after upload failure'
  )

  const deletion = await deleteResource(
    user,
    file.id
  )

  pass(
    !deletion.error &&
      deletion.data?.length === 1,
    'Resource without uploaded file can be deleted',
    deletion.error?.message
  )

  pass(
    !(await resourceExists(user, file.id)),
    'Failed-upload Resource cleaned up'
  )

  return env
}

// ========================================
// TEST 7D: ENVIRONMENT DELETION
// ========================================

async function testEnvironmentDeletion(user) {
  console.log('\n--- 7D: Environment Deletion ---')

  const env = await createEnvironment(
    user,
    'Environment Deletion'
  )

  const file = await createFileResource(
    user,
    env,
    'Environment File'
  )

  const upload = await uploadFile(
    user,
    file.path,
    'Environment deletion'
  )

  pass(
    !upload.error,
    'Uploaded Environment test file',
    upload.error?.message
  )

  const deletion = await user.db
    .from('environments')
    .delete()
    .eq('id', env)
    .select('id')

  const exists = await environmentExists(
    user,
    env
  )

  observe(
    Boolean(deletion.error) && exists,
    'Environment deletion blocked while file exists',
    'Environment deletion was not blocked while file exists'
  )

  if (deletion.error) {
    console.log(
      `OBSERVATION: ${deletion.error.message}`
    )
  }

  if (!exists) {
    console.log(
      'WARNING: Environment was deleted. ' +
      'Do not assume the Storage object was removed.'
    )

    return env
  }

  pass(
    await resourceExists(user, file.id),
    'File Resource remains after blocked Environment deletion'
  )

  const fileCheck = await downloadFile(
    user,
    file.path
  )

  pass(
    !fileCheck.error && Boolean(fileCheck.data),
    'File remains accessible after blocked Environment deletion',
    fileCheck.error?.message
  )

  await safeDeleteFile(
    user,
    file,
    'Environment file cleanup'
  )

  const retry = await user.db
    .from('environments')
    .delete()
    .eq('id', env)
    .select('id')

  pass(
    !retry.error &&
      retry.data?.length === 1,
    'Environment deletion succeeds after file cleanup',
    retry.error?.message
  )

  pass(
    !(await environmentExists(user, env)),
    'Environment no longer exists'
  )

  return env
}

// ========================================
// MAIN
// ========================================

async function main() {
  console.log('\nMOSEEK TEST 7: FILE LIFECYCLE')
  console.log('================================')

  for (const key of [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'TEST_A_EMAIL',
    'TEST_A_PASSWORD',
  ]) {
    pass(
      Boolean(process.env[key]),
      `${key} configured`
    )
  }

  const user = await authenticate()

  await testResourceFirst(user)
  await testStorageFirst(user)
  await testFailedUpload(user)
  await testEnvironmentDeletion(user)

  console.log('\n================================')
  console.log('MOSEEK TEST 7 RESULTS')
  console.log(`Passed checks: ${passed}`)
  console.log(`Security findings: ${findings}`)
  console.log('Test Environments:')
  for (const id of createdEnvironments) {
    console.log(`  ${id}`)
  }

  console.log(
    findings === 0
      ? 'RESULT: TEST 7 PASSED'
      : 'RESULT: TEST 7 COMPLETED WITH FINDINGS'
  )

  console.log(
    '\nNOTE: This test validates application-level ' +
    'deletion behavior, not administrative orphan auditing.'
  )
}

main().catch((error) => {
  console.error('\nFAIL:', error.message)
  console.error(
    `Checks passed before failure: ${passed}`
  )
  console.error(
    `Security findings so far: ${findings}`
  )
  process.exitCode = 1
})
