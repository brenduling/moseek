import { useEffect, useRef, useState } from 'react'
import { StickyNote } from 'lucide-react'
import ResourceActions from './ResourceActions.jsx'

function EditableNoteNode({ data, selected }) {
  const resource = data.resource
  const [editing, setEditing] = useState(Boolean(data.startEditing))
  const [title, setTitle] = useState(resource.name)
  const [body, setBody] = useState(resource.body || '')
  const titleRef = useRef(null)

  useEffect(() => {
    if (!editing) return undefined

    const focusTimer = window.setTimeout(() => {
      titleRef.current?.focus()
      if (data.startEditing) titleRef.current?.select()
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [editing, data.startEditing])

  function finishEditing() {
    data.onUpdate(resource.id, { name: title.trim() || 'Untitled note', body })
    data.onEditingChange(resource.id, false)
    setEditing(false)
  }

  function beginEditing() {
    data.onEditingChange(resource.id, true)
    setEditing(true)
  }

  function handleShortcut(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      finishEditing()
    }
  }

  return (
    <article className={`kandid-resource kandid-resource-note editable-note${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`}>
      <div className="kandid-resource-type">
        <StickyNote size={17} strokeWidth={1.75} aria-hidden="true" />
        <span>Note</span>
      </div>
      {editing ? (
        <div className="note-editor nodrag nopan" onKeyDown={handleShortcut}>
          <input
            ref={titleRef}
            className="nodrag nopan"
            type="text"
            aria-label="Note title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            className="nodrag nopan"
            aria-label="Note body"
            placeholder="Write here..."
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <button className="note-done nodrag nopan" type="button" onClick={finishEditing}>Done</button>
        </div>
      ) : (
        <>
          <h3 title={resource.name}>{resource.name}</h3>
          <p className="note-body-preview">{resource.body || 'Nothing here yet.'}</p>
        </>
      )}
      {selected && !editing && (
        <ResourceActions resource={resource} onEdit={beginEditing} onDelete={data.onDelete} />
      )}
    </article>
  )
}

export default EditableNoteNode
