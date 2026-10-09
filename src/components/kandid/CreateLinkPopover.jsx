import { useEffect, useRef, useState } from 'react'
import { recognizeLink } from '../../utils/linkRecognition.js'

function CreateLinkPopover({ onCreate, onCancel }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSubmit(event) {
    event.preventDefault()
    try {
      onCreate(recognizeLink(url))
    } catch (validationError) {
      setError(validationError.message)
    }
  }

  return (
    <section
      className="bring-in-popover link-popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby="link-popover-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <h2 id="link-popover-title">Paste a link</h2>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="new-resource-url">URL</label>
        <input
          ref={inputRef}
          id="new-resource-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="https://..."
          value={url}
          onChange={(event) => { setUrl(event.target.value); setError('') }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'link-url-error' : undefined}
        />
        {error && <p id="link-url-error" className="link-error" role="alert">{error}</p>}
        <div className="link-popover-actions">
          <button className="link-cancel" type="button" onClick={onCancel}>Cancel</button>
          <button className="link-submit" type="submit">Bring it in</button>
        </div>
      </form>
    </section>
  )
}

export default CreateLinkPopover
