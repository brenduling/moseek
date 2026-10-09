
import dotenv from 'dotenv'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.rls-test' })

const {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  TEST_A_EMAIL,
  TEST_A_PASSWORD,
  TEST_B_EMAIL,
  TEST_B_PASSWORD,
  TEST_C_PASSWORD,
} = process.env

// Restore the previously working User C authentication.
const TEST_C_EMAIL = 'moseek2@gmail.com'

const BUCKET = 'environment-files'

let passed = 0

function assert(condition, message, detail = '') {
  if (!condition) {
    throw new Error(
      `${message}${detail ? ` — ${detail}` : ''}`
    )
  }

  passed++
  console.log(`PASS: ${message}`)
}

function denied(error, rows) {
  return Boolean(error) ||
    (Array.isArray(rows) && rows.length === 0)
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

  assert(
    !error && Boolean(data?.user),
    `${label} authenticated`,
    error?.message
  )

  return {
    db,
    id: data.user.id,
  }
}

async function readOne(user, table, id) {
  return user.db
    .from(table)
    .select('*')
    .eq('id', id)
    .single()
}

async function cannotRead(user, table, id, message) {
  const { data, error } = await user.db
    .from(table)
    .select('id')
    .eq('id', id)

  assert(
    !error && data?.length === 0,
    message,
    error?.message
  )
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

  assert(
    !error,
    `Created Environment: ${name}`,
    error?.message
  )

  return id
}

async function getRole(actor, environmentId, user) {
  return actor.db
    .from('environment_members')
    .select('role')
    .eq('environment_id', environmentId)
    .eq('user_id', user.id)
    .single()
}

// ========================================
// TEST 1: ENVIRONMENT CREATION
// ========================================

async function testCreation(a) {
  console.log('\n--- TEST 1: Environment Creation ---')

  const environmentId = await createEnvironment(
    a,
    'Moseek RLS Security Test'
  )

  const { data: environment, error } =
    await readOne(a, 'environments', environmentId)

  assert(
    !error &&
      environment?.created_by === a.id,
    'Owner can read Environment',
    error?.message
  )

  const { data: membership, error: roleError } =
    await getRole(a, environmentId, a)

  assert(
    !roleError && membership?.role === 'owner',
    'Automatic owner membership works',
    roleError?.message
  )

  return environmentId
}

// ========================================
// TEST 2: CROSS-USER ISOLATION
// ========================================

async function testIsolation(user, label, environmentId) {
  console.log(`\n--- TEST 2: ${label} Isolation ---`)

  await cannotRead(
    user,
    'environments',
    environmentId,
    `${label} cannot read Environment`
  )

  const { data: memberships, error } =
    await user.db
      .from('environment_members')
      .select('user_id')
      .eq('environment_id', environmentId)

  assert(
    !error && memberships?.length === 0,
    `${label} cannot read memberships`,
    error?.message
  )

  const { data: updated, error: updateError } =
    await user.db
      .from('environments')
      .update({ name: 'UNAUTHORIZED CHANGE' })
      .eq('id', environmentId)
      .select('id')

  assert(
    denied(updateError, updated),
    `${label} cannot update Environment`
  )

  const { data: deleted, error: deleteError } =
    await user.db
      .from('environments')
      .delete()
      .eq('id', environmentId)
      .select('id')

  assert(
    denied(deleteError, deleted),
    `${label} cannot delete Environment`
  )
}

// ========================================
// TEST 3: MEMBERSHIP PERMISSIONS
// ========================================

