import assert from 'node:assert/strict'
import test from 'node:test'
import { COLORS, normalizeColor, readColor, saveColor } from '../src/utils/personalization.js'
import { classifyFile, linkIdentity } from '../src/utils/resourceIdentity.js'

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

test('curated colors are named and invalid values restore neutral', () => {
  assert.deepEqual(COLORS.map((color) => color.id), ['neutral', 'sage', 'sand', 'clay', 'mist'])
  assert.ok(COLORS.every((color) => color.name))
  assert.equal(normalizeColor('bright-red'), 'neutral')
})

test('color choices survive a new read and stay isolated by user, kind, and item', () => {
  const storage = memoryStorage()
  assert.equal(saveColor('user-a', 'note', 'note-1', 'sage', storage), true)
  assert.equal(readColor('user-a', 'note', 'note-1', storage), 'sage')
  assert.equal(readColor('user-b', 'note', 'note-1', storage), 'neutral')
  assert.equal(readColor('user-a', 'section', 'note-1', storage), 'neutral')
  assert.equal(saveColor('user-a', 'note', 'note-1', 'neutral', storage), true)
  assert.equal(readColor('user-a', 'note', 'note-1', storage), 'neutral')
  assert.equal(saveColor('user-a', 'link', 'note-1', 'sage', storage), false)
})

test('favicon derives only from a validated eligible site origin', () => {
  assert.deepEqual(linkIdentity('https://www.mozilla.org/deep/private?token=secret'), {
    hostname: 'www.mozilla.org', faviconUrl: 'https://www.mozilla.org/favicon.ico' })
  for (const link of ['javascript:alert(1)', 'https://localhost/secret', 'https://10.0.0.1/a',
    'http://www.mozilla.org/page', 'https://user:pass@mozilla.org']) {
    assert.equal(linkIdentity(link).faviconUrl, null)
  }
  assert.equal(linkIdentity('javascript:alert(1)').hostname, '')
})

test('file representations use MIME metadata with conservative fallbacks', () => {
  assert.equal(classifyFile({ mime_type: 'application/pdf', original_filename: 'file.bin' }).kind, 'pdf')
  assert.equal(classifyFile({ mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }).kind, 'document')
  assert.equal(classifyFile({ mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).kind, 'spreadsheet')
  assert.equal(classifyFile({ mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }).kind, 'presentation')
  assert.equal(classifyFile({ mime_type: 'image/png' }).kind, 'image')
  assert.equal(classifyFile({ mime_type: 'application/zip' }).kind, 'archive')
  assert.equal(classifyFile({ mime_type: 'application/octet-stream', original_filename: 'backup.zip' }).kind, 'archive')
  assert.equal(classifyFile({ mime_type: 'text/plain', original_filename: 'maybe.pdf' }).kind, 'file')
})
