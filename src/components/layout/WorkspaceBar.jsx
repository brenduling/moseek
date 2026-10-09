import { useRef } from 'react'
import { Activity, CalendarDays, Ellipsis, Mail, Plus, RotateCcw, Search, Settings2, UsersRound } from 'lucide-react'
import Avatar from '../profile/Avatar.jsx'

function WorkspaceBar({ onReset, environmentName, environmentType, onBack, onCreate, onSignOut, onOpenTutorial,
  onOpenSettings, tutorialStatus, userEmail, avatarName, avatarUrl, onShowContributors, canManageContributors,
  contributorsExpanded = false, onShowEnvironmentSettings, environmentSettingsExpanded = false,
  onOpenInvitationInbox, invitationInboxExpanded = false, onOpenCalendar, calendarExpanded = false,
  onOpenActivity, activityExpanded = false, onOpenGlobalActivity, onOpenGlobalCalendar }) {
  const menuRef = useRef(null)

  function handleReset() {
    onReset?.()
    if (menuRef.current) menuRef.current.open = false
  }

  return (
    <header className="workspace-bar">
      <div className="workspace-bar-left">
        <div className="workspace-identity">
          {onBack ? (
            <button className="workspace-wordmark workspace-back" type="button" onClick={onBack} aria-label="Return to Moseek Home">
              moseek
            </button>
          ) : <span className="workspace-wordmark">moseek</span>}
          {environmentName && (
            <span className="workspace-breadcrumb" title={environmentName}>
              <span aria-hidden="true">/</span><span className="workspace-breadcrumb-name">{environmentName}</span>
              {environmentType && <span className="workspace-breadcrumb-type">
                {environmentType === 'personal' ? 'Personal' : 'Shared'}
              </span>}
            </span>
          )}
        </div>
        <div className="workspace-search" aria-label="Search preview, not yet available">
          <Search size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>Find anything...</span>
        </div>
      </div>
      <div className="workspace-bar-actions">
        {onShowEnvironmentSettings && <button id="environment-settings-trigger" className="environment-settings-trigger"
          type="button" onClick={onShowEnvironmentSettings} aria-label="Environment settings"
          aria-expanded={environmentSettingsExpanded} aria-controls="environment-settings-panel"
          title="Environment settings">
          <Settings2 size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>Environment settings</span>
        </button>}
        {onShowContributors && <button className="contributors-trigger" type="button" onClick={onShowContributors}
          aria-label={canManageContributors ? 'Manage contributors' : 'View contributors'}
          aria-expanded={contributorsExpanded} aria-controls="environment-contributors-panel"
          title={canManageContributors ? 'Manage contributors' : 'View contributors'}>
          <UsersRound size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{canManageContributors ? 'Manage contributors' : 'Contributors'}</span>
        </button>}
        {onOpenInvitationInbox && <button className="bar-icon invitation-inbox-trigger" type="button" onClick={onOpenInvitationInbox}
          aria-label="Open invitation inbox" aria-expanded={invitationInboxExpanded} aria-controls="invitation-inbox-panel" title="Invitations">
          <Mail size={18} strokeWidth={1.8} aria-hidden="true" /></button>}
        {onOpenCalendar && <button className="bar-icon calendar-trigger" type="button" onClick={onOpenCalendar}
          title="Calendar" aria-label="Open Environment calendar" aria-expanded={calendarExpanded}
          aria-controls="environment-calendar-panel">
          <CalendarDays size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>}
        {onOpenActivity && <button className="bar-icon activity-trigger" type="button" onClick={onOpenActivity}
          title="Activity" aria-label="Open Environment activity" aria-expanded={activityExpanded}
          aria-controls="environment-activity-panel">
          <Activity size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>}
        {userEmail && (onOpenSettings
          ? <button className="bar-avatar-button" type="button" onClick={onOpenSettings}
            aria-label="Open profile and settings" title="Profile and settings">
            <Avatar name={avatarName || userEmail} url={avatarUrl} /></button>
          : <Avatar name={avatarName || userEmail} url={avatarUrl} className="bar-avatar-static" />)}
        {onCreate && <button className="create-environment" type="button" onClick={onCreate} aria-label="Create Environment">
          <Plus size={16} strokeWidth={1.9} aria-hidden="true" />
          Environment
        </button>}
        {(onReset || onSignOut || onOpenTutorial || onOpenGlobalActivity || onOpenGlobalCalendar) && (
          <details className="workspace-more" ref={menuRef}>
            <summary aria-label="More options" title="More options">
              <Ellipsis size={19} strokeWidth={1.8} aria-hidden="true" />
            </summary>
            <div className="workspace-menu">
              {onReset && <button type="button" onClick={handleReset}>
                <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
                Reset arrangement
              </button>}
              {onOpenGlobalActivity && <button type="button" onClick={() => {
                onOpenGlobalActivity()
                if (menuRef.current) menuRef.current.open = false
              }}><Activity size={14} strokeWidth={1.8} aria-hidden="true" />All activity</button>}
              {onOpenGlobalCalendar && <button type="button" onClick={() => {
                onOpenGlobalCalendar()
                if (menuRef.current) menuRef.current.open = false
              }}><CalendarDays size={14} strokeWidth={1.8} aria-hidden="true" />Global calendar</button>}
              {onOpenTutorial && <button type="button" onClick={onOpenTutorial}>
                {tutorialStatus === 'completed' ? 'Revisit Moseek guide' : 'Explore Moseek'}
              </button>}
              {onOpenSettings && <button type="button" onClick={onOpenSettings}>Profile and settings</button>}
              {onSignOut && <button type="button" onClick={onSignOut}>Sign out</button>}
            </div>
          </details>
        )}
      </div>
    </header>
  )
}

export default WorkspaceBar
