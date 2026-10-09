import assert from 'node:assert/strict'
import test from 'node:test'
import { mobileEnvironmentGroups } from '../src/utils/mobileEnvironment.js'
import { canvasNodeDragPatch, canvasPositionDelta, normalizeCanvasViewport, readCanvasViewport,
  restoreCanvasPositions, saveCanvasViewport, shouldStartNodeDrag } from '../src/utils/canvasViewport.js'

const section = (id, title) => ({ id, type: 'section', data: { row: { id, title, x: 10, y: 20 } } })
const resource = (id, type, sectionId = null) => ({ id, type, data: { row: { id, section_id: sectionId, x: 40, y: 50 } } })

test('mobile Environment overview groups Sections and unfiled resources without mutating spatial positions', () => {
  const nodes = [section('s1', 'Planning'), section('s2', 'Research'), resource('n1', 'note'), resource('l1', 'link', 's1')]
  const original = structuredClone(nodes)
  const result = mobileEnvironmentGroups(nodes)
  assert.deepEqual(result.sections.map((node) => node.id), ['s1', 's2'])
  assert.deepEqual(result.visibleResources.map((node) => node.id), ['n1'])
  assert.deepEqual(result.sectionCounts, { s1: 1, s2: 0 })
  assert.deepEqual(nodes, original)
})

test('mobile Section view includes only its resources and leaves other resources in their Sections', () => {
  const nodes = [section('s1', 'Planning'), section('s2', 'Research'), resource('n1', 'note', 's1'), resource('f1', 'file', 's2')]
  const result = mobileEnvironmentGroups(nodes, 's1')
  assert.equal(result.focusedSection.id, 's1')
  assert.deepEqual(result.visibleResources.map((node) => node.id), ['n1'])
  assert.deepEqual(result.sectionCounts, { s1: 1, s2: 1 })
})

test('mobile overview has a safe fallback when the focused Section has been deleted', () => {
  const nodes = [section('s1', 'Planning'), resource('n1', 'note')]
  const result = mobileEnvironmentGroups(nodes, 'deleted-section')
  assert.equal(result.focusedSection, null)
  assert.deepEqual(result.visibleResources.map((node) => node.id), ['n1'])
})

test('canvas viewport is validated and stored separately by user, Environment, and layout', () => {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
  assert.equal(saveCanvasViewport('user-a', 'env-a', 'mobile', { x: -120, y: 60, zoom: 0.75 }, storage), true)
  assert.deepEqual(readCanvasViewport('user-a', 'env-a', 'mobile', storage), { x: -120, y: 60, zoom: 0.75 })
  assert.equal(readCanvasViewport('user-b', 'env-a', 'mobile', storage), null)
  assert.equal(readCanvasViewport('user-a', 'env-a', 'desktop', storage), null)
  assert.equal(saveCanvasViewport('user-a', 'env-a', 'mobile', { x: 0, y: 0, zoom: 9 }, storage), false)
  assert.equal(normalizeCanvasViewport({ x: 'bad', y: 0, zoom: 1 }), null)
})

test('mobile drag threshold and flow-coordinate delta are deterministic', () => {
  assert.equal(shouldStartNodeDrag(8), false)
  assert.equal(shouldStartNodeDrag(8.1), true)
  assert.deepEqual(canvasPositionDelta({ x: 10, y: 40 }, { x: 42, y: 25 }), { x: 32, y: -15 })
})

test('pointer cancellation restores the full saved spatial snapshot without changing resource rows', () => {
  const nodes = [
    { id: 's1', position: { x: 100, y: 100 }, data: { isDropTarget: true, row: { x: 100, y: 100 } } },
    { id: 'n1', position: { x: 170, y: 170 }, data: { row: { x: 170, y: 170, section_id: 's1' } } },
  ]
  const snapshot = nodes.map(({ id, position }) => ({ id, position: { ...position } }))
  const moved = nodes.map((node) => ({ ...node, position: { x: node.position.x + 50, y: node.position.y - 20 } }))
  const restored = restoreCanvasPositions(moved, snapshot)
  assert.deepEqual(restored.map((node) => node.position), [{ x: 100, y: 100 }, { x: 170, y: 170 }])
  assert.equal(restored[0].data.isDropTarget, false)
  assert.equal(restored[1].data.row.section_id, 's1')
})

test('keyboard and pointer drag patches preserve section membership unless a resource is dropped elsewhere', () => {
  const resourceNode = { type: 'note', position: { x: 20, y: 30 }, data: { row: { section_id: 's1' } } }
  assert.deepEqual(canvasNodeDragPatch(resourceNode, 's2'), { x: 20, y: 30, section_id: 's2' })
  assert.deepEqual(canvasNodeDragPatch(resourceNode, 's1'), { x: 20, y: 30 })
  assert.deepEqual(canvasNodeDragPatch({ type: 'section', position: { x: 5, y: 8 }, data: { row: {} } }), { x: 5, y: 8 })
})
