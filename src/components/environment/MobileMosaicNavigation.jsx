import { useState } from 'react'
import { Activity, ArrowLeft, CalendarDays, Ellipsis, LayoutList, LogOut, Mail, Plus, Settings2, UsersRound } from 'lucide-react'

export default function MobileMosaicNavigation({ environment, canEdit, canManageInvitations, hasMembers, onBack, onList, onAdd,
  onSettings, onContributors, onInvitations, onInbox, onActivity, onCalendar, onGlobalActivity,
  onGlobalCalendar, onProfileSettings, onSignOut }) {
  const [moreOpen, setMoreOpen] = useState(false)
  function run(action) { setMoreOpen(false); action?.() }
  return <>
    <header className="mobile-mosaic-heading">
      <button className="mobile-back-button" type="button" onClick={onBack} aria-label="Back to Home"><ArrowLeft size={19} aria-hidden="true" /></button>
      <div className="mobile-environment-heading-copy"><span>{environment.type === 'personal' ? 'Personal Environment' : 'Shared Environment'}</span>
        <h1 title={environment.name}>{environment.name}</h1></div>
      <button id="mobile-mosaic-list-trigger" className="mobile-mosaic-list-toggle" type="button" onClick={onList} aria-label="Open accessible Environment list view">
        <LayoutList size={18} aria-hidden="true" /><span>List</span>
      </button>
      <button className="mobile-mosaic-more-toggle" id="mobile-mosaic-more-trigger" type="button" aria-label="More Environment options"
        aria-expanded={moreOpen} aria-controls="mobile-mosaic-more" onClick={() => setMoreOpen((open) => !open)}>
        <Ellipsis size={20} aria-hidden="true" />
      </button>
    </header>
    <nav className="mobile-mosaic-nav" aria-label="Mosaic actions">
      {canEdit && <button className="mobile-mosaic-add" type="button" onClick={onAdd}><Plus size={19} aria-hidden="true" /><span>Add</span></button>}
      <button type="button" onClick={() => run(onCalendar)}><CalendarDays size={19} aria-hidden="true"/><small>Calendar</small></button>
      <button type="button" onClick={() => run(onActivity)}><Activity size={19} aria-hidden="true"/><small>Activity</small></button>
      {hasMembers && <button type="button" onClick={() => run(onContributors)}><UsersRound size={19} aria-hidden="true"/><small>People</small></button>}
      <button type="button" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-controls="mobile-mosaic-more">
        <Ellipsis size={20} aria-hidden="true"/><small>More</small></button>
    </nav>
    {moreOpen && <div className="mobile-more-sheet" id="mobile-mosaic-more" role="group" aria-label="More Environment options">
      <button type="button" onClick={() => run(onSettings)}><Settings2 size={18} aria-hidden="true"/>Environment settings</button>
      {hasMembers && <button type="button" onClick={() => run(onContributors)}>View contributors</button>}
      {hasMembers && canManageInvitations && <button type="button" onClick={() => run(onInvitations)}>Invitations</button>}
      <button type="button" onClick={() => run(onInbox)}><Mail size={18} aria-hidden="true"/>Invitation inbox</button>
      <button type="button" onClick={() => run(onGlobalActivity)}><Activity size={18} aria-hidden="true"/>All activity</button>
      <button type="button" onClick={() => run(onGlobalCalendar)}><CalendarDays size={18} aria-hidden="true"/>All calendar events</button>
      <button type="button" onClick={() => run(onProfileSettings)}><Settings2 size={18} aria-hidden="true"/>Profile and settings</button>
      <button type="button" onClick={() => run(onSignOut)}><LogOut size={18} aria-hidden="true"/>Sign out</button>
    </div>}
  </>
}
