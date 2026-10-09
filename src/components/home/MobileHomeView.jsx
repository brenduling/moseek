import { useState } from 'react'
import { Activity, CalendarDays, Ellipsis, House, LogOut, Mail, Plus, Settings2, Sparkles } from 'lucide-react'
import ColorPicker from '../layout/ColorPicker.jsx'

function resourceSignal(environment) {
  if (environment.resourceCountStatus === 'loading') return 'Checking resources'
  if (environment.resourceCountStatus === 'error' || environment.resourceCount === undefined) return 'Resource count unavailable'
  if (environment.resourceCount === 0) return 'No resources yet'
  return `${environment.resourceCount} ${environment.resourceCount === 1 ? 'resource' : 'resources'}`
}

function MobileEnvironmentCard({ environment, color, onOpen, onColor }) {
  return <article className="mobile-home-environment" data-color={color}>
    <button className="mobile-home-environment-open" type="button" onClick={onOpen}>
      <span className="mobile-home-environment-type">{environment.kind}</span>
      <span className="mobile-home-environment-name">{environment.name}</span>
      {environment.description && <span className="mobile-home-environment-description">{environment.description}</span>}
      <span className={`mobile-home-environment-count${environment.resourceCountStatus === 'error' ? ' is-unavailable' : ''}`}>
        <span aria-hidden="true" />{resourceSignal(environment)}
      </span>
    </button>
    {onColor && <ColorPicker value={color} itemName={environment.name} onChange={onColor} />}
  </article>
}

function MobileHomeView({ user, profileName, environments, loading, loadedOnce, error, onRetry,
  onCreate, onOpenEnvironment, colorFor, onSaveColor, onOpenActivity, onOpenCalendar,
  onOpenInvitations, onOpenSettings, onOpenTutorial, onSignOut }) {
  const [moreOpen, setMoreOpen] = useState(false)
  function openBottom(action) { setMoreOpen(false); action?.() }
  return <section className="mobile-home-view" aria-label="Moseek Home">
    <header className="mobile-home-heading">
      <div><span className="mobile-home-wordmark">moseek</span>
        <p>Welcome back, {profileName || user.email?.split('@')[0] || 'there'}.</p></div>
      <button className="mobile-home-create" type="button" onClick={onCreate} aria-label="Create Environment">
        <Plus size={19} aria-hidden="true" /><span>Create</span>
      </button>
    </header>

    {error ? <section className="mobile-home-state" role="alert">
      <p>Your Environments could not be loaded.</p><button type="button" onClick={onRetry}>Try again</button>
    </section> : loading && !loadedOnce ? <p className="mobile-home-loading" role="status">Looking around your space...</p>
      : environments.length === 0 ? <section className="mobile-home-welcome">
        <span className="mobile-home-kicker">Your Home</span>
        <h1>A space for everything you're working on.</h1>
        <p>Bring your notes, links, files, and ideas together. Arrange them in a way that makes sense to you.</p>
        <button type="button" className="mobile-home-primary" onClick={onCreate}>Create your first Environment</button>
        <button type="button" className="mobile-home-secondary" onClick={onOpenTutorial}>Explore Moseek</button>
      </section> : <section className="mobile-home-spaces" aria-labelledby="mobile-home-spaces-title">
        <div className="mobile-home-section-heading"><div><span className="mobile-home-kicker">Your spaces</span>
          <h1 id="mobile-home-spaces-title">Environments</h1></div>
          <span>{environments.length}</span></div>
        <div className="mobile-home-environment-list">
          {environments.map((environment) => <MobileEnvironmentCard key={environment.id}
            environment={{ ...environment, kind: environment.type === 'personal' ? 'Personal' : 'Shared' }}
            color={colorFor(environment.id)} onOpen={() => onOpenEnvironment(environment)}
            onColor={onSaveColor ? (color) => onSaveColor(environment.id, color) : undefined} />)}
        </div>
      </section>}

    <nav className="mobile-bottom-nav" aria-label="Main navigation">
      <button type="button" aria-current="page" aria-label="Home"><House size={19} aria-hidden="true" /><small>Home</small></button>
      <button type="button" onClick={() => openBottom(onOpenActivity)} aria-label="Open activity"><Activity size={19} aria-hidden="true" /><small>Activity</small></button>
      <button type="button" onClick={() => openBottom(onOpenCalendar)} aria-label="Open calendar"><CalendarDays size={19} aria-hidden="true" /><small>Calendar</small></button>
      <button type="button" onClick={() => openBottom(onOpenInvitations)} aria-label="Open invitations"><Mail size={19} aria-hidden="true" /><small>Invites</small></button>
      <button type="button" aria-expanded={moreOpen} aria-controls="mobile-home-more" onClick={() => setMoreOpen((open) => !open)} aria-label="More options">
        <Ellipsis size={20} aria-hidden="true" /><small>More</small></button>
    </nav>
    {moreOpen && <div className="mobile-more-sheet" id="mobile-home-more" role="group" aria-label="More Home options">
      <button type="button" onClick={() => { setMoreOpen(false); onOpenSettings() }}><Settings2 size={18} aria-hidden="true" />Profile and settings</button>
      <button type="button" onClick={() => { setMoreOpen(false); onOpenTutorial() }}><Sparkles size={18} aria-hidden="true" />Explore Moseek</button>
      <button type="button" onClick={() => { setMoreOpen(false); onSignOut() }}><LogOut size={18} aria-hidden="true" />Sign out</button>
    </div>}
  </section>
}

export default MobileHomeView
