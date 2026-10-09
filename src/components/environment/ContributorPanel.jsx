import { useEffect, useState } from 'react'
import { Mail, X } from 'lucide-react'
import Avatar from '../profile/Avatar.jsx'
import { supabase } from '../../lib/supabase.js'
import { canChangeContributorRole, canRemoveContributor, contributorRoleOptions } from '../../lib/contributorPermissions.js'

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }

function ContributorPanel({ environmentId, actorId, actorRole, onClose, onManageInvitations }) {
  const [status, setStatus] = useState('loading')
  const [contributors, setContributors] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyUser, setBusyUser] = useState('')
  const [confirmRemove, setConfirmRemove] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    async function loadContributors() {
      setStatus('loading')
      setError('')
      setNotice('')
      const membershipResult = await supabase.from('environment_members')
        .select('environment_id,user_id,role,joined_at')
        .eq('environment_id', environmentId).order('joined_at', { ascending: true })
      if (membershipResult.error) {
        if (active) { setError('Contributor details could not be loaded. Your access may have changed.'); setStatus('error') }
        return
      }
      const ids = membershipResult.data.map((item) => item.user_id)
      const profileResult = ids.length
        ? await supabase.from('profiles').select('id,display_name,avatar_url').in('id', ids)
        : { data: [], error: null }
      if (profileResult.error) {
        if (active) { setError('Contributor names could not be loaded. Try again in a moment.'); setStatus('error') }
        return
      }
      const profiles = new Map((profileResult.data || []).map((profile) => [profile.id, profile]))
      if (active) {
        setContributors(membershipResult.data.map((item) => ({ ...item, profile: profiles.get(item.user_id) || null })))
        setStatus('ready')
      }
    }
    loadContributors()
    return () => { active = false }
  }, [environmentId, reload])

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  async function changeRole(member, role) {
    if (busyUser || role === member.role || !canChangeContributorRole(actorRole, member.role, actorId, member.user_id)) return
    setBusyUser(member.user_id)
    setError('')
    setNotice('')
    const result = await supabase.from('environment_members').update({ role })
      .eq('environment_id', environmentId).eq('user_id', member.user_id)
      .select('environment_id,user_id,role').maybeSingle()
    setBusyUser('')
    if (result.error || !result.data) {
      setError('That role could not be changed. Your permissions or this membership may have changed.')
      setReload((value) => value + 1)
      return
    }
    setNotice(`${member.profile?.display_name || 'Contributor'} is now ${ROLE_LABELS[result.data.role]}.`)
    setReload((value) => value + 1)
  }

  async function removeContributor(member) {
    if (busyUser || !canRemoveContributor(actorRole, member.role, actorId, member.user_id)) return
    setBusyUser(member.user_id)
    setError('')
    setNotice('')
    const result = await supabase.from('environment_members').delete()
      .eq('environment_id', environmentId).eq('user_id', member.user_id)
      .select('user_id').maybeSingle()
    setBusyUser('')
    setConfirmRemove('')
    if (result.error || !result.data) {
      setError('This contributor could not be removed. Your permissions or this membership may have changed.')
      setReload((value) => value + 1)
      return
    }
    setNotice(`${member.profile?.display_name || 'Contributor'} was removed from this Environment.`)
    setReload((value) => value + 1)
  }

  return <section id="environment-contributors-panel" className="contributors-panel" aria-labelledby="contributors-heading" aria-busy={status === 'loading' || Boolean(busyUser)}>
    <div className="contributors-panel-heading">
      <div><span className="portal-kicker">Shared Environment</span><h2 id="contributors-heading">Contributors</h2></div>
      <button className="contributors-close" type="button" onClick={onClose} aria-label="Close contributors panel" disabled={Boolean(busyUser)}>
        <X size={17} aria-hidden="true" />
      </button>
    </div>
    <p className="contributors-intro">People who can see this shared space.</p>
    {onManageInvitations && <button className="manage-invitations-link" type="button" onClick={onManageInvitations}>
      <Mail size={15} aria-hidden="true" /> Manage invitations
    </button>}
    {error && <p className="contributors-feedback is-error" role="alert">{error}</p>}
    {notice && <p className="contributors-feedback" role="status">{notice}</p>}
    {status === 'loading' && <p className="contributors-loading" role="status">Loading contributors…</p>}
    {status === 'error' && <button className="contributors-retry" type="button" onClick={() => setReload((value) => value + 1)}>Try again</button>}
    {status === 'ready' && <ul className="contributors-list">
      {contributors.map((member) => {
        const name = member.profile?.display_name || 'Moseek member'
        const roleOptions = contributorRoleOptions(actorRole, member.role)
        const canRemove = canRemoveContributor(actorRole, member.role, actorId, member.user_id)
        const canManage = canChangeContributorRole(actorRole, member.role, actorId, member.user_id)
        return <li className="contributor-row" key={member.user_id}>
          <div className="contributor-main">
            <Avatar name={name} url={member.profile?.avatar_url || ''} />
            <div className="contributor-identity">
              <strong>{name}{member.user_id === actorId ? ' · You' : ''}</strong>
              <span className="contributor-role-label">{ROLE_LABELS[member.role] || 'Member'}</span>
            </div>
          </div>
          {canManage && <div className="contributor-actions">
            {roleOptions.length > 0 && <label className="visually-hidden" htmlFor={`contributor-role-${member.user_id}`}>Change {name}'s role</label>}
            {roleOptions.length > 0 && <select id={`contributor-role-${member.user_id}`} value={member.role}
              disabled={Boolean(busyUser)} onChange={(event) => changeRole(member, event.target.value)}>
              {roleOptions.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>}
            {canRemove && (confirmRemove === member.user_id
              ? <div className="contributor-remove-confirm" aria-label={`Confirm removing ${name}`}>
                <button type="button" className="contributor-remove-confirm-button" onClick={() => removeContributor(member)} disabled={Boolean(busyUser)}
                  aria-label={`Confirm removing ${name}`}>Remove?</button>
                <button type="button" onClick={() => setConfirmRemove('')} disabled={Boolean(busyUser)}
                  aria-label={`Cancel removing ${name}`}>Cancel</button>
              </div>
              : <button type="button" className="contributor-remove" onClick={() => setConfirmRemove(member.user_id)} disabled={Boolean(busyUser)}
                aria-label={`Remove ${name}`}>Remove</button>)}
          </div>}
        </li>
      })}
    </ul>}
    {status === 'ready' && contributors.length === 0 && <p className="contributors-loading">No contributors are available.</p>}
  </section>
}

export default ContributorPanel
