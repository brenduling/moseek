import { useEffect, useRef, useState } from 'react'
import { Palette } from 'lucide-react'
import { COLORS } from '../../utils/personalization.js'
import { SERVER_COLORS_ENABLED } from '../../lib/serverColors.js'

function ColorPicker({ value, onChange, itemName }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const feedbackTimer = useRef(null)
  const toggleRef = useRef(null)

  useEffect(() => () => clearTimeout(feedbackTimer.current), [])

  async function choose(color) {
    if (saving) return
    setSaving(true)
    setError('')
    setFeedback('')
    try {
      await onChange(color)
      setOpen(false)
      toggleRef.current?.focus()
      setFeedback('Saved')
      clearTimeout(feedbackTimer.current)
      feedbackTimer.current = setTimeout(() => setFeedback(''), 2200)
    } catch (failure) {
      setError(failure.message || 'Could not save this color.')
    } finally { setSaving(false) }
  }

  return <div className="color-picker nodrag nopan" onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); toggleRef.current?.focus() }
    }}>
    <button ref={toggleRef} type="button" className="color-picker-toggle nodrag nopan" aria-label={`Choose color for ${itemName}`}
      aria-expanded={open} onClick={() => setOpen((current) => !current)} title="Choose color">
      <Palette size={15} strokeWidth={1.7} aria-hidden="true" />
    </button>
    {feedback && <span className="color-picker-feedback" role="status">{feedback}</span>}
    {open && <div className="color-picker-options" role="group" aria-label={`Color for ${itemName}`}>
      {COLORS.map((color) => <button type="button" key={color.id} data-color={color.id}
        aria-label={color.name} aria-pressed={value === color.id} title={color.name} disabled={saving}
        onClick={() => choose(color.id)}>
        <span className="color-picker-swatch" aria-hidden="true" />
        <span>{color.name}</span>
      </button>)}
      {saving && <small role="status">Saving…</small>}
      {error && <small className="color-picker-error" role="alert">{error}</small>}
      <small>{SERVER_COLORS_ENABLED ? 'Saved with your space' : 'Saved on this device'}</small>
    </div>}
  </div>
}

export default ColorPicker
