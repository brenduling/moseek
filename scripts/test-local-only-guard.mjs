import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
const previous = new Map(envKeys.map((key) => [key, process.env[key]]))
let server

try {
  // A reserved, non-routable URL proves the guard without making any request.
  process.env.VITE_SUPABASE_URL = 'https://example.invalid'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'local-guard-test-placeholder'
  server = await createServer({
    configFile: resolve(projectRoot, 'vite.config.js'),
    root: projectRoot,
    mode: 'local-test',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  try {
    await server.ssrLoadModule('/src/lib/supabase.js')
    throw new Error('Local-only mode unexpectedly accepted a non-local Supabase URL.')
  } catch (error) {
    if (!String(error.message).includes('Local-only mode stopped: VITE_SUPABASE_URL')) throw error
    console.log('Local-only URL guard: PASS (non-local URL rejected before Supabase client creation; no request made).')
  }
} finally {
  if (server) await server.close()
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
