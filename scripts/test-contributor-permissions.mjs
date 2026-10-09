import assert from 'node:assert/strict'
import {
  canChangeContributorRole,
  canRemoveContributor,
  contributorRoleOptions,
} from '../src/lib/contributorPermissions.js'

const owner = 'owner-user'
const admin = 'admin-user'
const editor = 'editor-user'
const viewer = 'viewer-user'
const other = 'other-user'

for (const role of ['admin', 'editor', 'viewer']) {
  assert.equal(canChangeContributorRole('owner', role, owner, other), true, `Owner can change ${role}`)
  assert.equal(canRemoveContributor('owner', role, owner, other), true, `Owner can remove ${role}`)
}
assert.deepEqual(contributorRoleOptions('owner', 'editor'), ['admin', 'editor', 'viewer'])
assert.equal(canChangeContributorRole('owner', 'owner', owner, other), false, 'Owner row stays protected')
assert.equal(canRemoveContributor('owner', 'owner', owner, other), false, 'Owner cannot be removed')
assert.equal(canChangeContributorRole('owner', 'editor', owner, owner), false, 'Cannot manage own membership')

for (const role of ['editor', 'viewer']) {
  assert.equal(canChangeContributorRole('admin', role, admin, other), true, `Admin can change ${role}`)
  assert.equal(canRemoveContributor('admin', role, admin, other), true, `Admin can remove ${role}`)
  assert.deepEqual(contributorRoleOptions('admin', role), ['editor', 'viewer'])
}
assert.equal(canChangeContributorRole('admin', 'admin', admin, other), false, 'Admin cannot manage Admin')
assert.equal(canRemoveContributor('admin', 'admin', admin, other), false, 'Admin cannot remove Admin')
assert.deepEqual(contributorRoleOptions('admin', 'admin'), [])
assert.equal(canChangeContributorRole('editor', 'viewer', editor, other), false, 'Editor is read only for membership')
assert.equal(canRemoveContributor('viewer', 'editor', viewer, other), false, 'Viewer is read only for membership')
assert.deepEqual(contributorRoleOptions('viewer', 'viewer'), [])
assert.equal(canChangeContributorRole('owner', 'unknown', owner, other), false, 'Unknown roles default to no actions')

console.log('PASS: contributor management UI permissions (23 assertions)')