async function testMembership(a, b, c, environmentId) {
  console.log('\n--- TEST 3: Membership Permissions ---')

  const { error: addBError } = await a.db
    .from('environment_members')
    .insert({
      environment_id: environmentId,
      user_id: b.id,
      role: 'editor',
    })

  assert(
    !addBError,
    'Owner invites User B',
    addBError?.message
  )

  const { data: bEnvironment } =
    await readOne(b, 'environments', environmentId)

  assert(
    bEnvironment?.id === environmentId,
    'User B reads shared Environment'
  )

  const { data: bMembers, error: bMembersError } =
    await b.db
      .from('environment_members')
      .select('user_id')
      .eq('environment_id', environmentId)

  assert(
    !bMembersError &&
      bMembers?.some((m) => m.user_id === a.id) &&
      bMembers?.some((m) => m.user_id === b.id),
    'User B reads shared memberships'
  )

  await cannotRead(
    c,
    'environments',
    environmentId,
    'User C remains excluded'
  )

  const { data: selfPromote, error: selfPromoteError } =
    await b.db
      .from('environment_members')
      .update({ role: 'admin' })
      .eq('environment_id', environmentId)
      .eq('user_id', b.id)
      .select('role')

  assert(
    denied(selfPromoteError, selfPromote),
    'Member cannot self-promote'
  )

  const { data: roleB } =
    await getRole(a, environmentId, b)

  assert(
    roleB?.role === 'editor',
    'User B remains member'
  )

  const { error: inviteCError } = await b.db
    .from('environment_members')
    .insert({
      environment_id: environmentId,
      user_id: c.id,
      role: 'editor',
    })

  assert(
    Boolean(inviteCError),
    'Member cannot invite User C'
  )

  const { data: unauthorizedMembership } =
    await a.db
      .from('environment_members')
      .select('user_id')
      .eq('environment_id', environmentId)
      .eq('user_id', c.id)

  assert(
    unauthorizedMembership?.length === 0,
    'Unauthorized invitation created no membership'
  )

  const { error: promoteError } = await a.db
    .from('environment_members')
    .update({ role: 'admin' })
    .eq('environment_id', environmentId)
    .eq('user_id', b.id)

  assert(
    !promoteError,
    'Owner promotes User B',
    promoteError?.message
  )

  const { data: adminRole } =
    await getRole(a, environmentId, b)

  assert(
    adminRole?.role === 'admin',
    'User B becomes admin'
  )

  const { error: adminInviteError } = await b.db
    .from('environment_members')
    .insert({
      environment_id: environmentId,
      user_id: c.id,
      role: 'editor',
    })

  assert(
    !adminInviteError,
    'Admin invites User C',
    adminInviteError?.message
  )

  const { data: cEnvironment } =
    await readOne(c, 'environments', environmentId)

  assert(
    cEnvironment?.id === environmentId,
    'User C reads Environment after invitation'
  )

  const { data: cPromote, error: cPromoteError } =
    await c.db
      .from('environment_members')
      .update({ role: 'admin' })
      .eq('environment_id', environmentId)
      .eq('user_id', c.id)
      .select('role')

  assert(
    denied(cPromoteError, cPromote),
    'User C cannot self-promote'
  )

  const { data: roleC } =
    await getRole(a, environmentId, c)

  assert(
    roleC?.role === 'editor',
    'User C remains member'
  )

  const { data: adminPromote, error: adminPromoteError } =
    await b.db
      .from('environment_members')
      .update({ role: 'admin' })
      .eq('environment_id', environmentId)
      .eq('user_id', c.id)
      .select('role')

  assert(
    denied(adminPromoteError, adminPromote),
    'Admin cannot promote User C'
  )

  const { data: removeOwner, error: removeOwnerError } =
    await b.db
      .from('environment_members')
      .delete()
      .eq('environment_id', environmentId)
      .eq('user_id', a.id)
      .select('user_id')

  assert(
    denied(removeOwnerError, removeOwner),
    'Admin cannot remove owner'
  )

  const { data: ownerRole } =
    await getRole(a, environmentId, a)

  assert(
    ownerRole?.role === 'owner',
    'User A remains owner'
  )
}

// ========================================
// TEST 4: SECTIONS AND RESOURCES
// ========================================

