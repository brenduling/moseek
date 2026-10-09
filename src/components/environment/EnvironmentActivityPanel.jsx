import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { ACTIVITY_TIME, MEANINGFUL_ACTIVITY_ACTIONS, activityDescription } from '../../utils/environmentActivity.js'

const PAGE_SIZE = 24
const WHEN = ACTIVITY_TIME

function EnvironmentActivityPanel({ environmentId, onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')

  const loadPage = useCallback(async (offset = 0) => {
    if (offset) setLoadingMore(true)
    else setLoading(true)
    setError('')
    const result = await supabase.from('environment_activity')
      .select('id,actor_name,action,target_type,target_label,metadata,occurred_at')
      .eq('environment_id', environmentId).in('action', MEANINGFUL_ACTIVITY_ACTIONS)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false }).range(offset, offset + PAGE_SIZE)
    if (result.error) setError('Activity could not be loaded. Check your access and try again.')
    else {
      const page = result.data || []
      setItems((current) => offset ? [...current, ...page.slice(0, PAGE_SIZE)] : page.slice(0, PAGE_SIZE))
      setHasMore(page.length > PAGE_SIZE)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [environmentId])

  useEffect(() => {
    const timer = window.setTimeout(() => { loadPage(0) }, 0)
    return () => window.clearTimeout(timer)
  }, [loadPage])
  useEffect(() => {
    function onKeyDown(event) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return <section id="environment-activity-panel" className="environment-activity-panel" role="dialog" aria-modal="false"
    aria-labelledby="environment-activity-title" aria-busy={loading || loadingMore}>
    <header className="environment-panel-heading">
      <div><span className="portal-kicker">This Environment</span><h2 id="environment-activity-title">Activity</h2></div>
      <button type="button" className="contributors-close" onClick={onClose} aria-label="Close activity"><X size={17} /></button>
    </header>
    {error ? <div className="environment-panel-empty" role="alert"><p>{error}</p>
      <button type="button" onClick={() => loadPage(0)}>Try again</button></div>
      : loading ? <p className="environment-panel-empty" role="status">Looking through recent changes…</p>
        : items.length === 0 ? <p className="environment-panel-empty">Nothing here yet. Activity will appear as this Environment changes.</p>
          : <>
            <ol className="environment-activity-list">
              {items.map((item) => <li key={item.id}>
                <span className="environment-activity-dot" aria-hidden="true" />
                <div className="environment-activity-entry">
                  <p><strong>{item.actor_name}</strong> {activityDescription(item)}</p>
                  {item.target_label && <p className="environment-activity-target">{item.target_label}</p>}
                  {item.metadata?.to_role && <p className="environment-activity-target">Now {item.metadata.to_role}</p>}
                  {item.metadata?.to_status && <p className="environment-activity-target">{item.metadata.to_status.replace('_', ' ')}</p>}
                  <time dateTime={item.occurred_at}>{WHEN.format(new Date(item.occurred_at))}</time>
                </div>
              </li>)}
            </ol>
            {hasMore && <button type="button" className="environment-panel-more" onClick={() => loadPage(items.length)} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load older activity'}
            </button>}
          </>}
  </section>
}

export default EnvironmentActivityPanel
