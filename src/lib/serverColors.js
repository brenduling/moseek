import { COLORS } from '../utils/personalization.js'

// Enabled only in a build made after the approved migration is deployed.
export const SERVER_COLORS_ENABLED = import.meta.env?.VITE_SERVER_COLORS_ENABLED === 'true'

const allowed = new Set(COLORS.map(({ id }) => id))
const PREFERENCE_COLUMNS = 'user_id, environment_id, card_color, updated_at'

export class ColorConflictError extends Error {
  constructor() {
    super('This color changed elsewhere. Reload to see the latest choice.')
    this.name = 'ColorConflictError'
  }
}

export function checkedColor(value) {
  if (!allowed.has(value)) throw new Error('The saved color is not supported by this version of Moseek.')
  return value
}

export function preferenceColor(preferences, environmentId) {
  const row = preferences[environmentId]
  return row ? checkedColor(row.card_color) : 'neutral'
}

export async function loadEnvironmentColors(db, userId) {
  const { data, error } = await db.from('environment_color_preferences')
    .select(PREFERENCE_COLUMNS).eq('user_id', userId)
  if (error) throw error
  const rows = {}
  for (const row of data) {
    if (row.user_id !== userId || !row.environment_id || !row.updated_at) {
      throw new Error('Environment color data did not match this account.')
    }
    checkedColor(row.card_color)
    rows[row.environment_id] = row
  }
  return rows
}

export async function setEnvironmentColor(db, userId, environmentId, current, color) {
  checkedColor(color)
  if (current) {
    if (current.user_id !== userId || current.environment_id !== environmentId || !current.updated_at) {
      throw new Error('Environment color data did not match this account.')
    }
    const { data, error } = await db.from('environment_color_preferences')
      .update({ card_color: color }).eq('user_id', userId).eq('environment_id', environmentId)
      .eq('updated_at', current.updated_at).select(PREFERENCE_COLUMNS).maybeSingle()
    if (error) throw error
    if (!data) throw new ColorConflictError()
    if (data.user_id !== userId || data.environment_id !== environmentId) {
      throw new Error('Environment color response did not match this account.')
    }
    checkedColor(data.card_color)
    return data
  }
  const { data, error } = await db.from('environment_color_preferences')
    .insert({ user_id: userId, environment_id: environmentId, card_color: color })
    .select(PREFERENCE_COLUMNS).single()
  if (error?.code === '23505') throw new ColorConflictError()
  if (error) throw error
  if (data.user_id !== userId || data.environment_id !== environmentId) {
    throw new Error('Environment color response did not match this account.')
  }
  checkedColor(data.card_color)
  return data
}

export async function setSharedColor(db, kind, environmentId, row, color) {
  checkedColor(color)
  if (!['section', 'note'].includes(kind) || !row?.id || row.environment_id !== environmentId
    || (kind === 'note' && row.type !== 'note') || !row.updated_at) {
    throw new Error('This item cannot be recolored.')
  }
  const table = kind === 'section' ? 'sections' : 'resources'
  const { data, error } = await db.from(table).update({ card_color: color })
    .eq('id', row.id).eq('environment_id', environmentId).eq('updated_at', row.updated_at)
    .select('*').maybeSingle()
  if (error) throw error
  if (!data) throw new ColorConflictError()
  if (data.id !== row.id || data.environment_id !== environmentId || (kind === 'note' && data.type !== 'note')) {
    throw new Error('Color response did not match this item.')
  }
  checkedColor(data.card_color)
  return data
}