async function testContent(a, b, c, environmentId) {
  console.log('\n--- TEST 4: Sections and Resources ---')

  const sectionId = randomUUID()
  const resourceId = randomUUID()

  const { error: sectionError } = await a.db
    .from('sections')
    .insert({
      id: sectionId,
      environment_id: environmentId,
      title: 'Security Section',
      x: 100,
      y: 200,
      width: 500,
      height: 350,
      created_by: a.id,
    })

  assert(
    !sectionError,
    'Owner creates Section',
    sectionError?.message
  )

  const { error: resourceError } = await a.db
    .from('resources')
    .insert({
      id: resourceId,
      environment_id: environmentId,
      section_id: sectionId,
      created_by: a.id,
      type: 'note',
      title: 'Security Note',
      body: 'Original content',
    })

  assert(
    !resourceError,
    'Owner creates Resource',
    resourceError?.message
  )

  for (const [label, user] of [
    ['Admin B', b],
    ['Member C', c],
  ]) {
    const { data: section } =
      await readOne(user, 'sections', sectionId)

    const { data: resource } =
      await readOne(user, 'resources', resourceId)

    assert(
      section?.id === sectionId,
      `${label} reads Section`
    )

    assert(
      resource?.id === resourceId,
      `${label} reads Resource`
    )
  }

  const memberSectionId = randomUUID()
  const memberResourceId = randomUUID()

  const { error: memberSectionError } = await c.db
    .from('sections')
    .insert({
      id: memberSectionId,
      environment_id: environmentId,
      title: 'Member Section',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      created_by: c.id,
    })

  assert(
    !memberSectionError,
    'Member creates Section',
    memberSectionError?.message
  )

  const { error: memberResourceError } = await c.db
    .from('resources')
    .insert({
      id: memberResourceId,
      environment_id: environmentId,
      section_id: memberSectionId,
      created_by: c.id,
      type: 'note',
      title: 'Member Note',
    })

  assert(
    !memberResourceError,
    'Member creates Resource',
    memberResourceError?.message
  )

  const { error: editResourceError } = await c.db
    .from('resources')
    .update({ body: 'Edited by member' })
    .eq('id', resourceId)

  assert(
    !editResourceError,
    'Member updates Resource',
    editResourceError?.message
  )

  const { data: editedResource } =
    await readOne(a, 'resources', resourceId)

  assert(
    editedResource?.body === 'Edited by member',
    'Resource edit persisted'
  )

  const { error: editSectionError } = await c.db
    .from('sections')
    .update({ title: 'Updated Section' })
    .eq('id', sectionId)

  assert(
    !editSectionError,
    'Member updates Section',
    editSectionError?.message
  )

  const { data: editedSection } =
    await readOne(a, 'sections', sectionId)

  assert(
    editedSection?.title === 'Updated Section',
    'Section edit persisted'
  )

  const { error: spoofSectionError } = await c.db
    .from('sections')
    .insert({
      id: randomUUID(),
      environment_id: environmentId,
      title: 'Spoofed Section',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      created_by: a.id,
    })

  assert(
    Boolean(spoofSectionError),
    'Section creator spoofing on INSERT denied'
  )

  const { error: spoofResourceError } = await c.db
    .from('resources')
    .insert({
      id: randomUUID(),
      environment_id: environmentId,
      created_by: a.id,
      type: 'note',
      title: 'Spoofed Resource',
    })

  assert(
    Boolean(spoofResourceError),
    'Resource creator spoofing on INSERT denied'
  )

  const otherEnvironmentId = await createEnvironment(
    a,
    'Moseek Foreign Key Test'
  )

  const otherSectionId = randomUUID()

  const { error: otherSectionError } = await a.db
    .from('sections')
    .insert({
      id: otherSectionId,
      environment_id: otherEnvironmentId,
      title: 'Other Section',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      created_by: a.id,
    })

  assert(
    !otherSectionError,
    'Owner creates second Environment Section',
    otherSectionError?.message
  )

  const { error: crossError } = await a.db
    .from('resources')
    .insert({
      id: randomUUID(),
      environment_id: environmentId,
      section_id: otherSectionId,
      created_by: a.id,
      type: 'note',
      title: 'Invalid Reference',
    })

  assert(
    Boolean(crossError),
    'Cross-Environment Section reference rejected'
  )

  const { data: deletedResource, error: deleteResourceError } =
    await c.db
      .from('resources')
      .delete()
      .eq('id', memberResourceId)
      .select('id')

  assert(
    !deleteResourceError &&
      deletedResource?.length === 1,
    'Member deletes Resource'
  )

  const { data: deletedSection, error: deleteSectionError } =
    await c.db
      .from('sections')
      .delete()
      .eq('id', memberSectionId)
      .select('id')

  assert(
    !deleteSectionError &&
      deletedSection?.length === 1,
    'Member deletes Section'
  )

  return {
    sectionId,
    resourceId,
  }
}

