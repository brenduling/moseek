import { useEffect, useRef, useState } from 'react'
import Home from './pages/Home.jsx'
import Environment from './pages/Environment.jsx'
import Settings from './pages/Settings.jsx'
import TutorialCanvas from './components/onboarding/TutorialCanvas.jsx'
import AuthScreen from './components/auth/AuthScreen.jsx'
import { supabase } from './lib/supabase.js'
import { authReturnMessage } from './utils/authFlow.js'
import { applyAppearance, readAppearance, rememberAppearanceUser, saveAppearance } from './utils/appearance.js'
import { loadProfile, updateProfile } from './lib/profiles.js'
import './App.css'

function AuthLoading() {
  return <main className="auth-screen" role="status" aria-live="polite">
    <div className="auth-wordmark">moseek</div>
    <div className="auth-panel auth-loading"><span className="auth-spinner" aria-hidden="true" />
      <p>Opening your space…</p></div>
  </main>
}

function AuthReturnProblem({ message, onContinue, hasSession }) {
  return <main className="auth-screen">
    <div className="auth-wordmark">moseek</div>
    <section className="auth-panel" role="alert">
      <span className="portal-kicker">Your workspace</span>
      <h1>This link didn't work.</h1>
      <p>{message}</p>
      <button className="auth-primary" type="button" onClick={onContinue}>
        {hasSession ? 'Continue to Moseek' : 'Back to sign in'}</button>
    </section>
  </main>
}

function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [signupPending, setSignupPending] = useState(false)
  const [authError, setAuthError] = useState('')
  const [returnError, setReturnError] = useState(() => authReturnMessage(window.location))
  const [recovery, setRecovery] = useState(() => new URLSearchParams(window.location.search).get('auth') === 'recovery')
  const [initialJoinCode, setInitialJoinCode] = useState(() => new URLSearchParams(window.location.search).get('join') || '')
  const [view, setView] = useState(null)
  const [signOutError, setSignOutError] = useState('')
  const [appearance, setAppearance] = useState('system')
  const [profileState, setProfileState] = useState({ userId: null, status: 'idle', data: null, error: '' })
  const [profileReload, setProfileReload] = useState(0)
  const activeUserRef = useRef(null)
  const authEventSeenRef = useRef(false)

  function adoptUser(nextSession) {
    const nextId = nextSession?.user.id || null
    if (nextId === activeUserRef.current) return
    activeUserRef.current = nextId
    const mode = readAppearance(nextId)
    applyAppearance(mode)
    rememberAppearanceUser(nextId)
    setAppearance(mode)
    setProfileState({ userId: nextId, status: nextId ? 'loading' : 'idle', data: null, error: '' })
  }

  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      authEventSeenRef.current = true
      if (event === 'SIGNED_OUT' || (nextSession?.user.id && nextSession.user.id !== activeUserRef.current)) setView(null)
      adoptUser(nextSession)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(nextSession)
      setAuthReady(true)
    })
    supabase.auth.getSession().then(({ data, error }) => {
      if (authEventSeenRef.current) return
      if (error) setAuthError('Could not restore your session. Please try signing in again.')
      adoptUser(data?.session)
      setSession(data?.session || null)
      setAuthReady(true)
    }).catch(() => {
      if (authEventSeenRef.current) return
      setAuthError('Could not restore your session. Please try signing in again.')
      setAuthReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || !initialJoinCode) return
    const url = new URL(window.location.href)
    url.searchParams.delete('join')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [session, initialJoinCode])

  useEffect(() => {
    const user = session?.user
    if (!user) return
    let active = true
    loadProfile(supabase, user).then((data) => {
      if (active) setProfileState({ userId: user.id, status: 'ready', data, error: '' })
    }).catch((failure) => {
      if (active) setProfileState({ userId: user.id, status: 'error', data: null,
        error: failure.message || 'Could not load your profile.' })
    })
    return () => { active = false }
  }, [session?.user, profileReload])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => { if (appearance === 'system') applyAppearance('system', document.documentElement, media) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [appearance])

  if (!supabase) return <main className="auth-screen"><div className="auth-panel" role="alert">
    <div className="auth-wordmark">moseek</div>
    <h1>Configuration needed</h1>
    <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart Vite.</p>
  </div></main>
  if (!authReady) return <AuthLoading />

  const clearAuthReturn = () => {
    window.history.replaceState(null, '', `${window.location.origin}${import.meta.env.BASE_URL}`)
    setRecovery(false)
  }
  const onRecovered = clearAuthReturn
  if (returnError) return <AuthReturnProblem message={returnError} hasSession={Boolean(session)}
    onContinue={() => { clearAuthReturn(); setReturnError('') }} />
  if (recovery) return <AuthScreen supabase={supabase} initialMode={session ? 'recovery' : 'forgot'}
    initialError={session ? '' : 'This reset link is invalid or expired. Request a new one.'}
    onRecovered={onRecovered} onExitRecovery={onRecovered} />
  if (!session || signupPending) return <AuthScreen supabase={supabase} initialError={authError}
    onSignupPending={setSignupPending} />

  async function handleSignOut() {
    setSignOutError('')
    const { error } = await supabase.auth.signOut()
    if (error) setSignOutError(error.message)
    else setView(null)
  }

  function changeAppearance(mode) {
    if (!session?.user.id) return
    saveAppearance(session.user.id, mode)
    applyAppearance(mode)
    setAppearance(mode)
  }

  async function saveProfile(values) {
    const data = await updateProfile(supabase, session.user.id, values)
    setProfileState({ userId: session.user.id, status: 'ready', data, error: '' })
    return data
  }

  const profile = profileState.userId === session.user.id ? profileState.data : null
  const profileLoading = profileState.userId !== session.user.id || profileState.status === 'loading'
  const openSettings = () => setView((current) => ({ kind: 'settings', from: current }))

  return <div className="app-view" key={session.user.id}>
    {view?.kind === 'settings' ? <Settings user={session.user} profile={profile} profileLoading={profileLoading}
      profileError={profileState.error} onRetryProfile={() => { setProfileState({ userId: session.user.id,
        status: 'loading', data: null, error: '' }); setProfileReload((value) => value + 1) }}
      onSaveProfile={saveProfile} appearance={appearance} onAppearanceChange={changeAppearance}
      onBack={() => setView(view.from || null)} onSignOut={handleSignOut}
      onRestartTutorial={() => setView({ kind: 'tutorial' })} />
      : view?.kind === 'tutorial' ? <TutorialCanvas userId={session.user.id} onExit={() => setView(null)} />
      : view?.kind === 'environment' ? <Environment key={view.id} environmentId={view.id} user={session.user}
      onLeave={() => setView(null)} onSignOut={handleSignOut} profile={profile} onOpenSettings={openSettings}
      onOpenEnvironment={(environment) => setView({ kind: 'environment', id: environment.id })} />
      : <Home user={session.user} initialJoinCode={initialJoinCode} onJoinCodeConsumed={() => setInitialJoinCode('')}
        onOpenEnvironment={(environment) => setView({ kind: 'environment', id: environment.id })}
        onOpenTutorial={() => setView({ kind: 'tutorial' })} onSignOut={handleSignOut}
        profile={profile} onOpenSettings={openSettings} />}
    {signOutError && <p className="app-error" role="alert">Could not sign out: {signOutError}</p>}
  </div>
}

export default App
