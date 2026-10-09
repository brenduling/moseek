const REGULAR_ROLES = new Set(['editor', 'viewer'])
const CONTRIBUTOR_ROLES = new Set(['admin', 'editor', 'viewer'])

// These checks control available UI actions only. PostgreSQL RLS remains the
// authority for every membership mutation.
export function canChangeContributorRole(actorRole, targetRole, actorId, targetId) {
  if (!CONTRIBUTOR_ROLES.has(targetRole) || actorId === targetId) return false
  if (actorRole === 'owner') return true
  return actorRole === 'admin' && REGULAR_ROLES.has(targetRole)
}

export function canRemoveContributor(actorRole, targetRole, actorId, targetId) {
  return canChangeContributorRole(actorRole, targetRole, actorId, targetId)
}

export function contributorRoleOptions(actorRole, targetRole) {
  if (actorRole === 'owner' && CONTRIBUTOR_ROLES.has(targetRole)) return ['admin', 'editor', 'viewer']
  if (actorRole === 'admin' && REGULAR_ROLES.has(targetRole)) return ['editor', 'viewer']
  return []
}