// ========================================
// TEST 5: PRIVATE FILE STORAGE
// ========================================

// Required format:
// environment UUID / resource UUID / filename
function storagePath(environmentId, resourceId, filename) {
  return `${environmentId}/${resourceId}/${filename}`
}

function fileContents(label) {
  return new Blob(
    [`Moseek RLS Storage Test: ${label}\n`],
    { type: 'text/plain' }
  )
}

// The Resource must exist BEFORE uploading.
async function createFileResource(
  user,
  environmentId,
  label
) {
  const resourceId = randomUUID()
  const filename = `test-${randomUUID()}.txt`

  const path = storagePath(
    environmentId,
    resourceId,
    filename
  )

  const { error } = await user.db
    .from('resources')
    .insert({
      id: resourceId,
      environment_id: environmentId,
      created_by: user.id,
      type: 'file',
      title: label,
      original_filename: filename,
      mime_type: 'text/plain',
      file_size: 128,
      storage_path: path,
    })

  assert(
    !error,
    `Created file Resource: ${label}`,
    error?.message
  )

  return {
    resourceId,
    path,
  }
}

async function upload(user, path, label, upsert = false) {
  return user.db.storage
    .from(BUCKET)
    .upload(
      path,
      fileContents(label),
      {
        contentType: 'text/plain',
        upsert,
      }
    )
}

async function download(user, path) {
  return user.db.storage
    .from(BUCKET)
    .download(path)
}

