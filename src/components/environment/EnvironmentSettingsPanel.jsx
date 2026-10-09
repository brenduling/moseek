import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { canManageEnvironmentContributors } from '../../lib/environmentPermissions.js'
import { ENVIRONMENT_DESCRIPTION_MAX_LENGTH, ENVIRONMENT_NAME_MAX_LENGTH,
  validateEnvironmentSettings } from '../../lib/environmentSettings.js'

function EnvironmentSettingsPanel({ environment, role, onClose, onSaved, onOpenContributors, onOpenInvitations }) {
  const canEdit = canManageEnvironmentContributors(role)
  const [name, setName] = useState(environment.name)
  const [description, setDescription] = useState(environment.description || '')
  const [selectedType, setSelectedType] = useState(environment.type)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [invalidField, setInvalidField] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmingType, setConfirmingType] = useState('')
  const [conversionBlocker, setConversionBlocker] = useState('')
  const [blockerMembers, setBlockerMembers] = useState([])
  const [blockerInvitations, setBlockerInvitations] = useState([])
  const [blockerCodes, setBlockerCodes] = useState([])
  const [blockerRequests, setBlockerRequests] = useState([])
  const [blockerLoading, setBlockerLoading] = useState(false)
  const [blockerError, setBlockerError] = useState('')
  const cancelButtonRef = useRef(null)
  const typeActionRef = useRef(null)
  const confirmationRef = useRef(null)
  const wasConfirmingRef = useRef(false)
  const isOwner = role === 'owner'
  const typeLabel = environment.type === 'personal' ? 'Personal' : 'Shared'

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape' && !saving) {
        if (confirmingType) setConfirmingType('')
        else onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [confirmingType, onClose, saving])

  useEffect(() => {
    if (confirmingType) {
      wasConfirmingRef.current = true
      cancelButtonRef.current?.focus()
    } else if (wasConfirmingRef.current) {
      wasConfirmingRef.current = false
      typeActionRef.current?.focus()
    }
  }, [confirmingType])

  const changed = name.trim() !== environment.name
    || (description.trim() || null) !== (environment.description || null)

  async function save(event) {
    event.preventDefault()
    if (!canEdit || saving) return
    setError('')
    setInvalidField('')
    setNotice('')

    let values
    try {
      values = validateEnvironmentSettings(name, description)
    } catch (failure) {
      setError(failure.message)
      setInvalidField(failure.message.includes('name') ? 'name' : 'description')
      return
    }

    if (!changed) return
    setSaving(true)
    try {
      const result = await supabase.from('environments').update(values)
        .eq('id', environment.id)
        .select('id,name,description,type,created_by,created_at,updated_at').maybeSingle()
      if (result.error) {
        setError(result.error.code === '23514'
          ? 'Check the name and description lengths, then try again.'
          : 'These Environment details could not be saved. Your permissions or access may have changed.')
        return
      }
      if (!result.data) {
        setError('These Environment details could not be saved. Your permissions or access may have changed.')
        return
      }
      onSaved(result.data)
      setName(result.data.name)
      setDescription(result.data.description || '')
      setNotice('Changes saved.')
    } catch {
      setError('These Environment details could not be saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function convertType() {
    if (!isOwner || saving || !confirmingType || confirmingType === environment.type) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await supabase.rpc('convert_environment_type', {
        p_environment_id: environment.id,
        p_target_type: confirmingType,
      }).single()
      if (result.error || !result.data) {
        const code = result.error?.code
        if (code === '23514') {
          if (result.error.message?.includes('contributors')) {
            setConversionBlocker('contributors')
            setError('This Shared Environment still has other contributors. No one was removed.')
            setBlockerLoading(true)
            setBlockerError('')
            try {
              const members = await supabase.from('environment_members').select('user_id,role')
                .eq('environment_id', environment.id).order('role')
              if (members.error) throw members.error
              const ids = members.data.map((member) => member.user_id)
              const profiles = ids.length
                ? await supabase.from('profiles').select('id,display_name').in('id', ids)
                : { data: [], error: null }
              if (profiles.error) throw profiles.error
              const names = new Map((profiles.data || []).map((profile) => [profile.id, profile.display_name]))
              setBlockerMembers(members.data.map((member) => ({
                ...member, name: names.get(member.user_id) || 'Moseek member', isOwner: member.role === 'owner',
              })))
            } catch {
              setBlockerError('Contributor names could not be loaded. Open contributor management to review access.')
            } finally { setBlockerLoading(false) }
          } else {
            setConversionBlocker('invitations')
            setError('Resolve pending invitations, active codes, and join requests before changing this Environment to Personal.')
          setBlockerLoading(true)
          setBlockerError('')
          try {
            const [invitations, codes, requests] = await Promise.all([
              supabase.rpc('list_environment_invitations', { p_environment_id: environment.id }),
              supabase.rpc('list_environment_invitation_codes', { p_environment_id: environment.id }),
              supabase.rpc('list_environment_join_requests', { p_environment_id: environment.id }),
            ])
            if (invitations.error || codes.error || requests.error) throw new Error('Could not load invitation details.')
            setBlockerInvitations(invitations.data || [])
            setBlockerCodes((codes.data || []).filter((code) => !code.revoked_at && code.expires_at > new Date().toISOString()))
            setBlockerRequests(requests.data || [])
          } catch {
            setBlockerError('Invitation details could not be loaded. Open invitation management to review them.')
          } finally { setBlockerLoading(false) }
          }
        } else if (code === '40P01' || code === '40001' || code === '55P03') {
          setError('Membership changed while this was being saved. Refresh the contributor list and try again.')
        } else if (code === '42501') {
          setError('Your access changed. Only this Environment’s Owner can change its type.')
        } else {
          setError('The Environment type could not be changed. Check your connection and try again.')
        }
        return
      }
      onSaved(result.data)
      setSelectedType(result.data.type)
      setConfirmingType('')
      setNotice(`This Environment is now ${result.data.type === 'personal' ? 'Personal' : 'Shared'}.`)
    } catch {
      setError('The Environment type could not be changed. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return <section id="environment-settings-panel" className="environment-settings-panel" role="dialog" aria-modal="false"
    aria-labelledby="environment-settings-heading" aria-describedby="environment-settings-intro"
    aria-busy={saving}>
    <div className="environment-settings-heading">
      <div><span className="portal-kicker">Environment</span><h2 id="environment-settings-heading">Settings</h2></div>
      <button className="environment-settings-close" type="button" onClick={onClose} autoFocus={!canEdit}
        aria-label="Close Environment settings" disabled={saving}>
        <X size={17} aria-hidden="true" />
      </button>
    </div>
    <p id="environment-settings-intro" className="environment-settings-intro">
      Details for this space.
    </p>
    {isOwner ? <fieldset className="environment-settings-type" disabled={saving}>
      <legend>Environment type</legend>
      <label className={selectedType === 'personal' ? 'is-selected' : ''}>
        <input type="radio" name="environment-type" value="personal" checked={selectedType === 'personal'}
          onChange={() => { setSelectedType('personal'); setError(''); setNotice(''); setConversionBlocker('') }} />
        <span><strong>Personal</strong><small>Only you can access this space.</small></span>
      </label>
      <label className={selectedType === 'shared' ? 'is-selected' : ''}>
        <input type="radio" name="environment-type" value="shared" checked={selectedType === 'shared'}
          onChange={() => { setSelectedType('shared'); setError(''); setNotice(''); setConversionBlocker('') }} />
        <span><strong>Shared</strong><small>Contributors can work here with you.</small></span>
      </label>
      <button className="environment-settings-type-action" type="button"
        ref={typeActionRef}
        onClick={() => setConfirmingType(selectedType)} disabled={saving || selectedType === environment.type}>
        Change to {selectedType === 'personal' ? 'Personal' : 'Shared'}
      </button>
    </fieldset> : <div className="environment-settings-type environment-settings-type-readonly">
      <span>Environment type</span><strong>{typeLabel}</strong>
      <small>Only the Owner can change this.</small>
    </div>}
    {error && !confirmingType && <p id="environment-settings-error" className="environment-settings-feedback is-error" role="alert">{error}</p>}
    {notice && <p className="environment-settings-feedback" role="status">{notice}</p>}
    {saving && <p className="environment-settings-feedback" role="status">Saving changes…</p>}

    {canEdit ? <form className="environment-settings-form" onSubmit={save}>
      <label htmlFor="environment-settings-name">Name</label>
      <input id="environment-settings-name" type="text" autoFocus required maxLength={ENVIRONMENT_NAME_MAX_LENGTH}
        value={name} onChange={(event) => { setName(event.target.value); setError(''); setInvalidField(''); setNotice('') }}
        aria-invalid={invalidField === 'name' || undefined}
        aria-describedby={invalidField === 'name' ? 'environment-settings-error' : undefined} disabled={saving} />
      <label htmlFor="environment-settings-description">Description</label>
      <textarea id="environment-settings-description" rows={5} maxLength={ENVIRONMENT_DESCRIPTION_MAX_LENGTH}
        value={description} onChange={(event) => { setDescription(event.target.value); setError(''); setInvalidField(''); setNotice('') }}
        aria-invalid={invalidField === 'description' || undefined}
        aria-describedby={invalidField === 'description' ? 'environment-settings-error' : undefined} disabled={saving} />
      <div className="environment-settings-form-footer">
        <span>{description.length}/{ENVIRONMENT_DESCRIPTION_MAX_LENGTH}</span>
        <button type="submit" disabled={saving || !changed}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form> : <dl className="environment-settings-readonly">
      <div><dt>Name</dt><dd>{environment.name}</dd></div>
      <div><dt>Description</dt><dd>{environment.description || 'No description.'}</dd></div>
    </dl>}
    {confirmingType && <div className="environment-type-confirmation-backdrop">
      <section className="environment-type-confirmation" ref={confirmationRef} role="alertdialog" aria-modal="true"
        aria-labelledby="environment-type-confirm-title" aria-describedby="environment-type-confirm-description"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const controls = confirmationRef.current?.querySelectorAll('button:not(:disabled)')
          if (!controls?.length) return
          if (event.shiftKey && document.activeElement === controls[0]) {
            event.preventDefault()
            controls[controls.length - 1].focus()
          } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
            event.preventDefault()
            controls[0].focus()
          }
        }}>
        <h3 id="environment-type-confirm-title">
          Change this Environment to {confirmingType === 'personal' ? 'Personal' : 'Shared'}?
        </h3>
        <p id="environment-type-confirm-description">
          {confirmingType === 'shared'
            ? 'People can be added as contributors. Your sections, resources, positions, and colors will stay in place.'
            : 'Only you can remain in a Personal Environment. Contributors are never removed automatically.'}
        </p>
        {error && <p className="environment-settings-feedback is-error" role="alert">{error}</p>}
        {conversionBlocker === 'contributors' && <div className="environment-conversion-blocker">
          <strong>Current contributors</strong>
          {blockerLoading ? <p role="status">Loading contributors…</p>
            : blockerError ? <p role="alert">{blockerError}</p>
              : <ul className="environment-conversion-list">{blockerMembers.map((member) => <li key={member.user_id}>
                <div className="environment-conversion-identity"><strong>{member.name}</strong>
                  {member.isOwner && <small className="environment-conversion-owner-note">You</small>}</div>
                <span className="environment-conversion-role"><span className="visually-hidden">Role: </span>{member.role[0].toUpperCase() + member.role.slice(1)}</span>
              </li>)}</ul>}
          <button className="environment-conversion-manage" type="button" onClick={onOpenContributors} disabled={blockerLoading}>Manage contributors</button>
        </div>}
        {conversionBlocker === 'invitations' && <div className="environment-conversion-blocker">
          <strong>Resolve these first</strong>
          {blockerLoading ? <p role="status">Checking invitations…</p>
            : blockerError ? <p role="alert">{blockerError}</p> : <ul className="environment-conversion-list">
              {blockerInvitations.map((invitation) => <li key={`invitation-${invitation.invitation_id}`}>
                <div className="environment-conversion-identity"><strong>{invitation.invitee_name}</strong><small>Pending invitation</small></div>
                <span className="environment-conversion-role"><span className="visually-hidden">Role: </span>{invitation.role[0].toUpperCase() + invitation.role.slice(1)}</span>
              </li>)}
              {blockerCodes.map((code) => <li key={`code-${code.code_id}`}>
                <div className="environment-conversion-identity"><strong>Invitation code</strong>
                  <small>{code.approval_required ? 'Approval required' : 'Direct join'} · expires {new Date(code.expires_at).toLocaleDateString()}</small></div>
                <span className="environment-conversion-role"><span className="visually-hidden">Role: </span>{code.role[0].toUpperCase() + code.role.slice(1)}</span>
              </li>)}
              {blockerRequests.map((request) => <li key={`request-${request.request_id}`}>
                <div className="environment-conversion-identity"><strong>{request.requester_name}</strong><small>Request to join</small></div>
                <span className="environment-conversion-role"><span className="visually-hidden">Role: </span>{request.role[0].toUpperCase() + request.role.slice(1)}</span>
              </li>)}
              {!blockerInvitations.length && !blockerCodes.length && !blockerRequests.length &&
                <li><div className="environment-conversion-identity"><strong>Invitation state changed</strong><small>Refresh settings and try again.</small></div></li>}
            </ul>}
          <button className="environment-conversion-manage" type="button" onClick={onOpenInvitations} disabled={blockerLoading}>Manage invitations</button>
        </div>}
        <div className="environment-type-confirm-actions">
          <button type="button" className="environment-type-cancel" ref={cancelButtonRef}
            onClick={() => setConfirmingType('')}
            disabled={saving}>Cancel</button>
          <button type="button" className="environment-type-confirm"
            onClick={convertType} disabled={saving || Boolean(conversionBlocker)}>
            {saving ? 'Changing…' : `Change to ${confirmingType === 'personal' ? 'Personal' : 'Shared'}`}
          </button>
        </div>
      </section>
    </div>}
  </section>
}

export default EnvironmentSettingsPanel
