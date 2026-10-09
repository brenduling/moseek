export const COLORS = [
  { id: 'neutral', name: 'Neutral' },
  { id: 'sage', name: 'Soft sage' },
  { id: 'sand', name: 'Warm sand' },
  { id: 'clay', name: 'Soft clay' },
  { id: 'mist', name: 'Cool mist' },
]

const colorIds = new Set(COLORS.map(({ id }) => id))
const kinds = new Set(['environment', 'section', 'note'])

export function normalizeColor(value) {
  return colorIds.has(value) ? value : 'neutral'
}

export function colorKey(userId, kind, id) {
  if (!userId || !id || !kinds.has(kind)) return null
  return `moseek:color:v1:${userId}:${kind}:${id}`
}

export function readColor(userId, kind, id, storage = localStorage) {
  const key = colorKey(userId, kind, id)
  if (!key) return 'neutral'
  try { return normalizeColor(storage.getItem(key)) }
  catch { return 'neutral' }
}

export function saveColor(userId, kind, id, color, storage = localStorage) {
  const key = colorKey(userId, kind, id)
  if (!key || !colorIds.has(color)) return false
  try {
    if (color === 'neutral') storage.removeItem(key)
    else storage.setItem(key, color)
    return true
  } catch { return false }
}
