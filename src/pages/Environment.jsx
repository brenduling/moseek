import { useEffect, useState } from 'react'
import WorkspaceBar from '../components/layout/WorkspaceBar.jsx'
import EnvironmentCanvas from '../components/environment/EnvironmentCanvas.jsx'
import { supabase } from '../lib/supabase.js'
import { ensureEnvironmentRows, isEnvironmentId } from '../utils/environmentCanvas.js'
import { profilePresentation } from '../utils/profile.js'
import { SERVER_COLORS_ENABLED } from '../lib/serverColors.js'

const SECTION_COLUMNS = 'id, environment_id, title, x, y, width, height, created_by, updated_at'
const RESOURCE_COLUMNS = 'id, environment_id, section_id, type, title, body, url, original_filename, mime_type, file_size, x, y, width, height, created_by, updated_at'

function Environment({ environmentId, user, profile, onLeave, onSignOut, onOpenSettings, onOpenEnvironment }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState({ status: 'loading' })
  const validId = isEnvironmentId(environmentId)

  useEffect(() => {
    if (!validId) return
    let active = true

    async function load() {
      try {
        const { data: environment, error: environmentError } = await supabase.from('environments')
          .select('id, name, description, type, created_by').eq('id', environmentId).maybeSingle()
        if (environmentError) throw environmentError
        if (!environment) {
          if (active) setResult({ status: 'unavailable' })
          return
        }
        const [membershipResult, sectionsResult, resourcesResult] = await Promise.all([
          supabase.from('environment_members').select('role').eq('environment_id', environmentId).eq('user_id', user.id).maybeSingle(),
          supabase.from('sections').select(SECTION_COLUMNS + (SERVER_COLORS_ENABLED ? ', card_color' : '')).eq('environment_id', environmentId),
          supabase.from('resources').select(RESOURCE_COLUMNS + (SERVER_COLORS_ENABLED ? ', card_color' : '')).eq('environment_id', environmentId),
        ])
        if (membershipResult.error) throw membershipResult.error
        if (sectionsResult.error) throw sectionsResult.error
        if (resourcesResult.error) throw resourcesResult.error
        if (!membershipResult.data) {
          if (active) setResult({ status: 'unavailable' })
          return
        }
        const sections = ensureEnvironmentRows(environmentId, sectionsResult.data)
        const resources = ensureEnvironmentRows(environmentId, resourcesResult.data)
        if (active) setResult({ status: 'ready', environment, role: membershipResult.data.role, sections, resources })
      } catch (error) {
        if (active) setResult({ status: 'error', message: error.message || 'Could not load this Environment.' })
      }
    }

    load()
    return () => { active = false }
  }, [environmentId, user.id, attempt, validId])

  if (validId && result.status === 'ready') {
    return <EnvironmentCanvas key={environmentId} environment={result.environment} role={result.role}
      sections={result.sections} resources={result.resources} user={user} profile={profile}
      onLeave={onLeave} onSignOut={onSignOut} onOpenSettings={onOpenSettings} onOpenEnvironment={onOpenEnvironment} />
  }

  const unavailable = !validId || result.status === 'unavailable'
  return <main className="spatial-home environment-open">
    <WorkspaceBar onBack={onLeave} onSignOut={onSignOut} onOpenSettings={onOpenSettings}
      userEmail={user.email} avatarName={profilePresentation(user, profile).displayName}
      avatarUrl={profilePresentation(user, profile).avatarUrl} />
    <section className="environment-open-message" role={unavailable || result.status === 'error' ? 'alert' : 'status'}>
      <span className="portal-kicker">Environment</span>
      <h1>{unavailable ? 'This space is unavailable.' : result.status === 'error' ? 'Could not open this space.' : 'Opening your space…'}</h1>
      {unavailable && <p>It may have been deleted, or you may no longer have access.</p>}
      {result.status === 'error' && <><p>{result.message}</p><button className="environment-retry" type="button" onClick={() => { setResult({ status: 'loading' }); setAttempt((value) => value + 1) }}>Try again</button></>}
    </section>
  </main>
}

export default Environment
