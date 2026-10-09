import { useEffect, useRef, useState } from 'react'
import { NodeResizer } from '@xyflow/react'
import ResourceActions from './ResourceActions.jsx'

function KandidSectionNode({ id, data, selected }) {
  const section = data.section
  const [editing, setEditing] = useState(Boolean(data.startEditing))
  const [title, setTitle] = useState(section.title)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!editing) return undefined
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [editing])

  function finishEditing() {
    data.onRename(id, title.trim() || 'Untitled section')
    data.onEditingChange(id, false)
    setEditing(false)
  }

  function beginEditing() {
    data.onEditingChange(id, true)
    setEditing(true)
  }

  return (
    <div className={`kandid-section${selected ? ' is-selected' : ''}`}>
      <NodeResizer
        isVisible={selected && !editing}
        minWidth={360}
        minHeight={240}
        maxWidth={1400}
        maxHeight={1000}
        handleClassName="moseek-resizer-handle"
        lineClassName="moseek-resizer-line"
        onResizeEnd={(_event, params) => data.onResize(id, params)}
      />
      <div className="section-heading">
        {editing ? (
          <div className="section-editor nodrag nopan">
            <input
              ref={inputRef}
              className="nodrag nopan"
              aria-label="Section name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); finishEditing() }
              }}
            />
            <button className="nodrag nopan" type="button" onClick={finishEditing}>Done</button>
          </div>
        ) : <h2 title={section.title}>{section.title}</h2>}
      </div>
      {selected && !editing && (
        <ResourceActions
          resource={{ id, name: section.title }}
          onEdit={beginEditing}
          editLabel="Rename"
          onDelete={data.onDeleteSection}
          deleteLabel="Delete section"
          confirmationTitle="Remove this section?"
          confirmationMessage="The items inside will stay in Kandid."
        />
      )}
    </div>
  )
}

export default KandidSectionNode
