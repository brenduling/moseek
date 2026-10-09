import assert from 'node:assert/strict'
import test from 'node:test'
import { canAdvanceTutorial, readTutorialStatus, saveTutorialStatus, tutorialSteps } from '../src/utils/onboarding.js'

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('tutorial status is scoped to each authenticated user', () => {
  const storage = memoryStorage()
  assert.equal(readTutorialStatus('user-a', storage), 'new')
  assert.equal(saveTutorialStatus('user-a', 'completed', storage), true)
  assert.equal(readTutorialStatus('user-a', storage), 'completed')
  assert.equal(readTutorialStatus('user-b', storage), 'new')
  assert.equal(saveTutorialStatus('user-b', 'skipped', storage), true)
  assert.equal(readTutorialStatus('user-b', storage), 'skipped')
  assert.equal(saveTutorialStatus('user-b', 'unknown', storage), false)
  assert.equal(readTutorialStatus('user-b', storage), 'skipped')
})

test('tutorial remains usable when browser storage is unavailable', () => {
  const storage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(readTutorialStatus('user-a', storage), 'new')
  assert.equal(saveTutorialStatus('user-a', 'completed', storage), false)
})

test('interactive steps wait for the matching practice action', () => {
  assert.equal(tutorialSteps.length, 9)
  const actions = new Set()
  assert.equal(canAdvanceTutorial('environment', actions), true)
  for (const [step, action] of [
    ['create', 'created'], ['navigate', 'navigated'], ['section', 'section'],
    ['note', 'noteEdited'], ['link', 'link'], ['move', 'moved'],
  ]) {
    assert.equal(canAdvanceTutorial(step, actions), false)
    actions.add(action)
    assert.equal(canAdvanceTutorial(step, actions), true)
  }
  assert.equal(canAdvanceTutorial('saving', actions), true)
  assert.equal(canAdvanceTutorial('home', actions), true)
})
