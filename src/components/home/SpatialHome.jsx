import { useRef, useState } from 'react'
import { ReactFlow, useNodesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import EnvironmentNode from './EnvironmentNode.jsx'
import GreetingNode from './GreetingNode.jsx'
import WelcomeNode from './WelcomeNode.jsx'
import ActivityPanel from '../layout/ActivityPanel.jsx'
import GlobalActivityPanel from '../layout/GlobalActivityPanel.jsx'
import GlobalCalendarPanel from '../layout/GlobalCalendarPanel.jsx'
import WorkspaceBar from '../layout/WorkspaceBar.jsx'
import InvitationInboxPanel from '../layout/InvitationInboxPanel.jsx'
import { profilePresentation } from '../../utils/profile.js'
import { readColor, saveColor } from '../../utils/personalization.js'
import { preferenceColor, SERVER_COLORS_ENABLED } from '../../lib/serverColors.js'
import {
  clearEnvironmentPositions,
  readEnvironmentPositions,
  saveEnvironmentPositions,
} from '../../utils/environmentStorage.js'

const nodeTypes = {
  environment: EnvironmentNode,
  greeting: GreetingNode,
  welcome: WelcomeNode,
}

function createInitialNodes(user, profile, environments, onOpenEnvironment, showWelcome, onCreate, onExplore,
  colorPreferences, colorReady, onColor, resourceCounts, resourceCountStatus) {
  const savedPositions = readEnvironmentPositions(user.id)
  const name = profilePresentation(user, profile).displayName
  const compact = window.innerWidth <= 760

  return [
    {
      id: 'greeting',
      type: 'greeting',
      position: compact && showWelcome ? { x: 42, y: 115 } : { x: 170, y: 145 },
      draggable: false,
      selectable: false,
      data: { name, hasEnvironments: environments.length > 0 },
    },
    ...(showWelcome ? [{
      id: 'welcome', type: 'welcome', position: compact ? { x: 42, y: 230 } : { x: 170, y: 300 }, draggable: false,
      selectable: false, data: { onCreate, onExplore },
    }] : []),
    ...environments.map((environment, index) => ({
      id: environment.id,
      type: 'environment',
      position: savedPositions[environment.id] || {
        x: 560 + (index % 3) * 490,
        y: 205 + Math.floor(index / 3) * 365,
      },
      data: {
        environment: {
          ...environment,
          kind: environment.type === 'personal' ? 'Personal' : 'Shared',
          size: 'medium',
          resourceCount: resourceCounts[environment.id],
          resourceCountStatus,
        },
        onEnter: () => onOpenEnvironment(environment),
        color: SERVER_COLORS_ENABLED
          ? colorReady ? preferenceColor(colorPreferences, environment.id) : 'neutral'
          : readColor(user.id, 'environment', environment.id),
        onColor: !SERVER_COLORS_ENABLED || colorReady ? (color) => onColor(environment.id, color) : undefined,
      },
    })),
  ]
}

function SpatialHome({ user, profile, environments, loading, loadedOnce, error, onRetry, onCreate,
  onOpenEnvironment, onOpenTutorial, onOpenSettings, tutorialStatus, onSignOut,
  colorError, colorReady, colorPreferences, onSaveColor, onRetryColors, onInvitationAccepted,
  resourceCounts, resourceCountStatus, resourceCountError, activityItems = [], activityError = '',
  initialJoinCode = '', onJoinCodeConsumed }) {
  const showWelcome = loadedOnce && !error && environments.length === 0
  const presented = profilePresentation(user, profile)
  const [creating, setCreating] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState(() => createInitialNodes(user, profile, environments,
    onOpenEnvironment, showWelcome, () => setCreating(true), onOpenTutorial,
    colorPreferences, colorReady, changeColor, resourceCounts, resourceCountStatus))
  const [name, setName] = useState('')
  const [type, setType] = useState('shared')
  const [createError, setCreateError] = useState('')
  const [saving, setSaving] = useState(false)
  const [invitationInboxOpen, setInvitationInboxOpen] = useState(Boolean(initialJoinCode))
  const [globalActivityOpen, setGlobalActivityOpen] = useState(false)
  const [globalCalendarOpen, setGlobalCalendarOpen] = useState(false)
  const flowRef = useRef(null)

  async function changeColor(id, color) {
    if (SERVER_COLORS_ENABLED) await onSaveColor(id, color)
    else if (!saveColor(user.id, 'environment', id, color)) throw new Error('Could not save this color on this device.')
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, color } } : node))
  }

  function handleNodeDragStop(_event, movedNode) {
    const updatedNodes = nodes.map((node) =>
      node.id === movedNode.id ? { ...node, position: movedNode.position } : node,
    )
    setNodes(updatedNodes)
    saveEnvironmentPositions(user.id, updatedNodes)
  }

  function handleNodeClick(_event, node) {
    if (node.type === 'environment') onOpenEnvironment(environments.find((environment) => environment.id === node.id))
  }

  function handleReset() {
    clearEnvironmentPositions(user.id)
    setNodes(createInitialNodes(user, profile, environments, onOpenEnvironment,
      showWelcome, () => setCreating(true), onOpenTutorial,
      colorPreferences, colorReady, changeColor, resourceCounts, resourceCountStatus))
    requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.13, duration: 320, maxZoom: 1 })
    })
  }

  async function handleCreate(event) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setCreateError('')
    try {
      await onCreate({ name: trimmedName, type })
      setCreating(false)
      setName('')
    } catch (createFailure) {
      setCreateError(createFailure.message || 'Could not create this Environment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="spatial-home" aria-label="Moseek Home workspace">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onInit={(instance) => { flowRef.current = instance }}
        nodeDragThreshold={6}
        nodeClickDistance={6}
        elementsSelectable={false}
        nodesFocusable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.4}
        maxZoom={1.4}
        fitView
        fitViewOptions={{ padding: 0.13, minZoom: 0.55, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      />
      <WorkspaceBar onReset={handleReset} onCreate={() => setCreating(true)} onOpenTutorial={onOpenTutorial}
        onOpenSettings={onOpenSettings} tutorialStatus={tutorialStatus} onSignOut={onSignOut}
        onOpenGlobalActivity={() => { setGlobalCalendarOpen(false); setGlobalActivityOpen((open) => !open) }}
        onOpenGlobalCalendar={() => { setGlobalActivityOpen(false); setGlobalCalendarOpen((open) => !open) }}
        onOpenInvitationInbox={() => setInvitationInboxOpen((open) => !open)} invitationInboxExpanded={invitationInboxOpen}
        userEmail={user.email} avatarName={presented.displayName} avatarUrl={presented.avatarUrl} />
      {invitationInboxOpen && <InvitationInboxPanel initialCode={initialJoinCode} onCodeConsumed={onJoinCodeConsumed}
        onClose={() => setInvitationInboxOpen(false)}
        onAccepted={() => { setInvitationInboxOpen(false); onJoinCodeConsumed?.(); onInvitationAccepted?.() }} />}
      {resourceCountStatus === 'error' && <div className="home-color-error" role="status">
        <span>{resourceCountError || 'Resource counts could not be loaded.'}</span>
        <button type="button" onClick={onRetry}>Try again</button>
      </div>}
      {SERVER_COLORS_ENABLED && colorError && <div className="home-color-error" role="alert">
        <span>Could not load your card colors. {colorError}</span>
        <button type="button" onClick={onRetryColors}>Try again</button>
      </div>}
      {globalActivityOpen && <GlobalActivityPanel onClose={() => setGlobalActivityOpen(false)}
        onOpenEnvironment={(id) => { setGlobalActivityOpen(false); onOpenEnvironment({ id }) }} />}
      {globalCalendarOpen && <GlobalCalendarPanel onClose={() => setGlobalCalendarOpen(false)}
        onOpenEnvironment={(id) => { setGlobalCalendarOpen(false); onOpenEnvironment({ id }) }} />}
      <ActivityPanel
        userId={user.id}
        items={activityItems}
        loading={loading}
        error={error || activityError}
        onRetry={onRetry}
      />
      {creating && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setCreating(false) }}>
        <form className="create-dialog" onSubmit={handleCreate} aria-label="Create Environment">
          <span className="portal-kicker">New space</span>
          <h2>Create Environment</h2>
          <label>Name<input autoFocus maxLength={160} value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>Type<select value={type} onChange={(event) => setType(event.target.value)}><option value="shared">Shared</option><option value="personal">Personal</option></select></label>
          {createError && <p className="form-error" role="alert">{createError}</p>}
          <div className="dialog-actions"><button type="button" onClick={() => setCreating(false)} disabled={saving}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button></div>
        </form>
      </div>}
    </main>
  )
}

export default SpatialHome
