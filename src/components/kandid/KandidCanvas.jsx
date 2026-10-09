import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { ReactFlow, useNodesState } from '@xyflow/react'
import BringInMenu from './BringInMenu.jsx'
import CreateLinkPopover from './CreateLinkPopover.jsx'
import EditableNoteNode from './EditableNoteNode.jsx'
import KandidFileNode from './KandidFileNode.jsx'
import KandidLandmark from './KandidLandmark.jsx'
import KandidResourceNode from './KandidResourceNode.jsx'
import KandidSectionNode from './KandidSectionNode.jsx'
import WorkspaceBar from '../layout/WorkspaceBar.jsx'
import { kandidPresence } from '../../data/environmentPresence.js'
import { kandidResources } from '../../data/kandidResources.js'
import { readKandidWorkspace, saveKandidWorkspace } from '../../utils/kandidStorage.js'
import { canOpenLocalFile, canPreviewImage, getLocalFile, MAX_LOCAL_FILE_SIZE, removeLocalFile, storeLocalFile } from '../../utils/fileStorage.js'

const nodeTypes = {
  kandidLandmark: KandidLandmark,
  kandidResource: KandidResourceNode,
  editableNote: EditableNoteNode,
  kandidFile: KandidFileNode,
  kandidSection: KandidSectionNode,
}

function createInitialNodes(workspace, onUpdate, onEditingChange, onDelete, onOpenLink, onOpenFile,
  onRenameSection, onDeleteSection, onResize) {
  const sectionIds = new Set(workspace.sections.map((section) => section.id))
  const membership = (resource) => {
    const sectionId = workspace.sectionMemberships[resource.id] || resource.sectionId
    return sectionIds.has(sectionId) ? sectionId : null
  }
  return [
    {
      id: 'kandid-landmark',
      type: 'kandidLandmark',
      position: { x: 150, y: 130 },
      draggable: false,
      selectable: false,
      zIndex: 2,
      data: { presence: kandidPresence },
    },
    ...workspace.sections.map((section) => ({
      id: section.id,
      type: 'kandidSection',
      position: section.position,
      style: { width: section.width, height: section.height },
      zIndex: 0,
      data: { section, onRename: onRenameSection, onDeleteSection, onResize,
        onEditingChange, startEditing: false },
    })),
    ...kandidResources.filter((resource) => !workspace.deletedBuiltInIds.includes(resource.id)).map((resource) => ({
      id: resource.id,
      type: 'kandidResource',
      position: workspace.positions[resource.id] || { ...resource.position },
      zIndex: 2,
      data: {
        resource: { ...resource, sectionId: membership(resource) },
        nearbyPeople: kandidPresence.present.filter((person) => person.resourceId === resource.id),
        onDelete,
      },
    })),
    ...workspace.createdResources.map((resource) => ({
      id: resource.id,
      type: resource.createdType === 'note' ? 'editableNote' : resource.createdType === 'file' ? 'kandidFile' : 'kandidResource',
      position: workspace.positions[resource.id] || { x: 500, y: 400 },
      style: resource.createdType === 'file' && canPreviewImage(resource)
        ? { width: resource.width || 320, height: resource.height || 280 }
        : undefined,
      zIndex: 2,
      data: {
        resource: { ...resource, sectionId: membership(resource) },
        nearbyPeople: [],
        onUpdate,
        onEditingChange,
        onDelete,
        onOpenLink,
        onOpenFile,
        onResize,
        startEditing: false,
      },
    })),
  ]
}

function nodeSize(node) {
  const fallback = node.type === 'editableNote' ? [250, 210]
    : node.type === 'kandidFile' ? [248, 155]
      : [260, 140]
  return {
    width: Number(node.style?.width) || node.measured?.width || fallback[0],
    height: Number(node.style?.height) || node.measured?.height || fallback[1],
  }
}

