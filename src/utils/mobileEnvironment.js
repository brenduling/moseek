export function mobileEnvironmentGroups(nodes = [], focusedSectionId = null) {
  const sections = nodes.filter((node) => node.type === 'section')
  const resources = nodes.filter((node) => node.type !== 'section')
  const focusedSection = sections.find((node) => node.id === focusedSectionId) || null
  const visibleResources = resources.filter((node) => focusedSection
    ? node.data.row.section_id === focusedSection.id
    : !node.data.row.section_id)
  const sectionCounts = Object.fromEntries(sections.map((section) => [section.id, 0]))
  for (const resource of resources) {
    const sectionId = resource.data.row.section_id
    if (sectionId && Object.hasOwn(sectionCounts, sectionId)) sectionCounts[sectionId] += 1
  }
  return { sections, resources, focusedSection, visibleResources, sectionCounts }
}
