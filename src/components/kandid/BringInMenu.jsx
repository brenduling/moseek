import { useEffect, useRef } from 'react'
import { FileText, LayoutPanelTop, Link2, Paperclip } from 'lucide-react'

function BringInMenu({ onNote, onFile, onLink, onSection, onClose }) {
  const firstOptionRef = useRef(null)

  useEffect(() => { firstOptionRef.current?.focus() }, [])

  return (
    <section
      className="bring-in-popover"
      aria-label="Bring something in"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <h2>Bring something in</h2>
      <button className="bring-in-option" type="button" onClick={onNote} ref={firstOptionRef}>
        <FileText size={18} strokeWidth={1.7} aria-hidden="true" />
        <span><strong>Note</strong><small>Write something here</small></span>
      </button>
      <button className="bring-in-option" type="button" onClick={onFile}>
        <Paperclip size={18} strokeWidth={1.7} aria-hidden="true" />
        <span><strong>File</strong><small>Bring in something from your device</small></span>
      </button>
      <button className="bring-in-option" type="button" onClick={onLink}>
        <Link2 size={18} strokeWidth={1.7} aria-hidden="true" />
        <span><strong>Link</strong><small>Bring in something from elsewhere</small></span>
      </button>
      <button className="bring-in-option" type="button" onClick={onSection}>
        <LayoutPanelTop size={18} strokeWidth={1.7} aria-hidden="true" />
        <span><strong>Section</strong><small>Organize an area of this Environment</small></span>
      </button>
    </section>
  )
}

export default BringInMenu
