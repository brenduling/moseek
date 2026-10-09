import { useRef, useState } from 'react'
import { authReturnUrl, passwordChecks, recoveryReturnUrl } from '../../utils/authFlow.js'

function PasswordFields({ password, setPassword, confirmation, setConfirmation, showConfirm = false, disabled }) {
  const [visible, setVisible] = useState(false)
  const checks = passwordChecks(password, confirmation)
  return <>
    <label htmlFor="auth-password">Password</label>
    <div className="auth-password-wrap">
      <input id="auth-password" type={visible ? 'text' : 'password'} autoComplete={showConfirm ? 'new-password' : 'current-password'}
        value={password} onChange={(event) => setPassword(event.target.value)} disabled={disabled} required />
      <button type="button" className="auth-visibility" onClick={() => setVisible((value) => !value)}
        aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>{visible ? 'Hide' : 'Show'}</button>
    </div>
    {showConfirm && <>
      <p className={`auth-criterion${checks.length ? ' is-met' : ''}`}>At least 12 characters. Longer passphrases are welcome.</p>
      <label htmlFor="auth-confirm">Confirm password</label>
      <input id="auth-confirm" type={visible ? 'text' : 'password'} autoComplete="new-password"
        value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={disabled} required />
      <p className={`auth-criterion${checks.match ? ' is-met' : ''}`}>Passwords match.</p>
    </>}
  </>
}

