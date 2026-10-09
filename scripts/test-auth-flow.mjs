import assert from 'node:assert/strict'
import test from 'node:test'
import { authReturnMessage, authReturnUrl, oauthReturnError, passwordChecks, recoveryReturnUrl } from '../src/utils/authFlow.js'

test('password checks accept long passphrases without composition rules', () => {
  assert.deepEqual(passwordChecks('a long calm phrase', 'a long calm phrase'), { length: true, match: true })
  assert.deepEqual(passwordChecks('short', 'different'), { length: false, match: false })
})

test('auth redirects stay on the application origin and base path', () => {
  const location = { origin: 'https://moseek.example', search: '', hash: '' }
  assert.equal(authReturnUrl(location), 'https://moseek.example/')
  assert.equal(recoveryReturnUrl(location), 'https://moseek.example/?auth=recovery')
  assert.equal(oauthReturnError(location), false)
  assert.equal(oauthReturnError({ ...location, hash: '#error=access_denied' }), true)
})

test('expired and invalid auth redirects show recoverable messages', () => {
  const location = { search: '', hash: '#error=access_denied&error_code=otp_expired' }
  assert.match(authReturnMessage(location), /expired|already been used/)
  assert.match(authReturnMessage({ search: '?auth=recovery', hash: location.hash }), /reset link/)
  assert.match(authReturnMessage({ search: '?error=server_error', hash: '' }), /could not be used/)
  assert.equal(authReturnMessage({ search: '', hash: '' }), '')
})