async function testStorage(a, b, c, environmentId) {
  console.log('\n--- TEST 5: Private File Storage ---')

  // Owner creates Resource before uploading.
  const ownerFile = await createFileResource(
    a,
    environmentId,
    'Owner Test File'
  )

  const ownerUpload = await upload(
    a,
    ownerFile.path,
    'Owner file'
  )

  assert(
    !ownerUpload.error,
    'Owner uploads private file',
    ownerUpload.error?.message
  )

  const ownerDownload = await download(
    a,
    ownerFile.path
  )

  assert(
    !ownerDownload.error &&
      Boolean(ownerDownload.data),
    'Owner downloads private file',
    ownerDownload.error?.message
  )

  const adminDownload = await download(
    b,
    ownerFile.path
  )

  assert(
    !adminDownload.error &&
      Boolean(adminDownload.data),
    'Admin downloads shared file',
    adminDownload.error?.message
  )

  const memberDownload = await download(
    c,
    ownerFile.path
  )

  assert(
    !memberDownload.error &&
      Boolean(memberDownload.data),
    'Member downloads shared file',
    memberDownload.error?.message
  )

  // Member creates Resource and uploads file.
  const memberFile = await createFileResource(
    c,
    environmentId,
    'Member Test File'
  )

  const memberUpload = await upload(
    c,
    memberFile.path,
    'Member file'
  )

  assert(
    !memberUpload.error,
    'Member uploads private file',
    memberUpload.error?.message
  )

  // Observe overwrite behavior.
  const overwrite = await upload(
    a,
    ownerFile.path,
    'Overwrite attempt',
    true
  )

  const overwriteAllowed = !overwrite.error

  console.log(
    `OBSERVATION: Owner overwrite ${
      overwriteAllowed ? 'ALLOWED' : 'DENIED'
    }`
  )

  // Create an isolated Environment.
  const isolatedEnvironmentId = await createEnvironment(
    a,
    'Moseek Storage Isolation Test'
  )

  const isolatedFile = await createFileResource(
    a,
    isolatedEnvironmentId,
    'Isolated File'
  )

  const isolatedUpload = await upload(
    a,
    isolatedFile.path,
    'Isolated file'
  )

  assert(
    !isolatedUpload.error,
    'Owner uploads file in second Environment',
    isolatedUpload.error?.message
  )

  // User C is not a member of the second Environment.
  const outsiderDownload = await download(
    c,
    isolatedFile.path
  )

  assert(
    Boolean(outsiderDownload.error),
    'Member cannot download other Environment file'
  )

  const outsiderUpload = await upload(
    c,
    isolatedFile.path,
    'Unauthorized upload'
  )

  assert(
    Boolean(outsiderUpload.error),
    'Member cannot upload to other Environment file path'
  )

  const {
    data: outsiderDelete,
    error: outsiderDeleteError,
  } = await c.db.storage
    .from(BUCKET)
    .remove([isolatedFile.path])

  assert(
    Boolean(outsiderDeleteError) ||
      !outsiderDelete?.some(
        (item) => item.name === isolatedFile.path
      ),
    'Member cannot delete other Environment file'
  )

  const isolatedStillExists = await download(
    a,
    isolatedFile.path
  )

  assert(
    !isolatedStillExists.error &&
      Boolean(isolatedStillExists.data),
    'Isolated file survives unauthorized deletion'
  )

  // ========================================
  // MEMBERSHIP REVOCATION
  // ========================================

  console.log('\n--- Storage Membership Revocation ---')

  const { data: removed, error: removeError } =
    await a.db
      .from('environment_members')
      .delete()
      .eq('environment_id', environmentId)
      .eq('user_id', b.id)
      .select('user_id')

  assert(
    !removeError && removed?.length === 1,
    'Owner removes User B',
    removeError?.message
  )

  await cannotRead(
    b,
    'environments',
    environmentId,
    'Removed User B cannot read Environment'
  )

  const revokedDownload = await download(
    b,
    ownerFile.path
  )

  assert(
    Boolean(revokedDownload.error),
    'Removed User B cannot download file'
  )

  // Removed member cannot create a new file Resource.
  const revokedResourceId = randomUUID()

  const revokedPath = storagePath(
    environmentId,
    revokedResourceId,
    'revoked-test.txt'
  )

  const { error: revokedResourceError } =
    await b.db
      .from('resources')
      .insert({
        id: revokedResourceId,
        environment_id: environmentId,
        created_by: b.id,
        type: 'file',
        title: 'Revoked Upload',
        storage_path: revokedPath,
      })

  assert(
    Boolean(revokedResourceError),
    'Removed User B cannot create file Resource'
  )

  const revokedUpload = await upload(
    b,
    revokedPath,
    'Revoked upload'
  )

  assert(
    Boolean(revokedUpload.error),
    'Removed User B cannot upload file'
  )

  const revokedOverwrite = await upload(
    b,
    ownerFile.path,
    'Revoked overwrite',
    true
  )

  assert(
    Boolean(revokedOverwrite.error),
    'Removed User B cannot overwrite file'
  )

  const {
    data: revokedDelete,
    error: revokedDeleteError,
  } = await b.db.storage
    .from(BUCKET)
    .remove([ownerFile.path])

  assert(
    Boolean(revokedDeleteError) ||
      !revokedDelete?.some(
        (item) => item.name === ownerFile.path
      ),
    'Removed User B cannot delete file'
  )

  const finalOwnerDownload = await download(
    a,
    ownerFile.path
  )

  assert(
    !finalOwnerDownload.error &&
      Boolean(finalOwnerDownload.data),
    'Owner file remains available after revocation'
  )

  const finalMemberDownload = await download(
    c,
    ownerFile.path
  )

  assert(
    !finalMemberDownload.error &&
      Boolean(finalMemberDownload.data),
    'Active member retains file access'
  )

  // Authorized member deletes own file.
  const {
    data: memberDelete,
    error: memberDeleteError,
  } = await c.db.storage
    .from(BUCKET)
    .remove([memberFile.path])

  assert(
    !memberDeleteError &&
      memberDelete?.some(
        (item) => item.name === memberFile.path
      ),
    'Member deletes own file',
    memberDeleteError?.message
  )

  return {
    ownerFile,
    overwriteAllowed,
  }
}

// ========================================
// FINAL INTEGRITY CHECK
// ========================================

