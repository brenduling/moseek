const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isEnvironmentId(value) {
  return typeof value === 'string' && UUID.test(value)
}

export function ensureEnvironmentRows(environmentId, rows) {
  if (rows.some((row) => row.environment_id !== environmentId)) {
    throw new Error('Environment content did not match the selected space.')
  }
  return rows
}

export function nodePosition(row) {
  return { x: Number(row.x), y: Number(row.y) }
}

export function validCanvasPosition(position) {
  return Number.isFinite(position.x) && Number.isFinite(position.y)
}

export function validateLinkUrl(input) {
  const raw = input.trim()
  if (raw.length > 2048 || /\s/.test(raw) || !/^https?:\/\//i.test(raw)) {
    throw new Error('Use a full http:// or https:// link without spaces.')
  }
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Enter a valid link.')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('Enter a valid http:// or https:// link.')
  }
  return parsed.href
}
