export const ENVIRONMENT_POSITIONS_KEY = 'moseek:home:environment-positions:v2'

function positionsKey(userId) {
  return `${ENVIRONMENT_POSITIONS_KEY}:${userId}`
}

export function readEnvironmentPositions(userId) {
  try {
    const stored = JSON.parse(localStorage.getItem(positionsKey(userId)) || '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}

    return Object.fromEntries(
      Object.entries(stored).filter(([, position]) =>
        position && Number.isFinite(position.x) && Number.isFinite(position.y),
      ),
    )
  } catch {
    return {}
  }
}

export function saveEnvironmentPositions(userId, nodes) {
  const positions = Object.fromEntries(
    nodes
      .filter((node) => node.type === 'environment')
      .map((node) => [node.id, node.position]),
  )

  try {
    localStorage.setItem(positionsKey(userId), JSON.stringify(positions))
  } catch {
    // The canvas remains usable if browser storage is unavailable.
  }
}

export function clearEnvironmentPositions(userId) {
  try {
    localStorage.removeItem(positionsKey(userId))
  } catch {
    // Reset still restores the in-memory arrangement.
  }
}
