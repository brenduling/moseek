import { useEffect, useRef, useState } from 'react'
import { Controls, ReactFlow, useNodesState } from '@xyflow/react'
import { FileText, LayoutPanelTop, Link2, Plus } from 'lucide-react'
import WorkspaceBar from '../layout/WorkspaceBar.jsx'
import { LinkNode, NoteNode, SectionNode } from '../environment/CanvasNodes.jsx'
import { validateLinkUrl } from '../../utils/environmentCanvas.js'
import { canAdvanceTutorial, saveTutorialStatus, tutorialSteps } from '../../utils/onboarding.js'

const nodeTypes = { section: SectionNode, note: NoteNode, link: LinkNode }

function TutorialCanvas({ userId, onExit }) {
  const [step, setStep] = useState(0)
  const [actions, setActions] = useState(() => new Set())
  const [sandboxCreated, setSandboxCreated] = useState(false)
  const [practiceName, setPracticeName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editor, setEditor] = useState(null)
  const [error, setError] = useState('')
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const nodesRef = useRef([])
  const flowRef = useRef(null)
  const canvasRef = useRef(null)
  const stepId = tutorialSteps[step].id
  const canContinue = canAdvanceTutorial(stepId, actions)

  useEffect(() => { nodesRef.current = nodes }, [nodes])

  function mark(action) {
    setActions((current) => new Set([...current, action]))
  }

  function commitNodes(next) {
    nodesRef.current = next
    setNodes(next)
  }

  function openEditor(kind, id) {
    const row = nodesRef.current.find((node) => node.id === id)?.data.row
    if (row) setEditor({ mode: 'edit', kind, id, title: row.title, body: row.body || '', url: row.url || '' })
  }

  function deleteNode(id) {
    commitNodes(nodesRef.current.filter((node) => node.id !== id))
    return true
  }

  function openLink(resource) {
    try {
      window.open(validateLinkUrl(resource.url), '_blank', 'noopener,noreferrer')
      setError('')
    } catch (failure) { setError(failure.message) }
  }

  function resizeSection(id, params) {
    commitNodes(nodesRef.current.map((node) => node.id === id ? {
      ...node, position: { x: params.x, y: params.y }, style: { width: params.width, height: params.height },
      data: { ...node.data, row: { ...node.data.row, ...params } },
    } : node))
    mark('moved')
  }

  function positionNearCenter(width, height) {
    if (!canvasRef.current || !flowRef.current) return { x: 380, y: 260 }
    const bounds = canvasRef.current.getBoundingClientRect()
    const center = flowRef.current.screenToFlowPosition({ x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2 })
    return { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) }
  }

  function startCreate(kind) {
    const [width, height] = kind === 'section' ? [660, 430] : kind === 'note' ? [250, 210] : [245, 121]
    setError('')
    setEditor({ mode: 'create', kind, id: crypto.randomUUID(), title: '', body: '', url: '',
      position: positionNearCenter(width, height), width, height })
    setMenuOpen(false)
  }

  function submitEditor(event) {
    event.preventDefault()
    if (!editor) return
    const title = editor.title.trim()
    if (!title) { setError('Give this item a title.'); return }
    let url = editor.url
    try { if (editor.kind === 'link') url = validateLinkUrl(url) }
    catch (failure) { setError(failure.message); return }

    if (editor.mode === 'create') {
      const row = { id: editor.id, title, body: editor.kind === 'note' ? editor.body : null,
        url: editor.kind === 'link' ? url : null, x: editor.position.x, y: editor.position.y,
        width: editor.width, height: editor.height, type: editor.kind }
      const node = { id: row.id, type: editor.kind, position: editor.position,
        style: editor.kind === 'section' ? { width: row.width, height: row.height } : undefined,
        zIndex: editor.kind === 'section' ? 0 : 2,
        data: { row, canEdit: true, onEdit: openEditor, onDelete: deleteNode, onOpen: openLink, onResize: resizeSection } }
      commitNodes([...nodesRef.current, node])
      if (editor.kind === 'section') mark('section')
      if (editor.kind === 'link') mark('link')
      if (editor.kind === 'note') mark('noteCreated')
    } else {
      commitNodes(nodesRef.current.map((node) => node.id === editor.id
        ? { ...node, data: { ...node.data, row: { ...node.data.row, title,
          body: editor.kind === 'note' ? editor.body : node.data.row.body,
          url: editor.kind === 'link' ? url : node.data.row.url } } }
        : node))
      if (editor.kind === 'note') mark('noteEdited')
    }
    setEditor(null)
    setError('')
  }

  function handleNodeDragStop(_event, node) {
    commitNodes(nodesRef.current.map((item) => item.id === node.id
      ? { ...item, position: node.position, data: { ...item.data,
        row: { ...item.data.row, x: node.position.x, y: node.position.y } } }
      : item))
    mark('moved')
  }

  function nudgeNode() {
    const target = nodesRef.current.find((node) => node.selected) || nodesRef.current.at(-1)
    if (!target) return
    const position = { x: target.position.x + 48, y: target.position.y }
    commitNodes(nodesRef.current.map((node) => node.id === target.id
      ? { ...node, position, data: { ...node.data, row: { ...node.data.row, ...position } } }
      : node))
    mark('moved')
  }

  function restart() {
    setStep(0)
    setActions(new Set())
    setSandboxCreated(false)
    setPracticeName('')
    setMenuOpen(false)
    setEditor(null)
    setError('')
    commitNodes([])
  }

  function leave(status) {
    if (status) saveTutorialStatus(userId, status)
    onExit()
  }

  return <main className="spatial-home tutorial-canvas" ref={canvasRef} aria-label="Moseek practice workspace">
    {sandboxCreated && <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
      onNodeDragStop={handleNodeDragStop} onInit={(instance) => { flowRef.current = instance }}
      onMoveEnd={(event) => { if (event) mark('navigated') }}
      nodesConnectable={false} elevateNodesOnSelect={false} panOnDrag zoomOnScroll zoomOnPinch
      zoomOnDoubleClick={false} minZoom={0.4} maxZoom={1.5} fitView
      fitViewOptions={{ padding: 0.15, minZoom: 0.6, maxZoom: 1 }} proOptions={{ hideAttribution: true }}>
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>}
    <WorkspaceBar environmentName={sandboxCreated ? practiceName : 'Explore Moseek'} onBack={() => leave(null)} />
    <section className="tutorial-guide" aria-labelledby="tutorial-title">
      <span className="portal-kicker">Explore Moseek · {step + 1} of {tutorialSteps.length}</span>
      <h1 id="tutorial-title" aria-live="polite">{tutorialSteps[step].title}</h1>
      <p>{tutorialSteps[step].text}</p>
      {stepId === 'create' && !sandboxCreated && <form className="tutorial-create" onSubmit={(event) => {
        event.preventDefault()
        if (!practiceName.trim()) return
        setPracticeName(practiceName.trim())
        setSandboxCreated(true)
        mark('created')
      }}>
        <label htmlFor="tutorial-environment-name">Practice Environment name</label>
        <input id="tutorial-environment-name" maxLength={160} required value={practiceName}
          onChange={(event) => setPracticeName(event.target.value)} placeholder="A project you're curious about" />
        <button className="tutorial-action" type="submit">Create practice Environment</button>
      </form>}
      {stepId === 'navigate' && sandboxCreated && <button className="tutorial-action" type="button"
        onClick={() => { flowRef.current?.zoomIn({ duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 }); mark('navigated') }}>Try zooming in</button>}
      {stepId === 'move' && <button className="tutorial-action" type="button" onClick={nudgeNode}>
        Move a practice item right</button>}
      {stepId === 'note' && actions.has('noteCreated') && !actions.has('noteEdited') &&
        <p className="tutorial-hint">Select your Note, then choose Edit from its menu.</p>}
      {!canContinue && <p className="tutorial-hint">Try this in the practice space to continue.</p>}
      <div className="tutorial-navigation">
        <button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}>Back</button>
        {step === tutorialSteps.length - 1
          ? <button type="button" className="tutorial-next" onClick={() => leave('completed')}>Finish and return Home</button>
          : <button type="button" className="tutorial-next" disabled={!canContinue}
            onClick={() => setStep((value) => value + 1)}>Next</button>}
      </div>
      <div className="tutorial-secondary">
        <button type="button" onClick={restart}>Restart</button>
        <button type="button" onClick={() => leave('skipped')}>Skip guide</button>
        <button type="button" onClick={() => leave(null)}>Exit</button>
      </div>
    </section>
    {sandboxCreated && <>
      {nodes.length === 0 && <p className="tutorial-canvas-empty">This practice space is yours to try. Use + to bring something in.</p>}
      {menuOpen && <section className="bring-in-popover environment-bring-in" aria-label="Bring something in">
        <h2>Bring something in</h2>
        <button className="bring-in-option" type="button" onClick={() => startCreate('note')}><FileText size={18} aria-hidden="true" /><span><strong>Note</strong><small>Write something here</small></span></button>
        <button className="bring-in-option" type="button" onClick={() => startCreate('link')}><Link2 size={18} aria-hidden="true" /><span><strong>Link</strong><small>Bring in something from elsewhere</small></span></button>
        <button className="bring-in-option" type="button" onClick={() => startCreate('section')}><LayoutPanelTop size={18} aria-hidden="true" /><span><strong>Section</strong><small>Organize an area of this Environment</small></span></button>
      </section>}
      {editor && <section className="bring-in-popover link-popover environment-editor" role="dialog" aria-modal="false" aria-label={`${editor.mode === 'create' ? 'Create' : 'Edit'} ${editor.kind}`}>
        <h2>{editor.mode === 'create' ? 'Add' : 'Edit'} {editor.kind}</h2>
        <form onSubmit={submitEditor}>
          <label htmlFor="tutorial-title-input">Title</label>
          <input id="tutorial-title-input" autoFocus maxLength={editor.kind === 'section' ? 160 : 200} required
            value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} />
          {editor.kind === 'note' && <><label htmlFor="tutorial-note-body">Note</label>
            <textarea id="tutorial-note-body" value={editor.body}
              onChange={(event) => setEditor({ ...editor, body: event.target.value })} /></>}
          {editor.kind === 'link' && <><label htmlFor="tutorial-link-url">URL</label>
            <input id="tutorial-link-url" type="url" inputMode="url" placeholder="https://…" required
              value={editor.url} onChange={(event) => setEditor({ ...editor, url: event.target.value })} /></>}
          <div className="link-popover-actions">
            <button className="link-cancel" type="button" onClick={() => { setEditor(null); setError('') }}>Cancel</button>
            <button className="link-submit" type="submit">Done</button>
          </div>
        </form>
      </section>}
      <button className="add-resource-control" type="button" aria-label="Bring something in"
        aria-expanded={menuOpen || Boolean(editor)} disabled={Boolean(editor)}
        onClick={() => setMenuOpen((value) => !value)}><Plus size={20} strokeWidth={1.8} aria-hidden="true" /></button>
    </>}
    {error && <p className="environment-open-error" role="alert">{error}</p>}
  </main>
}

export default TutorialCanvas
