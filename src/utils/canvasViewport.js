const ZOOM_MIN = 0.2
const ZOOM_MAX = 2

export function normalizeCanvasViewport(value) {
  if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))
    || !Number.isFinite(Number(value.zoom))) return null
  const zoom = Number(value.zoom)
  if (zoom < ZOOM_MIN || zoom > ZOOM_MAX) return null
  return { x: Number(value.x), y: Number(value.y), zoom }
}

function viewportKey(userId, environmentId, layout) {
  return `moseek:canvas-viewport:v1:${userId}:${environmentId}:${layout}`
}

export function readCanvasViewport(userId, environmentId, layout = 'desktop', storage = null) {
  try {
    storage ||= globalThis.localStorage
    return normalizeCanvasViewport(JSON.parse(storage.getItem(viewportKey(userId, environmentId, layout)) || 'null'))
  } catch { return null }
}

export function saveCanvasViewport(userId, environmentId, layout, viewport, storage = null) {
  const normalized = normalizeCanvasViewport(viewport)
  if (!normalized) return false
  try {
    storage ||= globalThis.localStorage
    storage.setItem(viewportKey(userId, environmentId, layout), JSON.stringify(normalized))
    return true
  } catch { return false }
}

export function restoreCanvasPositions(nodes, positions) {
  const byId = new Map(positions.map(({ id, position }) => [id, position]))
  return nodes.map((node) => {
    const position = byId.get(node.id)
    return position ? { ...node, position: { ...position }, data: { ...node.data, isDropTarget: false } } : node
  })
}

export function canvasNodeDragPatch(node, targetSectionId = null) {
  return { x: Number(node.position.x), y: Number(node.position.y),
    ...(node.type !== 'section' && (node.data.row.section_id || null) !== targetSectionId
      ? { section_id: targetSectionId } : {}) }
}

export function shouldStartNodeDrag(distance, threshold = 8) {
  return Number.isFinite(distance) && distance > threshold
}

export function canvasPositionDelta(start, current) {
  return { x: Number(current.x) - Number(start.x), y: Number(current.y) - Number(start.y) }
}
