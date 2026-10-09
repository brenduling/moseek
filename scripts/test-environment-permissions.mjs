import assert from 'node:assert/strict'
import {
  canAssignEnvironmentAdmin,
  canEditEnvironmentContent,
  canManageEnvironmentContributors,
} from '../src/lib/environmentPermissions.js'

const expected = {
  owner: { content: true, contributors: true, admin: true },
  admin: { content: true, contributors: true, admin: false },
  editor: { content: true, contributors: false, admin: false },
  viewer: { content: false, contributors: false, admin: false },
}

for (const [role, permissions] of Object.entries(expected)) {
  assert.equal(canEditEnvironmentContent(role), permissions.content, `${role} content capability`)
  assert.equal(canManageEnvironmentContributors(role), permissions.contributors, `${role} contributor capability`)
  assert.equal(canAssignEnvironmentAdmin(role), permissions.admin, `${role} Admin assignment capability`)
}

assert.equal(canEditEnvironmentContent('member'), true, 'legacy role remains writable during migration rollout')
assert.equal(canEditEnvironmentContent(null), false, 'unknown roles default to read-only')
console.log('PASS: frontend Environment role capability matrix (14 assertions)')
