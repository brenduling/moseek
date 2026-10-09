import assert from 'node:assert/strict'
import test from 'node:test'
import { checkedColor, ColorConflictError, loadEnvironmentColors,
  preferenceColor, setEnvironmentColor, setSharedColor } from '../src/lib/serverColors.js'

const userId = '11111111-1111-4111-8111-111111111111'
const environmentId = '22222222-2222-4222-8222-222222222222'
const rowId = '33333333-3333-4333-8333-333333333333'
const timestamp = '2026-10-08T00:00:00Z'

function queryDb(result) {
  const calls = []
  const query = {
    select(columns) { calls.push(['select', columns]); return this },
    eq(column, value) { calls.push(['eq', column, value]); return this },
    maybeSingle() { return Promise.resolve(result) },
    single() { return Promise.resolve(result) },
    then(resolve) { return Promise.resolve(result).then(resolve) },
  }
  return { calls, db: { from(table) { calls.push(['from', table]); return {
    select: query.select.bind(query),
    update(patch) { calls.push(['update', patch]); return query },
    insert(values) { calls.push(['insert', values]); return query },
  } } } }
}

test('server colors preserve explicit neutral and reject unexpected values', () => {
  assert.equal(preferenceColor({}, environmentId), 'neutral')
  assert.equal(preferenceColor({ [environmentId]: { card_color: 'neutral' } }, environmentId), 'neutral')
  assert.equal(checkedColor('sage'), 'sage')
  assert.throws(() => checkedColor('purple'), /not supported/)
})

test('preference read checks the authenticated user and maps by Environment', async () => {
  const row = { user_id: userId, environment_id: environmentId, card_color: 'mist', updated_at: timestamp }
  const { db, calls } = queryDb({ data: [row], error: null })
  assert.deepEqual(await loadEnvironmentColors(db, userId), { [environmentId]: row })
  assert.deepEqual(calls.slice(0, 3), [['from', 'environment_color_preferences'],
    ['select', 'user_id, environment_id, card_color, updated_at'], ['eq', 'user_id', userId]])
  const other = queryDb({ data: [{ ...row, user_id: 'other' }], error: null })
  await assert.rejects(loadEnvironmentColors(other.db, userId), /did not match/)
})

test('personal color insert is scoped; update checks the observed version', async () => {
  const row = { user_id: userId, environment_id: environmentId, card_color: 'sage', updated_at: timestamp }
  const inserted = queryDb({ data: row, error: null })
  assert.deepEqual(await setEnvironmentColor(inserted.db, userId, environmentId, null, 'sage'), row)
  assert.deepEqual(inserted.calls.slice(0, 2), [['from', 'environment_color_preferences'],
    ['insert', { user_id: userId, environment_id: environmentId, card_color: 'sage' }]])
  const updated = queryDb({ data: { ...row, card_color: 'sand' }, error: null })
  await setEnvironmentColor(updated.db, userId, environmentId, row, 'sand')
  assert.deepEqual(updated.calls.slice(0, 5), [['from', 'environment_color_preferences'],
    ['update', { card_color: 'sand' }], ['eq', 'user_id', userId],
    ['eq', 'environment_id', environmentId], ['eq', 'updated_at', timestamp]])
  const stale = queryDb({ data: null, error: null })
  await assert.rejects(setEnvironmentColor(stale.db, userId, environmentId, row, 'clay'), ColorConflictError)
})

test('shared writes are scoped to the item, Environment, and observed version', async () => {
  const row = { id: rowId, environment_id: environmentId, type: 'note', card_color: 'neutral', updated_at: timestamp }
  const { db, calls } = queryDb({ data: { ...row, card_color: 'clay' }, error: null })
  await setSharedColor(db, 'note', environmentId, row, 'clay')
  assert.deepEqual(calls.slice(0, 5), [['from', 'resources'], ['update', { card_color: 'clay' }],
    ['eq', 'id', rowId], ['eq', 'environment_id', environmentId], ['eq', 'updated_at', timestamp]])
  await assert.rejects(setSharedColor(db, 'link', environmentId, row, 'sage'), /cannot be recolored/)
  await assert.rejects(setSharedColor(db, 'note', environmentId, { ...row, type: 'link' }, 'sage'), /cannot be recolored/)
  const stale = queryDb({ data: null, error: null })
  await assert.rejects(setSharedColor(stale.db, 'section', environmentId, row, 'mist'), ColorConflictError)
})
