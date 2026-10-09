import { useState } from 'react'
import WorkspaceBar from '../components/layout/WorkspaceBar.jsx'
import Avatar from '../components/profile/Avatar.jsx'
import { supabase } from '../lib/supabase.js'
import { recoveryReturnUrl } from '../utils/authFlow.js'
import { accountProviders, googleIdentity, profilePresentation, validateAvatarUrl, validateDisplayName, validateUsername } from '../utils/profile.js'
import { readTutorialStatus, resetTutorialStatus } from '../utils/onboarding.js'

function ProfileEditor({ user, profile, onSave }) {
  const presented = profilePresentation(user, profile)
  const google = googleIdentity(user)
  const [name, setName] = useState(presented.displayName)
  const [username, setUsername] = useState(profile.username || '')
  const [avatarUrl, setAvatarUrl] = useState(presented.avatarUrl || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(presented.avatarUrl || '')

  function preview(value) {
    setAvatarUrl(value)
    setSaved(false)
    try { setPreviewUrl(validateAvatarUrl(value) || '') }
    catch { setPreviewUrl('') }
  }

  async function save(event) {
    event.preventDefault()
    if (saving) return
    setError('')
    setSaved(false)
    let displayName
    let usernameValue
    let imageUrl
    try {
      displayName = validateDisplayName(name)
      usernameValue = validateUsername(username)
      imageUrl = validateAvatarUrl(avatarUrl)
    } catch (failure) { setError(failure.message); return }
    setSaving(true)
    try {
      await onSave({ displayName, username: usernameValue || '', avatarUrl: imageUrl || '' })
      setName(displayName)
      setUsername(usernameValue || '')
      setSaved(true)
    } catch (failure) { setError(failure.message || 'Could not save your profile.') }
    finally { setSaving(false) }
  }

  return <form className="settings-profile-form" onSubmit={save} aria-busy={saving}>
    <div className="settings-avatar-row">
      <Avatar name={name} url={previewUrl} className="settings-avatar" />
      <div><strong>Your picture</strong><p>Use a secure image link, your Google picture, or your initials.</p></div>
    </div>
    <label htmlFor="settings-name">Display name</label>
    <input id="settings-name" maxLength={100} value={name} onChange={(event) => { setName(event.target.value); setSaved(false) }} required />
    <label htmlFor="settings-username">Username</label>
    <input id="settings-username" autoCapitalize="none" autoComplete="username" maxLength={30}
      value={username} onChange={(event) => { setUsername(event.target.value); setSaved(false) }} />
    <small className="settings-username-hint">Optional. Others can invite you with @username.</small>
    <label htmlFor="settings-avatar-url">Picture URL</label>
    <input id="settings-avatar-url" type="url" inputMode="url" placeholder="https://…"
      value={avatarUrl} onChange={(event) => preview(event.target.value)} />
    <div className="settings-inline-actions">
      {google.avatarUrl && <button type="button" onClick={() => preview(google.avatarUrl)}>Use Google picture</button>}
      <button type="button" onClick={() => preview('')}>Use initials</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {saved && <p className="settings-success" role="status">Profile saved.</p>}
    <button className="settings-save" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
  </form>
}

function Settings({ user, profile, profileLoading, profileError, onRetryProfile, onSaveProfile,
  appearance, onAppearanceChange, onBack, onSignOut, onRestartTutorial }) {
  const [resetPending, setResetPending] = useState(false)
  const [resetNotice, setResetNotice] = useState('')
  const [resetError, setResetError] = useState('')
  const presented = profilePresentation(user, profile)
  const providers = accountProviders(user)
  const hasEmailPassword = providers.includes('Email and password')
  const joined = user.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(user.created_at)) : ''
  const tutorialStatus = readTutorialStatus(user.id)

  async function sendReset() {
    if (resetPending || !user.email) return
    setResetPending(true)
    setResetError('')
    setResetNotice('')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email,
        { redirectTo: recoveryReturnUrl(window.location) })
      if (error) throw error
      setResetNotice('If this account can reset its password, a link is on its way.')
    } catch { setResetError('Could not send a reset link right now. Please try again later.') }
    finally { setResetPending(false) }
  }

  function restartTutorial() {
    resetTutorialStatus(user.id)
    onRestartTutorial()
  }

  return <main className="settings-page" aria-label="Profile and settings">
    <WorkspaceBar environmentName="Settings" onBack={onBack} userEmail={user.email}
      avatarName={presented.displayName} avatarUrl={presented.avatarUrl} />
    <div className="settings-content">
      <span className="portal-kicker">Your Moseek</span>
      <h1>Profile and settings</h1>
      <p className="settings-intro">A few details to make this space yours.</p>

      <section className="settings-section" aria-labelledby="settings-profile-heading">
        <div className="settings-section-heading"><h2 id="settings-profile-heading">Profile</h2>
          <p>How you appear in Moseek.</p></div>
        <div className="settings-section-body">
          {profileLoading ? <p role="status">Opening your profile…</p>
            : profileError ? <div role="alert"><p>Could not load your profile: {profileError}</p>
              <button className="settings-text-button" type="button" onClick={onRetryProfile}>Try again</button></div>
              : profile ? <ProfileEditor user={user} profile={profile} onSave={onSaveProfile} />
                : <p role="status">Opening your profile…</p>}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-appearance-heading">
        <div className="settings-section-heading"><h2 id="settings-appearance-heading">Appearance</h2>
          <p>Choose how Moseek looks on this device.</p></div>
        <fieldset className="settings-appearance settings-section-body">
          <legend className="sr-only">Appearance mode</legend>
          {['light', 'dark', 'system'].map((mode) => <label key={mode} className={appearance === mode ? 'is-selected' : ''}>
            <input type="radio" name="appearance" value={mode} checked={appearance === mode}
              onChange={() => onAppearanceChange(mode)} />
            <span><strong>{mode[0].toUpperCase() + mode.slice(1)}</strong>
              <small>{mode === 'system' ? 'Follow this device' : `${mode[0].toUpperCase() + mode.slice(1)} colors`}</small></span>
          </label>)}
        </fieldset>
      </section>

      <section className="settings-section" aria-labelledby="settings-account-heading">
        <div className="settings-section-heading"><h2 id="settings-account-heading">Account</h2>
          <p>Your sign-in details.</p></div>
        <div className="settings-section-body settings-account">
          <div><span>Email</span><strong>{user.email || 'Not available'}</strong></div>
          {providers.length > 0 && <div><span>Sign-in methods</span><strong>{providers.join(', ')}</strong></div>}
          {joined && <div><span>Joined</span><strong>{joined}</strong></div>}
          {hasEmailPassword && <button className="settings-text-button" type="button" onClick={sendReset} disabled={resetPending}>
            {resetPending ? 'Sending reset link…' : 'Send password reset link'}</button>}
          {resetNotice && <p className="settings-success" role="status">{resetNotice}</p>}
          {resetError && <p className="form-error" role="alert">{resetError}</p>}
          <button className="settings-text-button" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-preferences-heading">
        <div className="settings-section-heading"><h2 id="settings-preferences-heading">Preferences</h2>
          <p>Your guide stays available.</p></div>
        <div className="settings-section-body">
          <p className="settings-preference-copy">Moseek guide: {tutorialStatus === 'completed' ? 'completed' : tutorialStatus === 'skipped' ? 'skipped' : 'ready to explore'}</p>
          <button className="settings-text-button" type="button" onClick={restartTutorial}>Restart the guide</button>
        </div>
      </section>
    </div>
  </main>
}

export default Settings
