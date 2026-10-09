// Keep the pre-migration label writable during a rolling frontend/database
// rollout. PostgreSQL renames stored member values to editor in Phase 4.0.
const CONTENT_EDITOR_ROLES = new Set(['owner', 'admin', 'editor', 'member'])
const CONTRIBUTOR_MANAGER_ROLES = new Set(['owner', 'admin'])

export function canEditEnvironmentContent(role) {
  return CONTENT_EDITOR_ROLES.has(role)
}

export function canManageEnvironmentContributors(role) {
  return CONTRIBUTOR_MANAGER_ROLES.has(role)
}

export function canAssignEnvironmentAdmin(role) {
  return role === 'owner'
}
