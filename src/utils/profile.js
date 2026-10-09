const DEFAULT_NAME = 'Moseek member'

export function accountProviders(user) {
  const providers = user?.app_metadata?.providers || [user?.app_metadata?.provider].filter(Boolean)
  return [...new Set(providers)].map((provider) => provider === 'google' ? 'Google'
    : provider === 'email' ? 'Email and password' : provider)
}

export function googleIdentity(user) {
  if (!accountProviders(user).includes('Google')) return { name: '', avatarUrl: '' }
  const identity = user?.identities?.find((item) => item.provider === 'google')?.identity_data || {}
  const metadata = user?.user_metadata || {}
  const name = [metadata.full_name, metadata.name, identity.full_name, identity.name]
    .find((value) => typeof value === 'string' && value.trim())?.trim() || ''
  const candidate = [metadata.avatar_url, metadata.picture, identity.avatar_url, identity.picture]
    .find((value) => typeof value === 'string' && value.trim()) || ''
  let avatarUrl = ''
  try { avatarUrl = validateAvatarUrl(candidate) || '' } catch { /* Ignore an unusable provider image. */ }
  return { name: name.slice(0, 100), avatarUrl }
}

export function isUntouchedProfile(profile) {
  return Boolean(profile && profile.created_at && profile.updated_at && profile.created_at === profile.updated_at)
}

export function profilePresentation(user, profile) {
  const google = googleIdentity(user)
  const untouched = isUntouchedProfile(profile)
  const fallbackName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Moseek member'
  const displayName = profile?.display_name && !(untouched && profile.display_name === DEFAULT_NAME)
    ? profile.display_name : google.name || fallbackName
  const avatarUrl = profile?.avatar_url || (untouched || !profile ? google.avatarUrl : '')
  return { displayName, avatarUrl }
}

export function initialProfilePatch(user, profile) {
  if (!isUntouchedProfile(profile)) return {}
  const google = googleIdentity(user)
  const patch = {}
  if (profile.display_name === DEFAULT_NAME && google.name) patch.display_name = google.name
  if (profile.avatar_url == null && google.avatarUrl) patch.avatar_url = google.avatarUrl
  return patch
}

export function validateDisplayName(value) {
  const name = value.trim()
  if (!name || name.length > 100) throw new Error('Use a name between 1 and 100 characters.')
  return name
}

export function validateUsername(value) {
  const username = value.trim().replace(/^@/, '').toLowerCase()
  if (!username) return null
  if (!/^[a-z0-9][a-z0-9_.-]{2,29}$/.test(username)) {
    throw new Error('Use 3–30 letters, numbers, dots, dashes, or underscores. Start with a letter or number.')
  }
  return username
}

export function validateAvatarUrl(value) {
  const raw = value.trim()
  if (!raw) return null
  if (raw.length > 2048 || /\s/.test(raw)) throw new Error('Use a secure image link under 2,048 characters.')
  let parsed
  try { parsed = new URL(raw) } catch { throw new Error('Enter a valid image link.') }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('Use a full https:// image link.')
  }
  return parsed.href
}
