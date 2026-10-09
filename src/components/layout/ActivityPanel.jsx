import { useId, useState } from 'react'

const labels = {
  activity: "Here's what's happening",
  reminder: 'Just a reminder',
  upcoming: 'Coming up',
  invitation: 'An invitation',
  notification: 'A little heads-up',
}

function readExpanded(userId) {
  try {
    return localStorage.getItem(`moseek:activity-panel:expanded:v1:${userId}`) !== 'false'
  } catch {
    return true
  }
}

// Items are supplied by the parent in relevance order: { id, kind, title, detail? }.
function ActivityPanel({ userId, items = [], loading, error, onRetry }) {
  const [expanded, setExpanded] = useState(() => readExpanded(userId))
  const contentId = useId()
  const summary = loading
    ? 'Looking around your space…'
    : error
      ? 'This information could not be loaded'
      : items[0]?.title || 'All caught up for now'

  function toggle() {
    const next = !expanded
    setExpanded(next)
    try {
      localStorage.setItem(`moseek:activity-panel:expanded:v1:${userId}`, String(next))
    } catch {
      // The panel still works when browser storage is unavailable.
    }
  }

  return <aside className="activity-panel" aria-label="A little heads-up">
    <button
      className="activity-panel-toggle"
      type="button"
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={toggle}
    >
      <span className="activity-panel-title">A little heads-up</span>
      {!expanded && <span className="activity-panel-summary">{summary}</span>}
      <span className="activity-panel-chevron" aria-hidden="true" />
    </button>
    <div className="activity-panel-content" id={contentId} hidden={!expanded}>
      {loading ? <p className="activity-panel-copy" role="status">Looking around your space…</p>
        : error ? <div role="alert">
          <p className="activity-panel-copy">{error || 'This information could not be loaded.'}</p>
          {onRetry && <button className="activity-panel-text-action" type="button" onClick={onRetry}>Try again</button>}
        </div> : <>
          {items.length > 0 ? <div className="activity-panel-items">
            {items.map((item) => {
              const content = <>
                <span className="activity-panel-kind">{labels[item.kind] || labels.activity}</span>
                <p className="activity-panel-item-title">{item.title}</p>
                {item.detail && <p className="activity-panel-copy">{item.detail}</p>}
              </>
              return item.onOpen
                ? <button className="activity-panel-item activity-panel-item-link" type="button" key={item.id} onClick={item.onOpen}>{content}</button>
                : <div className="activity-panel-item" key={item.id}>{content}</div>
            })}
          </div> : <div className="activity-panel-caught-up">
            <p className="activity-panel-item-title">All caught up for now</p>
            <p className="activity-panel-copy">There's nothing new to share.</p>
          </div>}
        </>}
    </div>
  </aside>
}

export default ActivityPanel
