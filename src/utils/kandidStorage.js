export const KANDID_WORKSPACE_KEY = 'moseek:environment:kandid:workspace:v2'
export const KANDID_RESOURCE_POSITIONS_KEY = 'moseek:environment:kandid:resource-positions:v1'

function readStoredJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function validPositions(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}

  return Object.fromEntries(
    Object.entries(stored).filter(([, position]) =>
      position && Number.isFinite(position.x) && Number.isFinite(position.y),
    ),
  )
}

export function readKandidWorkspace() {
  const legacyPositions = validPositions(readStoredJSON(KANDID_RESOURCE_POSITIONS_KEY))
  const saved = readStoredJSON(KANDID_WORKSPACE_KEY)
  const positions = validPositions(saved?.positions)
  const createdResources = Array.isArray(saved?.createdResources)
    ? saved.createdResources.filter((resource) =>
        resource && typeof resource.id === 'string' &&
        ['note', 'link', 'file'].includes(resource.createdType),
      )
    : []
  const deletedBuiltInIds = Array.isArray(saved?.deletedBuiltInIds)
    ? saved.deletedBuiltInIds.filter((id) => typeof id === 'string')
    : []
  const sections = Array.isArray(saved?.sections)
    ? saved.sections.filter((section) =>
        section && typeof section.id === 'string' && typeof section.title === 'string' &&
        Number.isFinite(section.position?.x) && Number.isFinite(section.position?.y) &&
        Number.isFinite(section.width) && Number.isFinite(section.height),
      )
    : []
  const sectionMemberships = saved?.sectionMemberships && typeof saved.sectionMemberships === 'object'
    ? Object.fromEntries(Object.entries(saved.sectionMemberships).filter(([, id]) => typeof id === 'string'))
    : {}

  return { positions: { ...legacyPositions, ...positions }, createdResources, deletedBuiltInIds,
    sections, sectionMemberships }
}

export function saveKandidWorkspace(nodes, deletedBuiltInIds = []) {
  const resourceNodes = nodes.filter((node) =>
    ['kandidResource', 'editableNote', 'kandidFile'].includes(node.type),
  )
  const workspace = {
    version: 2,
    positions: Object.fromEntries(resourceNodes.map((node) => [node.id, node.position])),
    deletedBuiltInIds,
    sections: nodes.filter((node) => node.type === 'kandidSection').map((node) => ({
      id: node.id,
      title: node.data.section.title,
      position: node.position,
      width: node.style.width,
      height: node.style.height,
      createdAt: node.data.section.createdAt,
    })),
    sectionMemberships: Object.fromEntries(resourceNodes
      .filter((node) => node.data.resource.sectionId)
      .map((node) => [node.id, node.data.resource.sectionId])),
    createdResources: resourceNodes
      .filter((node) => node.data.resource.createdType)
      .map((node) => {
        const { id, createdType, kind, name, body, url, service, detail, icon, typeLabel, createdAt,
          fileStorageId, originalName, mimeType, fileSize, extension, width, height, sectionId } = node.data.resource
        return { id, createdType, kind, name, body, url, service, detail, icon, typeLabel, createdAt,
          fileStorageId, originalName, mimeType, fileSize, extension, width, height, sectionId }
      }),
  }

  try {
    localStorage.setItem(KANDID_WORKSPACE_KEY, JSON.stringify(workspace))
    localStorage.removeItem(KANDID_RESOURCE_POSITIONS_KEY)
  } catch {
    // The workspace remains usable if browser storage is unavailable.
  }
}