async function finalIntegrity(
  a,
  b,
  c,
  environmentId,
  content
) {
  console.log('\n--- Final Integrity Check ---')

  const { data: environment, error } =
    await readOne(a, 'environments', environmentId)

  assert(
    !error &&
      environment?.name === 'Moseek RLS Security Test' &&
      environment.created_by === a.id,
    'Environment remains unchanged'
  )

  const { data: section } =
    await readOne(a, 'sections', content.sectionId)

  assert(
    section?.title === 'Updated Section' &&
      section.created_by === a.id,
    'Section remains intact'
  )

  const { data: resource } =
    await readOne(a, 'resources', content.resourceId)

  assert(
    resource?.title === 'Security Note' &&
      resource.body === 'Edited by member' &&
      resource.created_by === a.id,
    'Resource remains intact'
  )

  await cannotRead(
    b,
    'sections',
    content.sectionId,
    'Removed User B cannot read Section'
  )

  await cannotRead(
    b,
    'resources',
    content.resourceId,
    'Removed User B cannot read Resource'
  )

  for (const table of ['sections', 'resources']) {
    const id =
      table === 'sections'
        ? content.sectionId
        : content.resourceId

    const { data: updated, error: updateError } =
      await b.db
        .from(table)
        .update({
          title: 'UNAUTHORIZED CHANGE',
        })
        .eq('id', id)
        .select('id')

    assert(
      denied(updateError, updated),
      `Removed User B cannot update ${table}`
    )

    const { data: deleted, error: deleteError } =
      await b.db
        .from(table)
        .delete()
        .eq('id', id)
        .select('id')

    assert(
      denied(deleteError, deleted),
      `Removed User B cannot delete ${table}`
    )
  }

  const { data: members, error: membersError } =
    await a.db
      .from('environment_members')
      .select('user_id, role')
      .eq('environment_id', environmentId)

  assert(
    !membersError &&
      members?.length === 2 &&
      members.some(
        (m) =>
          m.user_id === a.id &&
          m.role === 'owner'
      ) &&
      members.some(
        (m) =>
          m.user_id === c.id &&
        m.role === 'editor'
      ) &&
      !members.some(
        (m) => m.user_id === b.id
      ),
    'Final roles: A=owner, C=member, B=removed'
  )
}

// ========================================
// MAIN
// ========================================

async function main() {
  console.log('\nMOSEEK RLS SECURITY VALIDATION')
  console.log('================================')

  const required = {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    TEST_A_EMAIL,
    TEST_A_PASSWORD,
    TEST_B_EMAIL,
    TEST_B_PASSWORD,
    TEST_C_PASSWORD,
  }

  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      throw new Error(`Missing ${key} in .env.rls-test`)
    }
  }

  const a = await login(
    'User A',
    TEST_A_EMAIL,
    TEST_A_PASSWORD
  )

  const b = await login(
    'User B',
    TEST_B_EMAIL,
    TEST_B_PASSWORD
  )

  const c = await login(
    'User C',
    TEST_C_EMAIL,
    TEST_C_PASSWORD
  )

  assert(
    new Set([a.id, b.id, c.id]).size === 3,
    'Test accounts have distinct user IDs'
  )

  const environmentId = await testCreation(a)

  await testIsolation(b, 'User B', environmentId)
  await testIsolation(c, 'User C', environmentId)

  await testMembership(a, b, c, environmentId)

  const content = await testContent(
    a,
    b,
    c,
    environmentId
  )

  const storage = await testStorage(
    a,
    b,
    c,
    environmentId
  )

  await finalIntegrity(
    a,
    b,
    c,
    environmentId,
    content
  )

  console.log('\n================================')
  console.log('RESULT: MOSEEK RLS TESTS 1-5 PASSED')
  console.log(`Assertions passed: ${passed}`)
  console.log(`Environment ID: ${environmentId}`)
  console.log(`Owner file: ${storage.ownerFile.path}`)
  console.log(
    `Owner overwrite: ${
      storage.overwriteAllowed
        ? 'ALLOWED'
        : 'DENIED'
    }`
  )
}

main().catch((error) => {
  console.error('\nFAIL:', error.message)
  console.error(
    `Assertions passed before failure: ${passed}`
  )
  process.exitCode = 1
})
