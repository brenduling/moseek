import assert from 'node:assert/strict'
import {
  ENVIRONMENT_DESCRIPTION_MAX_LENGTH,
  ENVIRONMENT_NAME_MAX_LENGTH,
  validateEnvironmentSettings,
} from '../src/lib/environmentSettings.js'

assert.deepEqual(validateEnvironmentSettings('  Research  ', '  Shared notes  '), {
  name: 'Research', description: 'Shared notes',
})
assert.deepEqual(validateEnvironmentSettings('Workspace', '   '), {
  name: 'Workspace', description: null,
})
assert.deepEqual(validateEnvironmentSettings('x'.repeat(ENVIRONMENT_NAME_MAX_LENGTH), 'y'.repeat(ENVIRONMENT_DESCRIPTION_MAX_LENGTH)), {
  name: 'x'.repeat(ENVIRONMENT_NAME_MAX_LENGTH), description: 'y'.repeat(ENVIRONMENT_DESCRIPTION_MAX_LENGTH),
})
assert.throws(() => validateEnvironmentSettings('  ', ''), /Give this Environment a name/)
assert.throws(() => validateEnvironmentSettings('x'.repeat(ENVIRONMENT_NAME_MAX_LENGTH + 1), ''), /up to 160 characters/)
assert.throws(() => validateEnvironmentSettings('Valid', 'y'.repeat(ENVIRONMENT_DESCRIPTION_MAX_LENGTH + 1)), /up to 2000 characters/)

console.log('PASS: Environment settings client validation (6 assertions)')
