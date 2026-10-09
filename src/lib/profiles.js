import { initialProfilePatch, validateAvatarUrl, validateDisplayName, validateUsername } from '../utils/profile.js'

const COLUMNS = 'id, display_name, username, avatar_url, created_at, updated_at'

export async function loadProfile(db, user) {
  const current = await db.from('profiles').select(COLUMNS).eq('id', user.id).single()
  if (current.error) throw current.error
  const patch = initialProfilePatch(user, current.data)
  if (!Object.keys(patch).length) return current.data
  let query = db.from('profiles').update(patch).eq('id', user.id)
    .eq('updated_at', current.data.updated_at)
  if (patch.display_name) query = query.eq('display_name', current.data.display_name)
  if (patch.avatar_url) query = query.is('avatar_url', null)
  const updated = await query.select(COLUMNS).maybeSingle()
  if (updated.error) throw updated.error
  if (updated.data) return updated.data
  const latest = await db.from('profiles').select(COLUMNS).eq('id', user.id).single()
  if (latest.error) throw latest.error
  return latest.data
}

export async function updateProfile(db, userId, values) {
  const patch = { display_name: validateDisplayName(values.displayName),
    avatar_url: validateAvatarUrl(values.avatarUrl),
    username: validateUsername(values.username || '') }
  const result = await db.from('profiles').update(patch).eq('id', userId).select(COLUMNS).single()
  if (result.error?.code === '23505') throw new Error('That username is already in use.')
  if (result.error) throw result.error
  return result.data
}