function AuthScreen({ supabase, initialMode = 'signin', initialError = '', onRecovered,
  onExitRecovery = () => {}, onSignupPending = () => {} }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState('')
  const [error, setError] = useState(initialError)
  const [notice, setNotice] = useState('')
  const pendingRef = useRef(false)
  const busy = Boolean(pending)

  function changeMode(next) {
    if (pendingRef.current) return
    if (next === 'signin') onExitRecovery()
    setMode(next)
    setError('')
    setNotice('')
    setPassword('')
    setConfirmation('')
  }

  async function perform(label, action) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(label)
    setError('')
    setNotice('')
    try { await action() }
    catch (failure) { setError(failure.message || 'Something went wrong. Please try again.') }
    finally { pendingRef.current = false; setPending('') }
  }

  async function submit(event) {
    event.preventDefault()
    const address = email.trim()
    if (mode === 'signin') return perform('Signing in…', async () => {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: address, password })
      if (authError) throw new Error('Could not sign in. Check your details, or verify your email if you recently joined.')
    })
    if (mode === 'signup') return perform('Creating your account…', async () => {
      const checks = passwordChecks(password, confirmation)
      if (!checks.length || !checks.match) throw new Error('Use at least 12 characters and make sure the passwords match.')
      onSignupPending(true)
      try {
        const { data, error: authError } = await supabase.auth.signUp({ email: address, password,
          options: { emailRedirectTo: authReturnUrl(window.location) } })
        if (authError) throw authError
        if (data.session) {
          const { error: signOutError } = await supabase.auth.signOut()
          if (signOutError) throw new Error('Email confirmation is disabled. Sign out and enable it in Supabase before continuing.')
          throw new Error('Email confirmation must be enabled in Supabase before registration can continue.')
        }
        setPassword('')
        setConfirmation('')
        setMode('confirmation-sent')
        setNotice('If this address already has an account, sign in instead.')
      } finally {
        onSignupPending(false)
      }
    })
    if (mode === 'confirm-again') return perform('Sending confirmation link…', async () => {
      const { error: authError } = await supabase.auth.resend({ type: 'signup', email: address,
        options: { emailRedirectTo: authReturnUrl(window.location) } })
      if (authError) throw new Error('A new link could not be sent yet. Please wait a moment and try again.')
      setMode('confirmation-sent')
      setNotice('If this email is awaiting confirmation, use the latest link in your inbox.')
    })
    if (mode === 'forgot') return perform('Sending reset link…', async () => {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(address,
        { redirectTo: recoveryReturnUrl(window.location) })
      if (authError) throw new Error('We could not process that request right now. Please try again shortly.')
      setMode('sent')
      setNotice('If an account exists for this email, a password reset link is on its way.')
    })
    if (mode === 'recovery') return perform('Updating password…', async () => {
      const checks = passwordChecks(password, confirmation)
      if (!checks.length || !checks.match) throw new Error('Use at least 12 characters and make sure the passwords match.')
      const { error: authError } = await supabase.auth.updateUser({ password })
      if (authError) throw authError
      setPassword('')
      setConfirmation('')
      onRecovered()
    })
  }

  function google() {
    perform('Opening Google…', async () => {
      const { error: authError } = await supabase.auth.signInWithOAuth({ provider: 'google',
        options: { redirectTo: authReturnUrl(window.location) } })
      if (authError) throw new Error('Could not open Google sign-in. Please try again.')
    })
  }

  const titles = { signin: 'Welcome back.', signup: 'Make room for your work.',
    'confirmation-sent': 'Check your inbox.', 'confirm-again': 'Need a new link?',
    forgot: 'Find your way back.', sent: 'Check your inbox.', recovery: 'Choose a new password.' }
  const descriptions = { signin: 'Sign in to open your Environments.', signup: 'Your first space starts here.',
    'confirmation-sent': `Check ${email.trim()} for a confirmation link, then follow it to open Moseek.`,
    'confirm-again': 'Enter the email you used to register.',
    forgot: 'We’ll send a reset link if this email has an account.',
    sent: 'If this email has an account, a reset link is on its way.', recovery: 'Set a new password for your account.' }
  const label = { signin: 'Sign in', signup: 'Create account', 'confirm-again': 'Send confirmation link',
    forgot: 'Send reset link', recovery: 'Update password' }

  return <main className="auth-screen">
    <div className="auth-wordmark">moseek</div>
    <section className="auth-panel" aria-busy={busy}>
      <span className="portal-kicker">Your workspace</span>
      <h1>{titles[mode]}</h1>
      <p>{descriptions[mode]}</p>
      {mode !== 'sent' && mode !== 'confirmation-sent' && <form onSubmit={submit}>
        {mode !== 'recovery' && <><label htmlFor="auth-email">Email</label>
          <input id="auth-email" type="email" autoComplete="email" value={email}
            onChange={(event) => setEmail(event.target.value)} disabled={busy} required /></>}
        {(mode === 'signin' || mode === 'signup' || mode === 'recovery') && <PasswordFields
          password={password} setPassword={setPassword} confirmation={confirmation} setConfirmation={setConfirmation}
          showConfirm={mode !== 'signin'} disabled={busy} />}
        <button className="auth-primary" type="submit" disabled={busy}>{pending || label[mode]}</button>
      </form>}
      {pending && <p className="auth-progress" role="status"><span className="auth-spinner" aria-hidden="true" />{pending}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      {mode === 'confirmation-sent' && <div className="auth-secondary-actions">
        <button type="button" onClick={() => changeMode('confirm-again')} disabled={busy}>Send a new confirmation link</button>
        <button type="button" onClick={() => changeMode('signin')} disabled={busy}>Back to sign in</button>
      </div>}
      {(mode === 'signin' || mode === 'signup') && <>
        <div className="auth-divider"><span>or</span></div>
        <button className="auth-google" type="button" onClick={google} disabled={busy}>Continue with Google</button>
        <div className="auth-secondary-actions">
          <button type="button" onClick={() => changeMode(mode === 'signin' ? 'signup' : 'signin')} disabled={busy}>
            {mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}</button>
          {mode === 'signin' && <button type="button" onClick={() => changeMode('forgot')} disabled={busy}>Forgot password?</button>}
          {mode === 'signin' && <button type="button" onClick={() => changeMode('confirm-again')} disabled={busy}>Need a new confirmation link?</button>}
        </div>
      </>}
      {(mode === 'forgot' || mode === 'sent' || mode === 'recovery' || mode === 'confirm-again') && <div className="auth-secondary-actions">
        <button type="button" onClick={() => changeMode(mode === 'recovery' ? 'forgot' : 'signin')} disabled={busy}>
          {mode === 'recovery' ? 'Request a new link' : 'Back to sign in'}</button>
      </div>}
    </section>
  </main>
}

export default AuthScreen
