import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAppearance, readAppearance, rememberAppearanceUser, resolveAppearance,
  saveAppearance } from '../src/utils/appearance.js'
import { accountProviders, initialProfilePatch, profilePresentation,
  validateAvatarUrl, validateDisplayName } from '../src/utils/profile.js'

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

test('appearance resolves all modes and follows system only when selected', () => {
  assert.equal(resolveAppearance('light', true), 'light')
  assert.equal(resolveAppearance('dark', false), 'dark')
  assert.equal(resolveAppearance('system', true), 'dark')
  assert.equal(resolveAppearance('system', false), 'light')
  const root = { dataset: {}, style: {} }
  assert.equal(applyAppearance('system', root, { matches: true }), 'dark')
  assert.equal(root.dataset.theme, 'dark')
  assert.equal(root.style.colorScheme, 'dark')
})

test('appearance preference is isolated by authenticated user', () => {
  const storage = memoryStorage()
  assert.equal(readAppearance('a', storage), 'system')
  assert.equal(saveAppearance('a', 'dark', storage), true)
  assert.equal(saveAppearance('b', 'light', storage), true)
  assert.equal(readAppearance('a', storage), 'dark')
  assert.equal(readAppearance('b', storage), 'light')
  assert.equal(readAppearance(null, storage), 'system')
  assert.equal(saveAppearance('a', 'invalid', storage), false)
  rememberAppearanceUser('a', storage)
  assert.equal(storage.getItem('moseek:last-user-id:v1'), 'a')
  rememberAppearanceUser(null, storage)
  assert.equal(storage.getItem('moseek:last-user-id:v1'), null)
})

test('Google metadata initializes only an untouched default profile', () => {
  const user = { email: 'mariel@example.com', app_metadata: { providers: ['google', 'email'] },
    user_metadata: { full_name: 'Mariel Reyes', avatar_url: 'https://example.com/photo.png' } }
  const profile = { display_name: 'Moseek member', avatar_url: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
  assert.deepEqual(initialProfilePatch(user, profile), {
    display_name: 'Mariel Reyes', avatar_url: 'https://example.com/photo.png' })
  assert.equal(profilePresentation(user, profile).displayName, 'Mariel Reyes')
  assert.deepEqual(accountProviders(user), ['Google', 'Email and password'])
  const customized = { ...profile, display_name: 'My chosen name', avatar_url: null,
    updated_at: '2026-01-02T00:00:00Z' }
  assert.deepEqual(initialProfilePatch(user, customized), {})
  assert.deepEqual(profilePresentation(user, customized), { displayName: 'My chosen name', avatarUrl: '' })
})

test('profile inputs respect existing column constraints', () => {
  assert.equal(validateDisplayName('  A long name  '), 'A long name')
  assert.throws(() => validateDisplayName(' '))
  assert.throws(() => validateDisplayName('x'.repeat(101)))
  assert.equal(validateAvatarUrl(''), null)
  assert.equal(validateAvatarUrl('https://example.com/a.png'), 'https://example.com/a.png')
  assert.throws(() => validateAvatarUrl('javascript:alert(1)'))
  assert.throws(() => validateAvatarUrl('http://example.com/a.png'))
})
