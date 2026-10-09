import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteCanvasRow, insertCanvasRow, updateCanvasRow } from '../src/lib/environmentWrites.js'
import { ensureEnvironmentRows, isEnvironmentId, nodePosition, validateLinkUrl } from '../src/utils/environmentCanvas.js'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'

test('rejects invalid Environment IDs and mixed Environment content', () => {
  assert.equal(isEnvironmentId(first), true)
  assert.equal(isEnvironmentId('kandid'), false)
  assert.deepEqual(ensureEnvironmentRows(first, [{ environment_id: first }]), [{ environment_id: first }])
  assert.throws(() => ensureEnvironmentRows(first, [{ environment_id: second }]), /did not match/)
})

test('maps PostgREST numeric coordinates without changing their values', () => {
  assert.deepEqual(nodePosition({ x: '-12.50', y: '203.25' }), { x: -12.5, y: 203.25 })
})

test('only accepts safe full HTTP links supported by the schema', () => {
  assert.equal(validateLinkUrl(' https://example.com/path '), 'https://example.com/path')
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/a b']) {
    assert.throws(() => validateLinkUrl(url))
  }
})

test('writes scope updates to both the row and selected Environment', async () => {
  const calls = []
  const query = {
    eq(column, value) { calls.push(['eq', column, value]); return this },
    select(columns) { calls.push(['select', columns]); return this },
    single() { return Promise.resolve({ data: { id: first, x: 42 }, error: null }) },
  }
  const db = { from(table) { calls.push(['from', table]); return {
    update(patch) { calls.push(['update', patch]); return query },
  } } }
  await updateCanvasRow(db, 'resources', second, first, { x: 42 })
  assert.deepEqual(calls, [
    ['from', 'resources'], ['update', { x: 42 }], ['eq', 'id', first],
    ['eq', 'environment_id', second], ['select', '*'],
  ])
})

test('does not treat an unconfirmed delete as success', async () => {
  const query = {
    eq() { return this }, select() { return this },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) },
  }
  const db = { from() { return { delete() { return query } } } }
  await assert.rejects(deleteCanvasRow(db, 'sections', second, first), /Could not confirm deletion/)
})

test('reconciles an insert retry only with the same creator and Environment', async () => {
  const values = { id: first, environment_id: second, created_by: first, title: 'Draft' }
  const lookup = {
    select() { return this }, eq() { return this },
    maybeSingle() { return Promise.resolve({ data: values, error: null }) },
  }
  let call = 0
  const db = { from() { return ++call === 1 ? {
    insert() { return { select() { return { single() { return Promise.resolve({ data: null, error: { code: '23505' } }) } } } } },
  } : lookup } }
  assert.deepEqual(await insertCanvasRow(db, 'resources', values), values)
})
