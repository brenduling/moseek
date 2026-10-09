import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Send, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'

const PAGE_SIZE = 30
const MESSAGE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })

function SectionDiscussionBox({ discussion, userId, role, sectionTitle, onClose, onRemove, onRead }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState('connecting')
  const listRef = useRef(null)
  const nearBottomRef = useRef(true)
  const firstLoadRef = useRef(true)
  const previousHeightRef = useRef(null)
  const canSend = ['owner', 'admin', 'editor'].includes(role)

  const loadPage = useCallback(async (beforeId = null) => {
    if (beforeId) {
      previousHeightRef.current = listRef.current?.scrollHeight ?? null
      setLoadingOlder(true)
    }
    else setLoading(true)
    setError('')
    const result = await supabase.rpc('list_section_discussion_messages', {
      p_discussion_id: discussion.id, p_before_id: beforeId, p_limit: PAGE_SIZE,
    })
    if (result.error) setError('Messages could not be loaded. Check your Environment access and try again.')
    else {
      const page = result.data || []
      setMessages((current) => {
        const byId = new Map(current.map((message) => [Number(message.message_id), message]))
        page.forEach((message) => byId.set(Number(message.message_id), message))
        return [...byId.values()].sort((a, b) => Number(a.message_id) - Number(b.message_id))
      })
      setHasOlder(page.length === PAGE_SIZE)
    }
    setLoading(false)
    setLoadingOlder(false)
  }, [discussion.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { loadPage() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadPage])

  useEffect(() => {
    const topic = `moseek-section-discussion:${discussion.id}`
    const channel = supabase.channel(topic, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'section_discussion_messages',
        filter: `discussion_id=eq.${discussion.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const message = payload.new
          setMessages((current) => current.some((item) => Number(item.message_id) === Number(message.id))
            ? current : [...current, { message_id: message.id, discussion_id: message.discussion_id,
              sender_id: message.sender_id, sender_name: message.sender_name, body: message.body, created_at: message.created_at }]
              .sort((a, b) => Number(a.message_id) - Number(b.message_id)))
          if (nearBottomRef.current) requestAnimationFrame(() => {
            if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
          })
          onRead?.(discussion.id, message.created_at)
        } else if (payload.eventType === 'DELETE') {
          const deletedId = Number(payload.old?.id)
          setMessages((current) => current.filter((item) => Number(item.message_id) !== deletedId))
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnection('connected')
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setConnection('offline')
      })
    return () => { supabase.removeChannel(channel) }
  }, [discussion.id, onRead])

  useLayoutEffect(() => {
    if (!listRef.current || loading || loadingOlder) return
    if (firstLoadRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
      nearBottomRef.current = true
      firstLoadRef.current = false
    } else if (previousHeightRef.current != null) {
      listRef.current.scrollTop += listRef.current.scrollHeight - previousHeightRef.current
      previousHeightRef.current = null
    } else if (nearBottomRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, loading, loadingOlder])

  function handleScroll() {
    const element = listRef.current
    if (!element) return
    nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
  }

  async function send(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || sending || !canSend) return
    setSending(true)
    setError('')
    const result = await supabase.rpc('send_section_discussion_message', {
      p_discussion_id: discussion.id, p_body: body,
    })
    const row = result.data?.[0]
    if (result.error) setError(result.error.code === '42501'
      ? 'You no longer have permission to send messages here.'
      : 'This message could not be sent. Try again in a moment.')
    else if (row?.status === 'rate_limited') setError('Please wait a moment before sending another message.')
    else if (!row?.message_id) setError('This message could not be confirmed. Refresh the discussion and try again.')
    else {
      setMessages((current) => current.some((item) => Number(item.message_id) === Number(row.message_id))
        ? current : [...current, row].sort((a, b) => Number(a.message_id) - Number(b.message_id)))
      setDraft('')
      onRead?.(discussion.id, row.created_at)
    }
    setSending(false)
  }

  async function removeMessage(message) {
    if (!window.confirm('Remove this message?')) return
    setError('')
    const result = await supabase.rpc('delete_section_discussion_message', { p_message_id: message.message_id })
    if (result.error || result.data !== 'removed') setError('This message could not be removed. Refresh and try again.')
    else setMessages((current) => current.filter((item) => item.message_id !== message.message_id))
  }

  async function removeDiscussion() {
    if (!window.confirm('Remove this Discussion Box and its messages?')) return
    await onRemove?.(discussion.id)
  }

  return <section className="section-discussion-box nodrag nopan" role="dialog" aria-modal="false"
    aria-label={`${sectionTitle} Discussion`} aria-busy={loading || sending}
    onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}
    onTouchStart={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
    <header className="section-discussion-heading">
      <div><strong>Discussion</strong><span>{connection === 'connected' ? 'Live' : connection === 'offline' ? 'Reconnecting' : 'Connecting'}</span></div>
      <div className="section-discussion-heading-actions">
        {role === 'owner' && <button type="button" onClick={removeDiscussion} aria-label="Remove Discussion Box"><Trash2 size={14} /></button>}
        <button type="button" onClick={onClose} aria-label="Close Discussion"><X size={15} /></button>
      </div>
    </header>
    {error && <p className="section-discussion-error" role="alert">{error}</p>}
    {hasOlder && <button type="button" className="section-discussion-older" onClick={() => loadPage(messages[0]?.message_id)} disabled={loadingOlder}>
      {loadingOlder ? 'Loading…' : 'Load earlier messages'}
    </button>}
    <ol className="section-discussion-messages" ref={listRef} onScroll={handleScroll} aria-label="Messages">
      {loading ? <li className="section-discussion-empty" role="status">Loading messages…</li>
        : messages.length === 0 ? <li className="section-discussion-empty">No messages yet. You can start here.</li>
          : messages.map((message) => <li className="section-discussion-message" key={message.message_id}>
            <div className="section-discussion-message-meta"><strong>{message.sender_name}</strong>
              <time dateTime={message.created_at}>{MESSAGE_TIME.format(new Date(message.created_at))}</time></div>
            <p>{message.body}</p>
            {(message.sender_id === userId || role === 'owner') && <button type="button" className="section-discussion-delete"
              onClick={() => removeMessage(message)}>Remove message</button>}
          </li>)}
    </ol>
    {canSend ? <form className="section-discussion-composer" onSubmit={send}>
      <label className="visually-hidden" htmlFor={`discussion-message-${discussion.id}`}>Write a message</label>
      <textarea id={`discussion-message-${discussion.id}`} value={draft} maxLength={2000} rows={2}
        placeholder="Write a message…" onChange={(event) => setDraft(event.target.value)} disabled={sending} />
      <button type="submit" aria-label="Send message" disabled={sending || !draft.trim()}><Send size={15} /></button>
    </form> : <p className="section-discussion-read-only">You can read this conversation.</p>}
  </section>
}

export default SectionDiscussionBox
