
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const localOnly = import.meta.env.MODE === 'local-test'

if (localOnly) {
  let apiOrigin = ''
  try { apiOrigin = new URL(url).origin } catch { /* report the same local-only configuration error below */ }
  if (apiOrigin !== 'http://127.0.0.1:54321') {
    throw new Error('Local-only mode stopped: VITE_SUPABASE_URL must be http://127.0.0.1:54321. Start Moseek with `npm run dev:local`.')
  }
  if (!key) throw new Error('Local-only mode stopped: the local Supabase publishable key is missing. Start Moseek with `npm run dev:local`.')
}

export const supabase = url && key ? createClient(url, key) : null
