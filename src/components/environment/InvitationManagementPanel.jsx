import { useCallback, useEffect, useState } from 'react'
import { Copy, Link2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'

const ROLES = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }
const WHEN = (value) => new Date(value).toLocaleDateString()

function InvitationManagementPanel({ environmentId, actorRole, onClose }) {
  const owner = actorRole === 'owner'
  const [invitations, setInvitations] = useState([])
  const [codes, setCodes] = useState([])
  const [requests, setRequests] = useState([])
  const [defaultCode, setDefaultCode] = useState(null)
  const [identifier, setIdentifier] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [newCode, setNewCode] = useState('')
  const [defaultPlaintext, setDefaultPlaintext] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [inviteResult, codeResult, requestResult, defaultCodeResult] = await Promise.all([
      supabase.rpc('list_environment_invitations', { p_environment_id: environmentId }),
      supabase.rpc('list_environment_invitation_codes', { p_environment_id: environmentId }),
      supabase.rpc('list_environment_join_requests', { p_environment_id: environmentId }),
      supabase.rpc('list_environment_default_invitation_code', { p_environment_id: environmentId }),
    ])
    const failure = inviteResult.error || codeResult.error || requestResult.error || defaultCodeResult.error
    if (failure) setError('Invitation details could not be loaded. Check your access and try again.')
    else {
      setInvitations(inviteResult.data || [])
      setCodes(codeResult.data || [])
      setRequests(requestResult.data || [])
      setDefaultCode(defaultCodeResult.data?.[0] || null)
    }
    setLoading(false)
  }, [environmentId])

  useEffect(() => {
    let active = true
    Promise.all([
      supabase.rpc('list_environment_invitations', { p_environment_id: environmentId }),
      supabase.rpc('list_environment_invitation_codes', { p_environment_id: environmentId }),
      supabase.rpc('list_environment_join_requests', { p_environment_id: environmentId }),
      supabase.rpc('list_environment_default_invitation_code', { p_environment_id: environmentId }),
    ]).then(([inviteResult, codeResult, requestResult, defaultCodeResult]) => {
      if (!active) return
      const failure = inviteResult.error || codeResult.error || requestResult.error || defaultCodeResult.error
      if (failure) setError('Invitation details could not be loaded. Check your access and try again.')
      else {
        setInvitations(inviteResult.data || []); setCodes(codeResult.data || []); setRequests(requestResult.data || [])
        setDefaultCode(defaultCodeResult.data?.[0] || null)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [environmentId])
  useEffect(() => {
    function escape(event) { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [busy, onClose])

  async function submitInvite(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice(''); setNewCode('')
    const result = await supabase.rpc('create_environment_invitation', {
      p_environment_id: environmentId, p_identifier: identifier.trim(), p_role: inviteRole,
    })
    if (result.error) setError('This invitation could not be created. Your access may have changed.')
    else { setNotice(result.data || 'If that account can be invited, an invitation will appear in its Moseek inbox.'); setIdentifier(''); await load() }
    setBusy(false)
  }

  async function createCode(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice(''); setNewCode('')
    const result = await supabase.rpc('create_environment_invitation_code', {
      p_environment_id: environmentId, p_role: 'editor', p_approval_required: true,
    }).maybeSingle()
    if (result.error || !result.data) setError('An invitation code could not be created. Your access may have changed.')
    else { setNewCode(result.data.invitation_code); setNotice(`Share this code privately. It expires ${WHEN(result.data.expires_at)}.`); await load() }
    setBusy(false)
  }

  async function callAction(name, args, success) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    const result = await supabase.rpc(name, args)
    if (result.error || !['accepted', 'declined', 'revoked', 'expired'].includes(result.data)) {
      setError('That change could not be completed. The invitation state or your access may have changed.')
    } else { setNotice(success); setNewCode(''); await load() }
    setBusy(false)
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(newCode); setNotice('Code copied. Share it only with people you trust.') }
    catch { setError('The code could not be copied. Select and copy it manually.') }
  }

  async function issueDefaultCode() {
    if (busy) return
    setBusy(true); setError(''); setNotice(''); setDefaultPlaintext('')
    const result = await supabase.rpc('reissue_environment_default_invitation_code', { p_environment_id: environmentId }).maybeSingle()
    if (result.error || !result.data) setError('A new sharing code could not be created. Your access may have changed.')
    else {
      setDefaultPlaintext(result.data.invitation_code)
      setNotice(`A new code is ready. It expires ${WHEN(result.data.expires_at)}. The previous default code no longer works.`)
      await load()
    }
    setBusy(false)
  }

  async function disableDefaultCode() {
    if (busy) return
    setBusy(true); setError(''); setNotice(''); setDefaultPlaintext('')
    const result = await supabase.rpc('disable_environment_default_invitation_code', { p_environment_id: environmentId })
    if (result.error || result.data !== 'disabled') setError('The default sharing code could not be disabled.')
    else { setNotice('The default sharing code is disabled.'); await load() }
    setBusy(false)
  }

  async function copyValue(value, message) {
    try { await navigator.clipboard.writeText(value); setNotice(message) }
    catch { setError('Copy failed. Select the value and copy it manually.') }
  }

  return <section className="invitation-panel" role="dialog" aria-modal="false" aria-labelledby="invitation-heading" aria-busy={loading || busy}>
    <div className="invitation-panel-heading">
      <div><span className="portal-kicker">Shared Environment</span><h2 id="invitation-heading">Invitations</h2></div>
      <button className="contributors-close" type="button" onClick={onClose} aria-label="Close invitations" disabled={busy}><X size={17} /></button>
    </div>
    <p className="contributors-intro">Invite people into this shared space, at a pace that feels right.</p>
    {error && <p className="contributors-feedback is-error" role="alert">{error}</p>}
    {notice && <p className="contributors-feedback" role="status">{notice}</p>}
    {newCode && <div className="invitation-new-code"><label htmlFor="generated-invitation-code">Seven-character code · shown once</label>
      <div><input id="generated-invitation-code" readOnly value={newCode} onFocus={(event) => event.target.select()} />
        <button type="button" onClick={copyCode} aria-label="Copy invitation code"><Copy size={15} /></button></div>
      <label htmlFor="generated-invitation-link">Shareable join link</label>
      <div><input id="generated-invitation-link" readOnly
        value={`${window.location.origin}${import.meta.env.BASE_URL}?join=${encodeURIComponent(newCode)}`}
        onFocus={(event) => event.target.select()} />
        <button type="button" onClick={() => copyValue(`${window.location.origin}${import.meta.env.BASE_URL}?join=${encodeURIComponent(newCode)}`, 'Join link copied.')}
          aria-label="Copy join link"><Link2 size={15} /></button></div>
    </div>}
    {loading ? <p className="contributors-loading" role="status">Loading invitations…</p> : <>
      <form className="invitation-form" onSubmit={submitInvite}>
        <h3>Invite an existing Moseek member</h3>
        <label htmlFor="invite-identifier">Email address or @username</label>
        <input id="invite-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} maxLength={320}
          placeholder="name@example.com or @name" autoComplete="off" required disabled={busy} />
        <div className="invitation-inline-controls"><label htmlFor="invite-role">Role</label>
          <select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} disabled={busy}>
            {(owner ? ['admin', 'editor', 'viewer'] : ['editor', 'viewer']).map((role) => <option key={role} value={role}>{ROLES[role]}</option>)}
          </select><button type="submit" disabled={busy || !identifier.trim()}>{busy ? 'Sending…' : 'Invite'}</button>
        </div>
        <small>People receive an invitation in Moseek when they next visit.</small>
      </form>
      {invitations.length > 0 && <section className="invitation-list-section"><h3>Pending invitations</h3><ul>
        {invitations.map((item) => <li key={item.invitation_id}><div><strong>{item.invitee_name}</strong><small>{ROLES[item.role]} · expires {WHEN(item.expires_at)}</small></div>
          <button type="button" onClick={() => callAction('revoke_environment_invitation', { p_invitation_id: item.invitation_id }, 'Invitation revoked.')}
            disabled={busy || (actorRole === 'admin' && item.role === 'admin')}>Revoke</button></li>)}
      </ul></section>}
      <form className="invitation-form invitation-code-form" onSubmit={createCode}>
        <h3>Make an invitation code</h3>
        <p>Seven-character codes expire after seven days. Each request waits for approval and joins as an Editor.</p>
        <div className="invitation-inline-controls"><span />
          <button type="submit" disabled={busy}>{busy ? 'Making…' : 'Create code'}</button></div>
      </form>
      <section className="invitation-code-form invitation-default-code" aria-labelledby="default-code-heading">
        <h3 id="default-code-heading">Default sharing code</h3>
        <p>{defaultCode?.state === 'active'
          ? `This seven-character Editor code always requires approval. It expires ${WHEN(defaultCode.expires_at)}.`
          : defaultCode?.state === 'disabled' ? 'This code is disabled.'
            : defaultCode?.state === 'expired' ? 'The previous code expired.'
              : 'A private seven-character Editor code is ready for this Shared Environment.'}</p>
        <div className="invitation-inline-controls">
          <button type="button" onClick={issueDefaultCode} disabled={busy}>
            {defaultCode?.state === 'active' ? 'Create a new code' : 'Create a code'}
          </button>
          {defaultCode?.state === 'active' && <button type="button" className="invitation-secondary-action"
            onClick={disableDefaultCode} disabled={busy}>Disable</button>}
        </div>
        {defaultPlaintext && <div className="invitation-new-code invitation-default-plaintext">
          <label htmlFor="default-sharing-code">New code · shown once</label>
          <div><input id="default-sharing-code" readOnly value={defaultPlaintext}
            onFocus={(event) => event.target.select()} />
            <button type="button" onClick={() => copyValue(defaultPlaintext, 'Code copied.')}
              aria-label="Copy new sharing code"><Copy size={15} /></button></div>
          <label htmlFor="default-sharing-link">Shareable join link</label>
          <div><input id="default-sharing-link" readOnly
            value={`${window.location.origin}${import.meta.env.BASE_URL}?join=${encodeURIComponent(defaultPlaintext)}`}
            onFocus={(event) => event.target.select()} />
            <button type="button" onClick={() => copyValue(
              `${window.location.origin}${import.meta.env.BASE_URL}?join=${encodeURIComponent(defaultPlaintext)}`,
              'Join link copied.')}
              aria-label="Copy shareable join link"><Link2 size={15} /></button></div>
        </div>}
        <small>Codes are stored as secure verifiers and expire after 90 days. Creating a new code replaces the old one.</small>
      </section>
      {codes.some((item) => !item.is_default) && <section className="invitation-list-section"><h3>Other invitation codes</h3><ul>
        {codes.filter((item) => !item.is_default).map((item) => <li key={item.code_id}><div><strong>{ROLES[item.role]} · approval required</strong>
          <small>{item.revoked_at ? 'Revoked' : item.expires_at <= new Date().toISOString() ? 'Expired' : `Expires ${WHEN(item.expires_at)}`}</small></div>
          {!item.revoked_at && item.expires_at > new Date().toISOString() && <button type="button" onClick={() => callAction('revoke_environment_invitation_code', { p_code_id: item.code_id }, 'Invitation code revoked.')}
            disabled={busy}>Revoke</button>}</li>)}
      </ul></section>}
      {requests.length > 0 && <section className="invitation-list-section"><h3>Requests to join</h3><ul>
        {requests.map((item) => <li key={item.request_id}><div><strong>{item.requester_name}</strong><small>{ROLES[item.role]} · expires {WHEN(item.expires_at)}</small></div>
          <div className="invitation-request-actions"><button type="button" onClick={() => callAction('respond_to_environment_join_request', { p_request_id: item.request_id, p_approve: true }, 'Request approved.')}
            disabled={busy || (actorRole === 'admin' && item.role === 'admin')}>Approve</button>
            <button type="button" onClick={() => callAction('respond_to_environment_join_request', { p_request_id: item.request_id, p_approve: false }, 'Request declined.')}
              disabled={busy}>Decline</button></div></li>)}
      </ul></section>}
    </>}
    <button className="invitation-retry" type="button" onClick={load} disabled={loading || busy}>Refresh</button>
  </section>
}

export default InvitationManagementPanel
