import { useState } from 'react'
import { Ellipsis } from 'lucide-react'

function ResourceActions({ resource, onEdit, editLabel = 'Edit', onOpen, openLabel, onDelete,
  deleteLabel = 'Delete', confirmationTitle, confirmationMessage }) {
  const [view, setView] = useState('closed')
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const isFile = resource.createdType === 'file'
  const title = confirmationTitle || (isFile ? 'Remove file from Kandid?' : 'Remove from Kandid?')
  const message = confirmationMessage || (isFile
    ? 'The locally stored file will also be removed.'
    : 'This will remove this item from the Environment.')

  async function confirmRemove() {
    setRemoving(true)
    setError('')
    try {
      const removed = await onDelete(resource.id)
      if (removed === false) setRemoving(false)
    } catch {
      setError('This item could not be removed. Please try again.')
      setRemoving(false)
    }
  }

  return (
    <div
      className="resource-actions nodrag nopan"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          setView('closed')
        }
      }}
    >
      <button
        className="resource-more nodrag nopan"
        type="button"
        aria-label={`More actions for ${resource.name}`}
        aria-expanded={view !== 'closed'}
        onClick={() => setView(view === 'closed' ? 'menu' : 'closed')}
      >
        <Ellipsis size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {view === 'menu' && (
        <div className="resource-actions-popover" role="menu" aria-label={`Actions for ${resource.name}`}>
          {onEdit && <button type="button" role="menuitem" onClick={() => { setView('closed'); onEdit() }}>{editLabel}</button>}
          {onOpen && <button type="button" role="menuitem" onClick={() => { setView('closed'); onOpen(resource) }}>{openLabel}</button>}
          {onDelete && <button type="button" role="menuitem" onClick={() => setView('confirm')}>{deleteLabel}</button>}
        </div>
      )}
      {view === 'confirm' && (
        <div className="resource-actions-popover resource-remove-confirm" role="dialog" aria-label={title}>
          <strong>{title}</strong>
          <p>{message}</p>
          {error && <p className="resource-remove-error" role="alert">{error}</p>}
          <div className="resource-remove-buttons">
            <button type="button" onClick={() => setView('menu')} disabled={removing}>Cancel</button>
            <button type="button" onClick={confirmRemove} disabled={removing}>Remove</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ResourceActions
