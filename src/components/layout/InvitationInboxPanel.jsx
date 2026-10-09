import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'

const ROLES = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }

function InvitationInboxPanel({ onClose, onAccepted, onCodeConsumed, initialCode = '' }) {
  const [items, setItems] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [code, setCode] = useState(() => normalizeCode(initialCode))

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const [invitationResult, requestResult] = await Promise.all([
      supabase.rpc('list_my_environment_invitations'),
      supabase.rpc('list_my_environment_join_requests'),
    ])
    if (invitationResult.error || requestResult.error) setError('Your invitations could not be loaded. Try again in a moment.')
    else { setItems(invitationResult.data || []); setRequests(requestResult.data || []) }
    setLoading(false)
  }, [])
  useEffect(() => {
    let active = true
    Promise.all([supabase.rpc('list_my_environment_invitations'), supabase.rpc('list_my_environment_join_requests')]).then(([result, requestResult]) => {
      if (!active) return
      if (result.error || requestResult.error) setError('Your invitations could not be loaded. Try again in a moment.')
      else { setItems(result.data || []); setRequests(requestResult.data || []) }
      setLoading(false)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    function escape(event) { if (event.key === 'Escape' && !busyId) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [busyId, onClose])

  async function respond(item, accept) {
    setBusyId(item.invitation_id); setError(''); setNotice('')
    const result = await supabase.rpc('respond_to_environment_invitation', {
      p_invitation_id: item.invitation_id, p_accept: accept,
    })
    const state = result.data
    if (result.error || !['accepted', 'declined', 'expired', 'revoked', 'unavailable'].includes(state)) {
      setError('This invitation could not be updated. It may have expired or been revoked.')
    } else if (state === 'accepted') {
      setNotice(`You joined ${item.environment_name}.`)
    } else if (state === 'declined') setNotice('Invitation declined.')
    else setNotice('This invitation is no longer available.')
    await load()
    setBusyId('')
    if (state === 'accepted') onAccepted?.(item.environment_id)
  }

  async function redeemCode(event) {
    event.preventDefault()
    if (busyId || !code.trim()) return
    setBusyId('code'); setError(''); setNotice('')
    const normalizedCode = normalizeCode(code)
    const result = await supabase.rpc('redeem_environment_invitation_code', { p_code: normalizedCode })
    if (result.error) setError('This code could not be checked. Try again later.')
    else if (result.data === 'approval_pending') {
      setNotice('Pending approval. An Owner or Admin will review your request.')
      setCode('')
      onCodeConsumed?.()
      await load()
    } else if (result.data === 'already_joined') setNotice('You already have access to this Environment.')
    else if (result.data === 'rate_limited') setError('Too many attempts. Please wait a little before trying another code.')
    else setError('This code is invalid, expired, or no longer available.')
    setBusyId('')
  }

  async function cancelRequest(requestId) {
    setBusyId(requestId); setError(''); setNotice('')
    const result = await supabase.rpc('respond_to_environment_join_request', {
      p_request_id: requestId, p_approve: false,
    })
    if (result.error || !['declined', 'expired', 'revoked', 'unavailable'].includes(result.data)) {
      setError('This request could not be updated. Refresh and try again.')
    } else setNotice('Request withdrawn.')
    await load()
    setBusyId('')
  }

  function normalizeCode(value) { return value.trim().toUpperCase().slice(0, 64) }

  const requestStatus = { pending: 'Pending approval', accepted: 'Approved · You joined', declined: 'Not approved',
    expired: 'Expired', revoked: 'No longer available' }

  return <section id="invitation-inbox-panel" className="invitation-panel invitation-inbox-panel" role="dialog" aria-modal="false"
    aria-labelledby="invitation-inbox-heading" aria-busy={loading || Boolean(busyId)}>
    <div className="invitation-panel-heading"><div><span className="portal-kicker">For you</span>
      <h2 id="invitation-inbox-heading">Invitations</h2></div>
      <button className="contributors-close" type="button" onClick={onClose} aria-label="Close invitations" disabled={Boolean(busyId)}><X size={17} /></button></div>
    <p className="contributors-intro">A quiet place to review invitations to shared spaces.</p>
    {error && <p className="contributors-feedback is-error" role="alert">{error}</p>}
    {notice && <p className="contributors-feedback" role="status">{notice}</p>}
    {loading ? <p className="contributors-loading" role="status">Checking your invitations…</p>
      : items.length === 0 ? <p className="contributors-loading">No invitations waiting for you.</p>
        : <ul className="invitation-inbox-list">{items.map((item) => <li key={item.invitation_id}>
          <div><strong>{item.environment_name}</strong><small>From {item.inviter_name} · {item.role} · expires {new Date(item.expires_at).toLocaleDateString()}</small></div>
          <div className="invitation-request-actions"><button type="button" onClick={() => respond(item, true)} disabled={Boolean(busyId)}>
            {busyId === item.invitation_id ? 'Saving…' : 'Accept'}</button>
            <button type="button" onClick={() => respond(item, false)} disabled={Boolean(busyId)}>Decline</button></div>
        </li>)}</ul>}
    <form className="invitation-form" onSubmit={redeemCode}>
      <h3>Have an invitation code?</h3>
      <label htmlFor="redeem-invitation-code">Enter your code</label>
        <input id="redeem-invitation-code" value={code} onChange={(event) => setCode(normalizeCode(event.target.value))} maxLength={64}
        pattern="(?:[A-HJ-NP-Z2-9]{7}|[A-F0-9]{64})"
        autoComplete="off" spellCheck="false" autoCapitalize="characters" aria-describedby="redeem-code-help" disabled={Boolean(busyId)} />
      <small id="redeem-code-help">New codes have seven characters. Older active codes remain usable until they expire.</small>
      <div className="invitation-inline-controls"><span />
        <button type="submit" disabled={Boolean(busyId) || !code.trim()}>{busyId === 'code' ? 'Checking…' : 'Use code'}</button>
      </div>
    </form>
    {requests.length > 0 && <section className="invitation-list-section" aria-labelledby="my-join-requests-heading">
      <h3 id="my-join-requests-heading">Your join requests</h3>
      <ul className="invitation-inbox-list">{requests.map((request) => <li key={request.request_id}>
        <div><strong>{request.environment_name}</strong><small>{requestStatus[request.status] || 'Request status unavailable'} · {ROLES[request.role]}</small></div>
        {request.status === 'pending' && <button type="button" onClick={() => cancelRequest(request.request_id)} disabled={Boolean(busyId)}>Withdraw</button>}
      </li>)}</ul>
    </section>}
    <button className="invitation-retry" type="button" onClick={load} disabled={loading || Boolean(busyId)}>Refresh</button>
  </section>
}

export default InvitationInboxPanel