function sectionForResource(node, sections) {
  const size = nodeSize(node)
  let bestId = null
  let bestCoverage = 0.6
  for (const section of sections) {
    const sectionSize = nodeSize(section)
    const overlapWidth = Math.max(0, Math.min(node.position.x + size.width,
      section.position.x + sectionSize.width) - Math.max(node.position.x, section.position.x))
    const overlapHeight = Math.max(0, Math.min(node.position.y + size.height,
      section.position.y + sectionSize.height) - Math.max(node.position.y, section.position.y))
    const coverage = overlapWidth * overlapHeight / (size.width * size.height)
    if (coverage > bestCoverage) {
      bestCoverage = coverage
      bestId = section.id
    }
  }
  return bestId
}

function KandidCanvas({ onLeave }) {
  const workspaceRef = useRef(null)
  if (!workspaceRef.current) workspaceRef.current = readKandidWorkspace()
  const [nodes, setNodes, onNodesChange] = useNodesState(() =>
    createInitialNodes(workspaceRef.current, handleUpdateResource, handleEditingChange,
      handleDeleteResource, handleOpenLink, handleOpenFile, handleRenameSection,
      handleDeleteSection, handleResize),
  )
  const [createMode, setCreateMode] = useState(null)
  const [fileError, setFileError] = useState('')
  const nodesRef = useRef(nodes)
  const deletedBuiltInIdsRef = useRef(workspaceRef.current.deletedBuiltInIds)
  const flowRef = useRef(null)
  const canvasRef = useRef(null)
  const plusRef = useRef(null)
  const fileInputRef = useRef(null)
  const createdCountRef = useRef(0)
  const sectionDragRef = useRef(null)

  useEffect(() => { nodesRef.current = nodes }, [nodes])

  function commitNodes(updatedNodes) {
    nodesRef.current = updatedNodes
    setNodes(updatedNodes)
    saveKandidWorkspace(updatedNodes, deletedBuiltInIdsRef.current)
  }

  function handleUpdateResource(id, patch) {
    const updatedNodes = nodesRef.current.map((node) =>
      node.id === id
        ? { ...node, data: { ...node.data, resource: { ...node.data.resource, ...patch } } }
        : node,
    )
    commitNodes(updatedNodes)
  }

  function handleEditingChange(id, editing) {
    const updatedNodes = nodesRef.current.map((node) =>
      node.id === id ? { ...node, draggable: !editing } : node,
    )
    nodesRef.current = updatedNodes
    setNodes(updatedNodes)
  }

  function handleNodeDragStart(_event, node) {
    if (node.type !== 'kandidSection') return
    sectionDragRef.current = {
      id: node.id,
      origin: { ...node.position },
      members: new Map(nodesRef.current
        .filter((item) => item.data.resource?.sectionId === node.id)
        .map((item) => [item.id, { ...item.position }])),
    }
  }

  function moveSectionWithMembers(movedNode, persist) {
    const drag = sectionDragRef.current
    if (!drag || drag.id !== movedNode.id) return
    const dx = movedNode.position.x - drag.origin.x
    const dy = movedNode.position.y - drag.origin.y
    const updatedNodes = nodesRef.current.map((node) => {
      if (node.id === drag.id) return { ...node, position: movedNode.position }
      const origin = drag.members.get(node.id)
      return origin ? { ...node, position: { x: origin.x + dx, y: origin.y + dy } } : node
    })
    if (persist) commitNodes(updatedNodes)
    else { nodesRef.current = updatedNodes; setNodes(updatedNodes) }
  }

  function handleNodeDrag(_event, movedNode) {
    if (movedNode.type === 'kandidSection') moveSectionWithMembers(movedNode, false)
  }

  function handleNodeDragStop(_event, movedNode) {
    if (movedNode.type === 'kandidSection') {
      moveSectionWithMembers(movedNode, true)
      sectionDragRef.current = null
      return
    }
    const sectionId = sectionForResource(movedNode,
      nodesRef.current.filter((node) => node.type === 'kandidSection'))
    const updatedNodes = nodesRef.current.map((node) =>
      node.id === movedNode.id
        ? { ...node, position: movedNode.position,
            data: { ...node.data, resource: { ...node.data.resource, sectionId } } }
        : node,
    )
    commitNodes(updatedNodes)
  }

  function handleResize(id, params) {
    const updatedNodes = nodesRef.current.map((node) => {
      if (node.id !== id) return node
      const dimensions = { width: params.width, height: params.height }
      return {
        ...node,
        position: { x: params.x, y: params.y },
        style: dimensions,
        data: node.type === 'kandidSection'
          ? { ...node.data, section: { ...node.data.section, ...dimensions } }
          : { ...node.data, resource: { ...node.data.resource, ...dimensions } },
      }
    })
    commitNodes(updatedNodes)
  }

  function handleRenameSection(id, title) {
    commitNodes(nodesRef.current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, section: { ...node.data.section, title } } }
      : node))
  }

  async function handleDeleteSection(id) {
    commitNodes(nodesRef.current.filter((node) => node.id !== id).map((node) =>
      node.data.resource?.sectionId === id
        ? { ...node, data: { ...node.data, resource: { ...node.data.resource, sectionId: null } } }
        : node))
  }

  async function handleDeleteResource(id) {
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node) return
    const resource = node.data.resource
    if (resource.createdType === 'file') await removeLocalFile(resource.fileStorageId)
    if (!resource.createdType) {
      deletedBuiltInIdsRef.current = [...new Set([...deletedBuiltInIdsRef.current, id])]
    }
    const updatedNodes = nodesRef.current.filter((item) => item.id !== id)
    commitNodes(updatedNodes)
  }

  function handleOpenLink(resource) {
    window.open(resource.url, '_blank', 'noopener,noreferrer')
  }

  async function handleOpenFile(resource) {
    const openedWindow = canOpenLocalFile(resource) ? window.open('', '_blank') : null
    if (openedWindow) openedWindow.opener = null
    try {
      const file = await getLocalFile(resource.fileStorageId)
      if (!file) throw new Error('File missing')
      const objectUrl = URL.createObjectURL(file)
      if (openedWindow) {
        openedWindow.location.href = objectUrl
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
      } else {
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = resource.originalName
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
      }
    } catch {
      openedWindow?.close()
      setFileError('This file is no longer available locally.')
    }
  }

  function positionNearViewportCenter(width, height) {
    const bounds = canvasRef.current.getBoundingClientRect()
    const center = flowRef.current.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    })
    const offset = (createdCountRef.current++ % 4) * 22
    return { x: center.x - width / 2 + offset, y: center.y - height / 2 + offset }
  }

  function addCreatedNode(node) {
    const sectionId = node.data.resource
      ? sectionForResource(node, nodesRef.current.filter((item) => item.type === 'kandidSection'))
      : null
    const createdNode = sectionId
      ? { ...node, data: { ...node.data, resource: { ...node.data.resource, sectionId } } }
      : node
    commitNodes([...nodesRef.current, createdNode])
  }

  function createNote() {
    const id = `note-${crypto.randomUUID()}`
    const resource = {
      id,
      createdType: 'note',
      kind: 'note',
      name: 'Untitled note',
      body: '',
      typeLabel: 'Note',
      icon: 'note',
      createdAt: new Date().toISOString(),
    }
    setCreateMode(null)
    addCreatedNode({
      id,
      type: 'editableNote',
      position: positionNearViewportCenter(250, 210),
      draggable: false,
      zIndex: 2,
      data: { resource, onUpdate: handleUpdateResource, onEditingChange: handleEditingChange,
        onDelete: handleDeleteResource, startEditing: true },
    })
  }

  function createLink(link) {
    const id = `link-${crypto.randomUUID()}`
    const resource = {
      id,
      createdType: 'link',
      kind: 'external',
      ...link,
      createdAt: new Date().toISOString(),
    }
    setCreateMode(null)
    addCreatedNode({
      id,
      type: 'kandidResource',
      position: positionNearViewportCenter(245, 121),
      zIndex: 2,
      data: { resource, nearbyPeople: [], onDelete: handleDeleteResource, onOpenLink: handleOpenLink },
    })
    requestAnimationFrame(() => plusRef.current?.focus())
  }

  function createSection() {
    const id = `section-${crypto.randomUUID()}`
    const section = { id, title: 'Untitled section', createdAt: new Date().toISOString() }
    setCreateMode(null)
    addCreatedNode({
      id,
      type: 'kandidSection',
      position: positionNearViewportCenter(660, 430),
      style: { width: 660, height: 430 },
      draggable: false,
      zIndex: 0,
      data: { section, onRename: handleRenameSection, onDeleteSection: handleDeleteSection,
        onResize: handleResize, onEditingChange: handleEditingChange, startEditing: true },
    })
  }

  function pickFile() {
    setCreateMode(null)
    setFileError('')
    fileInputRef.current?.click()
  }

  async function handleFileSelected(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_LOCAL_FILE_SIZE) {
      setFileError('That file is too large for this prototype.')
      return
    }

    const id = `file-${crypto.randomUUID()}`
    const extension = file.name.includes('.') ? file.name.split('.').at(-1).toLowerCase() : ''
    const resource = {
      id,
      createdType: 'file',
      kind: 'file',
      name: file.name,
      originalName: file.name,
      fileStorageId: id,
      mimeType: file.type,
      fileSize: file.size,
      extension,
      createdAt: new Date().toISOString(),
    }
    const isImage = canPreviewImage(resource)
    if (isImage) {
      resource.width = 320
      resource.height = 280
    }
    try {
      await storeLocalFile(id, file)
      addCreatedNode({
        id,
        type: 'kandidFile',
        position: positionNearViewportCenter(isImage ? 320 : 248, isImage ? 280 : 155),
        style: isImage ? { width: 320, height: 280 } : undefined,
        zIndex: 2,
        data: { resource, onDelete: handleDeleteResource, onOpenFile: handleOpenFile, onResize: handleResize },
      })
    } catch {
      setFileError('This file could not be stored locally. Please try again.')
    }
  }

  function closeCreation() {
    setCreateMode(null)
    requestAnimationFrame(() => plusRef.current?.focus())
  }

  return (
    <main className="spatial-home kandid-home" aria-label="Kandid workspace" ref={canvasRef}>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onPaneClick={() => setNodes((current) => current.map((node) =>
          node.selected ? { ...node, selected: false } : node,
        ))}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onInit={(instance) => { flowRef.current = instance }}
        nodesConnectable={false}
        edgesFocusable={false}
        elevateNodesOnSelect={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.4}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.6, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      />
      <WorkspaceBar environmentName="Kandid" onBack={onLeave} />
      {createMode === 'menu' && (
        <BringInMenu onNote={createNote} onFile={pickFile} onLink={() => setCreateMode('link')}
          onSection={createSection} onClose={closeCreation} />
      )}
      {createMode === 'link' && (
        <CreateLinkPopover onCreate={createLink} onCancel={closeCreation} />
      )}
      <input ref={fileInputRef} type="file" hidden onChange={handleFileSelected} aria-label="Choose a file" />
      {fileError && <p className="file-upload-error" role="alert">{fileError}</p>}
      <button
        className="add-resource-control"
        type="button"
        aria-label="Bring something in"
        aria-expanded={Boolean(createMode)}
        onClick={() => {
          setFileError('')
          setCreateMode((current) => current === 'menu' ? null : 'menu')
        }}
        ref={plusRef}
      >
        <Plus size={20} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </main>
  )
}

export default KandidCanvas
