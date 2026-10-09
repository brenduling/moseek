import { useCallback, useEffect, useRef, useState } from 'react'
import { FileImage, FileText, LayoutPanelTop, Link2, Plus, Upload } from 'lucide-react'
import { Controls, ReactFlow, useNodesState } from '@xyflow/react'
import WorkspaceBar from '../layout/WorkspaceBar.jsx'
import { FileNode, ImageNode, LinkNode, NoteNode, SectionNode, UnsupportedResourceNode } from './CanvasNodes.jsx'
import { supabase } from '../../lib/supabase.js'
import { deleteCanvasRow, insertCanvasRow, updateCanvasRow } from '../../lib/environmentWrites.js'
import { nodePosition, validCanvasPosition, validateLinkUrl } from '../../utils/environmentCanvas.js'
import { canvasNodeDragPatch, canvasPositionDelta, readCanvasViewport, restoreCanvasPositions, saveCanvasViewport, shouldStartNodeDrag } from '../../utils/canvasViewport.js'
import { profilePresentation } from '../../utils/profile.js'
import { readColor, saveColor } from '../../utils/personalization.js'
import { checkedColor, ColorConflictError, SERVER_COLORS_ENABLED, setSharedColor } from '../../lib/serverColors.js'
import { canEditEnvironmentContent, canManageEnvironmentContributors } from '../../lib/environmentPermissions.js'
import ContributorPanel from './ContributorPanel.jsx'
import InvitationManagementPanel from './InvitationManagementPanel.jsx'
import InvitationInboxPanel from '../layout/InvitationInboxPanel.jsx'
import EnvironmentSettingsPanel from './EnvironmentSettingsPanel.jsx'
import EnvironmentActivityPanel from './EnvironmentActivityPanel.jsx'
import EnvironmentCalendarPanel from './EnvironmentCalendarPanel.jsx'
import GlobalActivityPanel from '../layout/GlobalActivityPanel.jsx'
import GlobalCalendarPanel from '../layout/GlobalCalendarPanel.jsx'
import { environmentStoragePath, imageCardDimensions, safeOriginalFilename, validateEnvironmentUpload } from '../../lib/environmentFiles.js'
import MobileEnvironmentView from './MobileEnvironmentView.jsx'
import MobileMosaicNavigation from './MobileMosaicNavigation.jsx'

const nodeTypes = {
  section: SectionNode,
  note: NoteNode,
  link: LinkNode,
  file: FileNode,
  image: ImageNode,
  unsupported: UnsupportedResourceNode,
}

function makeNode(row, type, editable, handlers, userId) {
  return {
    id: row.id,
    type,
    position: nodePosition(row),
    style: type === 'section' || type === 'image'
      ? { width: Number(row.width), height: Number(row.height) } : undefined,
    draggable: type === 'unsupported' ? false : undefined,
    zIndex: type === 'section' ? 0 : 2,
    data: { row, canEdit: editable, color: SERVER_COLORS_ENABLED && ['note', 'section'].includes(type)
      ? checkedColor(row.card_color) : readColor(userId, type, row.id), ...handlers },
  }
}

function initialNodes(sections, resources, editable, handlers, userId) {
  return [
    ...sections.map((row) => makeNode(row, 'section', editable, handlers, userId)),
    ...resources.map((row) => makeNode(row, ['note', 'link', 'file', 'image'].includes(row.type) ? row.type : 'unsupported', editable, handlers, userId)),
  ]
}

function EnvironmentCanvas({ environment, role, sections, resources, user, profile, onLeave, onSignOut, onOpenSettings, onOpenEnvironment }) {
  const editable = canEditEnvironmentContent(role)
  const [editor, setEditor] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [needsRetry, setNeedsRetry] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [openError, setOpenError] = useState('')
  const fileInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const [contributorsOpen, setContributorsOpen] = useState(false)
  const [invitationsOpen, setInvitationsOpen] = useState(false)
  const [invitationInboxOpen, setInvitationInboxOpen] = useState(false)
  const [environmentSettingsOpen, setEnvironmentSettingsOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [globalActivityOpen, setGlobalActivityOpen] = useState(false)
  const [globalCalendarOpen, setGlobalCalendarOpen] = useState(false)
  const [sectionDiscussions, setSectionDiscussions] = useState({})
  const [openDiscussionId, setOpenDiscussionId] = useState(null)
  const [mobileSectionId, setMobileSectionId] = useState(null)
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [environmentDetails, setEnvironmentDetails] = useState(environment)
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia('(max-width: 820px)').matches)
  const busyRef = useRef(false)
  const retryRef = useRef(null)
  const dirtyRef = useRef(false)
  const nodesRef = useRef([])
  const flowRef = useRef(null)
  const canvasRef = useRef(null)
  const mobileDragRef = useRef(null)
  const mobileLayoutRef = useRef(mobileLayout)
  const createdCountRef = useRef(0)
  const [nodes, setNodes, onNodesChange] = useNodesState(() => initialNodes(sections, resources, editable,
    { onEdit: openEditor, onDelete: deleteNode, onOpen: openResource, onResize: resizeCanvasNode, onColor: changeColor }, user.id))

  useEffect(() => {
    let active = true
    if (environmentDetails.type !== 'shared') {
      return () => { active = false }
    }
    supabase.from('section_discussions').select('id,environment_id,section_id,last_message_at')
      .eq('environment_id', environment.id).then(({ data, error }) => {
        if (!active) return
        if (error) {
          setSaveError('Section Discussions could not be loaded. Refresh the Environment to try again.')
          return
        }
        setSectionDiscussions(Object.fromEntries((data || []).map((discussion) => [discussion.section_id, discussion])))
      })
    return () => { active = false }
  }, [environment.id, environmentDetails.type])

  const createDiscussion = useCallback(async (sectionId) => {
    const result = await supabase.rpc('create_section_discussion', {
      p_environment_id: environment.id, p_section_id: sectionId,
    })
    if (result.error) {
      setSaveError(result.error.message || 'The Discussion Box could not be created.')
      return
    }
    const discussion = { id: result.data, environment_id: environment.id, section_id: sectionId, last_message_at: null }
    setSectionDiscussions((current) => ({ ...current, [sectionId]: discussion }))
    setOpenDiscussionId(result.data)
    setSaveError('')
  }, [environment.id])

  const removeDiscussion = useCallback(async (discussionId) => {
    const result = await supabase.rpc('remove_section_discussion', { p_discussion_id: discussionId })
    if (result.error || result.data !== 'removed') {
      setSaveError(result.error?.message || 'The Discussion Box could not be removed.')
      return false
    }
    setSectionDiscussions((current) => Object.fromEntries(Object.entries(current)
      .filter(([, discussion]) => discussion.id !== discussionId)))
    setOpenDiscussionId(null)
    setSaveError('')
    return true
  }, [])

  const markDiscussionRead = useCallback((discussionId, lastMessageAt) => {
    setSectionDiscussions((current) => {
      const match = Object.entries(current).find(([, discussion]) => discussion.id === discussionId)
      if (!match) return current
      return { ...current, [match[0]]: { ...match[1], last_message_at: lastMessageAt || match[1].last_message_at } }
    })
  }, [])

  const displayNodes = nodes.map((node) => ({ ...node, data: {
      ...node.data,
      onMobileDragStart: (event) => startMobileNodeDrag(node.id, event),
      onMobileMove: (dx, dy) => moveNodeByKeyboard(node.id, dx, dy),
      ...(node.type !== 'section' ? {} : {
      discussion: sectionDiscussions[node.id] || null,
      discussionOpen: Boolean(sectionDiscussions[node.id] && openDiscussionId === sectionDiscussions[node.id].id),
      isDiscussionOwner: environmentDetails.type === 'shared' && role === 'owner',
      discussionRole: role,
      userId: user.id,
      onCreateDiscussion: createDiscussion,
      onOpenDiscussion: setOpenDiscussionId,
      onCloseDiscussion: () => setOpenDiscussionId(null),
      onRemoveDiscussion: removeDiscussion,
      onDiscussionRead: markDiscussionRead,
      }),
    } }))

  useEffect(() => {
    const media = window.matchMedia('(max-width: 820px)')
    const update = () => setMobileLayout(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    mobileLayoutRef.current = mobileLayout
    if (!flowRef.current) return
    const saved = readCanvasViewport(user.id, environment.id, mobileLayout ? 'mobile' : 'desktop')
    if (saved) flowRef.current.setViewport(saved, { duration: 0 })
    else flowRef.current.fitView({ padding: mobileLayout ? 0.24 : 0.15,
      minZoom: mobileLayout ? 0.34 : 0.6, maxZoom: mobileLayout ? 0.82 : 1 })
  }, [mobileLayout, environment.id, user.id])

  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => {
    function warnOnUnload(event) {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnOnUnload)
    return () => window.removeEventListener('beforeunload', warnOnUnload)
  }, [])

  function commitNodes(next) {
    nodesRef.current = next
    setNodes(next)
  }

  function updateNodeRow(row) {
    commitNodes(nodesRef.current.map((node) => node.id === row.id
      ? { ...node, position: nodePosition(row), style: ['section', 'image'].includes(node.type) && row.width != null
        ? { width: Number(row.width), height: Number(row.height) } : node.style,
      data: { ...node.data, row,
        color: SERVER_COLORS_ENABLED && ['note', 'section'].includes(node.type)
          ? checkedColor(row.card_color) : node.data.color } } : node))
  }

  async function changeColor(kind, id, color) {
    if (!editable || busyRef.current || retryRef.current) throw new Error('Finish the current save first.')
    const node = nodesRef.current.find((item) => item.id === id && item.type === kind)
    if (!node) throw new Error('This item is no longer available.')
    if (!SERVER_COLORS_ENABLED) {
      if (!saveColor(user.id, kind, id, color)) throw new Error('Could not save this color on this device.')
      commitNodes(nodesRef.current.map((item) => item.id === id
        ? { ...item, data: { ...item.data, color } } : item))
      return
    }
    busyRef.current = true
    dirtyRef.current = true
    setSaving(true)
    setSaveError('')
    setSaveStatus('Saving…')
    try {
      const row = await setSharedColor(supabase, kind, environment.id, node.data.row, color)
      updateNodeRow(row)
      dirtyRef.current = false
      setSaveStatus('Saved')
    } catch (failure) {
      setSaveStatus('')
      setSaveError(failure.message || 'This color could not be saved.')
      if (failure instanceof ColorConflictError) {
        const table = kind === 'section' ? 'sections' : 'resources'
        const latest = await supabase.from(table).select('*').eq('id', id)
          .eq('environment_id', environment.id).maybeSingle()
        if (!latest.error && latest.data) updateNodeRow(latest.data)
      }
      dirtyRef.current = false
      throw failure
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  async function runWrite(action) {
    if (busyRef.current || retryRef.current) return false
    busyRef.current = true
    dirtyRef.current = true
    setSaving(true)
    setSaveError('')
    setSaveStatus('Saving…')
    try {
      await action()
      dirtyRef.current = false
      setNeedsRetry(false)
      setSaveStatus('Saved')
      return true
    } catch (error) {
      if (error.code !== '40001' && error.code !== 'MSEEK_CONFLICT') {
        retryRef.current = action
        setNeedsRetry(true)
      } else {
        retryRef.current = null
        setNeedsRetry(false)
      }
      setSaveError(error.message || 'This change could not be saved.')
      setSaveStatus('')
      return false
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  async function retrySave() {
    const action = retryRef.current
    if (!action || busyRef.current) return
    retryRef.current = null
    setNeedsRetry(false)
    await runWrite(action)
  }

  function leave(action) {
    if (dirtyRef.current && !window.confirm('A change has not saved yet. Leave this Environment?')) return
    action()
  }

  function openEditor(kind, id) {
    if (!editable || busyRef.current || retryRef.current) return
    const row = nodesRef.current.find((node) => node.id === id)?.data.row
    if (!row) return
    setSaveError('')
    setEditor({ mode: 'edit', kind, id, title: row.title, body: row.body || '', url: row.url || '' })
  }

  function positionNearCenter(width, height) {
    const offset = (createdCountRef.current++ % 4) * 22
    if (!flowRef.current || !canvasRef.current) {
      const existing = nodesRef.current
      const x = existing.length ? Math.max(...existing.map((node) => Number(node.data.row?.x ?? node.position.x) || 0)) + 36 : 80
      const y = existing.length ? Math.max(...existing.map((node) => Number(node.data.row?.y ?? node.position.y) || 0)) + 36 : 100
      return { x: x + offset, y: y + offset }
    }
    const bounds = canvasRef.current.getBoundingClientRect()
    if (!bounds.width || !bounds.height) {
      const existing = nodesRef.current
      const x = existing.length ? Math.max(...existing.map((node) => Number(node.data.row?.x ?? node.position.x) || 0)) + 36 : 80
      const y = existing.length ? Math.max(...existing.map((node) => Number(node.data.row?.y ?? node.position.y) || 0)) + 36 : 100
      return { x: x + offset, y: y + offset }
    }
    const center = flowRef.current.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
    return { x: Math.round(center.x - width / 2 + offset), y: Math.round(center.y - height / 2 + offset) }
  }

  function startCreate(kind) {
    if (!editable || busyRef.current || retryRef.current) return
    const [width, height] = kind === 'section' ? [660, 430] : kind === 'note' ? [250, 210] : [245, 121]
    setSaveError('')
    setEditor({ mode: 'create', kind, id: crypto.randomUUID(), title: '', body: '', url: '',
      position: positionNearCenter(width, height), width, height })
    setMenuOpen(false)
  }

  async function uploadResource(file, kind) {
    if (!file) return
    if (!editable || busyRef.current || retryRef.current) {
      setUploading(false)
      return
    }
    let type
    let originalFilename
    let dimensions = {}
    try {
      type = validateEnvironmentUpload(file, kind)
      originalFilename = safeOriginalFilename(file.name)
      if (kind === 'image') dimensions = await imageCardDimensions(file)
    } catch (failure) {
      setSaveError(failure.message)
      setSaveStatus('')
      setUploading(false)
      return
    }
    setSaveError('')

    const id = crypto.randomUUID()
    const path = environmentStoragePath(environment.id, id, type.extension)
    const title = (originalFilename.replace(/\.[^.]+$/, '').trim() || originalFilename).slice(0, 200)
    const cardWidth = kind === 'image' ? dimensions.width : 250
    const cardHeight = kind === 'image' ? dimensions.height : 150
    const position = positionNearCenter(cardWidth, cardHeight)
    const values = {
      id, environment_id: environment.id, section_id: mobileSectionId || null, created_by: user.id,
      type: kind, title, original_filename: originalFilename, mime_type: type.mime,
      file_size: file.size, storage_path: path, x: position.x, y: position.y,
      ...(kind === 'image' ? dimensions : {}),
    }

    setMenuOpen(false)
    const saved = await runWrite(async () => {
      const existing = await supabase.from('resources').select('*')
        .eq('environment_id', environment.id).eq('id', id).maybeSingle()
      if (existing.error) throw existing.error
      if (existing.data && (existing.data.storage_path !== path || existing.data.type !== kind)) {
        throw new Error('This upload no longer matches its saved file entry.')
      }
      const row = existing.data || await insertCanvasRow(supabase, 'resources', values)
      setSaveStatus('Uploading…')
      const uploaded = await supabase.storage.from('environment-files').upload(path, file, {
        contentType: type.mime, upsert: false,
      })
      if (uploaded.error) {
        const existing = uploaded.error.statusCode === '409'
          ? await supabase.storage.from('environment-files').download(path)
          : { error: uploaded.error }
        if (existing.error || !existing.data) {
          const cleanup = await supabase.storage.from('environment-files').remove([path])
          if (cleanup.error) throw new Error('Upload did not finish. Its exact file entry was kept so cleanup can be retried.')
          const cleanupRow = await supabase.from('resources').delete().eq('environment_id', environment.id).eq('id', id)
          if (cleanupRow.error) throw new Error('Upload did not finish. The incomplete file entry remains and can be retried.')
          throw uploaded.error
        }
      }
      const activityResult = await supabase.rpc('record_environment_resource_upload', { p_resource_id: id })
      if (activityResult.error || activityResult.data !== 'recorded') {
        throw new Error('The upload finished, but its activity could not be saved. Retry to finish linking it to this Environment.')
      }
      const node = makeNode(row, kind, editable, {
        onEdit: openEditor, onDelete: deleteNode, onOpen: openResource,
        onResize: resizeCanvasNode, onColor: changeColor,
      }, user.id)
      commitNodes([...nodesRef.current, node])
    })
    setUploading(false)
    if (!saved) setUploading(false)
  }

  function handleUploadSelection(event, kind) {
    const [file] = event.target.files || []
    event.target.value = ''
    if (file) {
      setUploading(true)
      uploadResource(file, kind).catch((failure) => {
        setUploading(false)
        setSaveError(failure.message || 'This file could not be added.')
        setSaveStatus('')
      })
    }
  }

  async function submitEditor(event) {
    event.preventDefault()
    if (!editor || busyRef.current || retryRef.current) return
    const draft = { ...editor, title: editor.title.trim() }
    if (!draft.title) { setSaveError('Give this item a title.'); return }
    if (draft.title.length > (draft.kind === 'section' ? 160 : 200)) { setSaveError('That title is too long.'); return }
    try {
      if (draft.kind === 'link') draft.url = validateLinkUrl(draft.url)
    } catch (error) { setSaveError(error.message); return }

    const table = draft.kind === 'section' ? 'sections' : 'resources'
    await runWrite(async () => {
      let row
      if (draft.mode === 'create') {
        const base = { id: draft.id, environment_id: environment.id, created_by: user.id,
          title: draft.title, x: draft.position.x, y: draft.position.y }
        const values = draft.kind === 'section'
          ? { ...base, width: draft.width, height: draft.height }
          : draft.kind === 'note'
            ? { ...base, section_id: mobileSectionId || null, type: 'note', body: draft.body }
            : { ...base, section_id: mobileSectionId || null, type: 'link', url: draft.url }
        row = await insertCanvasRow(supabase, table, values)
        if (!nodesRef.current.some((node) => node.id === row.id)) commitNodes([...nodesRef.current,
          makeNode(row, draft.kind, editable, { onEdit: openEditor, onDelete: deleteNode, onOpen: openResource,
            onResize: resizeCanvasNode, onColor: changeColor }, user.id)])
      } else {
        const patch = draft.kind === 'section' ? { title: draft.title }
          : draft.kind === 'note' ? { title: draft.title, body: draft.body }
            : { title: draft.title, url: draft.url }
        row = await updateCanvasRow(supabase, table, environment.id, draft.id, patch)
        updateNodeRow(row)
      }
      setEditor(null)
    })
  }

  async function deleteNode(id) {
    if (!editable || busyRef.current || retryRef.current) return
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node || node.type === 'unsupported') return
    const table = node.type === 'section' ? 'sections' : 'resources'
    await runWrite(async () => {
      if (['file', 'image'].includes(node.type) && node.data.row.storage_path) {
        const storageResult = await supabase.storage.from('environment-files').remove([node.data.row.storage_path])
        if (storageResult.error) throw new Error('The private file could not be removed. Its Resource was kept.')
      }
      await deleteCanvasRow(supabase, table, environment.id, id)
      if (!SERVER_COLORS_ENABLED && ['note', 'section'].includes(node.type)) saveColor(user.id, node.type, id, 'neutral')
      commitNodes(nodesRef.current.filter((item) => item.id !== id).map((item) =>
        node.type === 'section' && item.data.row.section_id === id
          ? { ...item, data: { ...item.data, row: { ...item.data.row, section_id: null } } }
          : item))
    })
  }

  function openLink(resource) {
    try {
      const url = validateLinkUrl(resource.url)
      window.open(url, '_blank', 'noopener,noreferrer')
      setOpenError('')
    } catch (error) {
      setOpenError(error.message)
    }
  }

  async function openPrivateResource(resource) {
    const { data, error } = await supabase.storage.from('environment-files')
      .createSignedUrl(resource.storage_path, 120, { download: resource.original_filename || resource.title })
    if (error || !data?.signedUrl) {
      setOpenError('This private file could not be opened. Check your Environment access and try again.')
      return
    }
    if (window.matchMedia('(max-width: 820px)').matches) window.location.assign(data.signedUrl)
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    setOpenError('')
  }

  function openResource(resource) {
    if (resource.url) openLink(resource)
    else openPrivateResource(resource)
  }

  async function persistPosition(node, patch) {
    if (!editable || busyRef.current || retryRef.current || !validCanvasPosition(patch)
      || (patch.width !== undefined && (!Number.isFinite(patch.width) || !Number.isFinite(patch.height)))) {
      const saved = nodesRef.current.find((item) => item.id === node.id)?.data.row
      if (saved) commitNodes(nodesRef.current.map((item) => item.id === node.id
        ? { ...item, position: nodePosition(saved),
            style: node.type === 'section' ? { width: Number(saved.width), height: Number(saved.height) } : item.style }
        : item))
      return
    }
    const table = node.type === 'section' ? 'sections' : 'resources'
    commitNodes(nodesRef.current.map((item) => item.id === node.id
      ? { ...item, position: { x: patch.x, y: patch.y },
          style: ['section', 'image'].includes(node.type) && patch.width ? { width: patch.width, height: patch.height } : item.style }
      : item.data.isDropTarget ? { ...item, data: { ...item.data, isDropTarget: false } } : item))
    const saved = await runWrite(async () => {
      const row = await updateCanvasRow(supabase, table, environment.id, node.id, patch, node.data.row.updated_at)
      updateNodeRow(row)
    })
    if (!saved) {
      const latest = await supabase.from(table).select('*').eq('environment_id', environment.id).eq('id', node.id).maybeSingle()
      if (!latest.error && latest.data) updateNodeRow(latest.data)
      else if (!latest.error) commitNodes(nodesRef.current.filter((item) => item.id !== node.id))
      if (!retryRef.current) setSaveError('This item changed elsewhere. Its latest saved position was restored.')
    }
  }

  function resizeCanvasNode(id, params) {
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node) return
    if (node.type === 'section') {
      persistSectionGroup(node, { x: params.x, y: params.y, width: params.width, height: params.height })
    } else if (node.type === 'image') {
      persistPosition(node, { x: params.x, y: params.y, width: params.width, height: params.height })
    }
  }

  function sectionDropTarget(resourceNode) {
    const width = Number(resourceNode.measured?.width || resourceNode.width || resourceNode.style?.width || 245)
    const height = Number(resourceNode.measured?.height || resourceNode.height || resourceNode.style?.height || 150)
    const centerX = resourceNode.position.x + width / 2
    const centerY = resourceNode.position.y + height / 2
    return nodesRef.current.find((section) => {
      if (section.type !== 'section') return false
      const sectionWidth = Number(section.measured?.width || section.width || section.style?.width || section.data.row.width)
      const sectionHeight = Number(section.measured?.height || section.height || section.style?.height || section.data.row.height)
      return centerX >= section.position.x + 24 && centerX <= section.position.x + sectionWidth - 24
        && centerY >= section.position.y + 52 && centerY <= section.position.y + sectionHeight - 24
    })?.id || null
  }

  function applyMobileDrag(active, flowPoint) {
    const delta = canvasPositionDelta(active.startFlow, flowPoint)
    const dragged = active.snapshot.find((item) => item.id === active.id)
    if (!dragged) return
    const position = { x: dragged.position.x + delta.x, y: dragged.position.y + delta.y }
    const provisional = { ...nodesRef.current.find((item) => item.id === active.id), position }
    const targetSectionId = provisional.type === 'section' ? null : sectionDropTarget(provisional)
    active.targetSectionId = targetSectionId
    commitNodes(nodesRef.current.map((node) => {
      const original = active.snapshot.find((item) => item.id === node.id)
      if (!original) return node
      if (node.id === active.id) return { ...node, position, data: { ...node.data, isDropTarget: false } }
      if (dragged.type === 'section' && node.type !== 'section' && node.data.row.section_id === dragged.id) {
        return { ...node, position: { x: original.position.x + delta.x, y: original.position.y + delta.y } }
      }
      if (node.type === 'section') return { ...node, position: original.position,
        data: { ...node.data, isDropTarget: node.id === targetSectionId } }
      return { ...node, position: original.position }
    }))
  }

  function startMobileNodeDrag(id, event) {
    if (!mobileLayoutRef.current || !editable || locked || busyRef.current || retryRef.current
      || event.button !== 0 || !event.isPrimary || mobileDragRef.current) return
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node || !['section', 'note', 'link', 'file', 'image'].includes(node.type)) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    mobileDragRef.current = {
      id, pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY },
      startFlow: flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      snapshot: nodesRef.current.map((item) => ({ id: item.id, position: { ...item.position } })),
      originalNode: node, moved: false, targetSectionId: node.data.row.section_id || null,
    }
  }

  function handleMobilePointerDownCapture(event) {
    const active = mobileDragRef.current
    if (active && active.pointerId !== event.pointerId) cancelMobileNodeDrag()
  }

  function handleMobilePointerMove(event) {
    const active = mobileDragRef.current
    if (!active || active.pointerId !== event.pointerId || !flowRef.current) return
    const distance = Math.hypot(event.clientX - active.startClient.x, event.clientY - active.startClient.y)
    if (!active.moved && !shouldStartNodeDrag(distance)) return
    active.moved = true
    event.preventDefault()
    applyMobileDrag(active, flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }

  function handleMobilePointerUp(event) {
    const active = mobileDragRef.current
    if (!active || active.pointerId !== event.pointerId) return
    mobileDragRef.current = null
    if (!active.moved) return
    const moved = nodesRef.current.find((node) => node.id === active.id)
    if (!moved) return
    if (moved.type === 'section') {
      const row = active.originalNode.data.row
      persistSectionGroup(active.originalNode, { x: moved.position.x, y: moved.position.y,
        width: Number(moved.measured?.width || moved.width || moved.style?.width || row.width),
        height: Number(moved.measured?.height || moved.height || moved.style?.height || row.height) })
    } else {
      const patch = canvasNodeDragPatch(moved, active.targetSectionId)
      persistPosition(active.originalNode, patch)
    }
  }

  function cancelMobileNodeDrag() {
    const active = mobileDragRef.current
    if (!active) return
    mobileDragRef.current = null
    commitNodes(restoreCanvasPositions(nodesRef.current, active.snapshot))
  }

  function handleLostMobilePointerCapture(event) {
    if (mobileDragRef.current?.pointerId === event.pointerId) cancelMobileNodeDrag()
  }

  function moveNodeByKeyboard(id, dx, dy) {
    if (!mobileLayoutRef.current || !editable || locked || busyRef.current || retryRef.current) return
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node) return
    const target = { x: node.position.x + dx, y: node.position.y + dy }
    if (node.type === 'section') {
      persistSectionGroup(node, { ...target,
        width: Number(node.measured?.width || node.width || node.style?.width || node.data.row.width),
        height: Number(node.measured?.height || node.height || node.style?.height || node.data.row.height) })
      return
    }
    const provisional = { ...node, position: target }
    persistPosition(node, canvasNodeDragPatch(provisional, sectionDropTarget(provisional)))
  }

  function handleNodeDrag(_event, draggedNode) {
    if (draggedNode.type === 'section') {
      const origin = nodePosition(draggedNode.data.row)
      const dx = draggedNode.position.x - origin.x
      const dy = draggedNode.position.y - origin.y
      commitNodes(nodesRef.current.map((node) => {
        if (node.id === draggedNode.id) return { ...node, position: draggedNode.position }
        if (node.type !== 'section' && node.data.row.section_id === draggedNode.id) {
          return { ...node, position: { x: Number(node.data.row.x) + dx, y: Number(node.data.row.y) + dy } }
        }
        return node.data.isDropTarget ? { ...node, data: { ...node.data, isDropTarget: false } } : node
      }))
      return
    }
    if (!['note', 'link', 'file', 'image'].includes(draggedNode.type)) return
    const targetId = sectionDropTarget(draggedNode)
    commitNodes(nodesRef.current.map((node) => node.type === 'section'
      ? { ...node, data: { ...node.data, isDropTarget: node.id === targetId } } : node))
  }

  async function persistSectionGroup(node, target) {
    if (!editable || busyRef.current || retryRef.current || !validCanvasPosition(target)) return
    const sectionId = node.id
    const dx = target.x - Number(node.data.row.x)
    const dy = target.y - Number(node.data.row.y)
    commitNodes(nodesRef.current.map((item) => {
      if (item.id === sectionId) return { ...item, position: { x: target.x, y: target.y },
        style: { width: target.width, height: target.height }, data: { ...item.data, isDropTarget: false } }
      if (item.type !== 'section' && item.data.row.section_id === sectionId) {
        return { ...item, position: { x: Number(item.data.row.x) + dx, y: Number(item.data.row.y) + dy } }
      }
      return item.data.isDropTarget ? { ...item, data: { ...item.data, isDropTarget: false } } : item
    }))
    const saved = await runWrite(async () => {
      const result = await supabase.rpc('move_section_group', {
        p_environment_id: environment.id, p_section_id: sectionId,
        p_x: target.x, p_y: target.y, p_width: target.width, p_height: target.height,
        p_expected_updated_at: node.data.row.updated_at,
      })
      if (result.error || !result.data?.section) throw result.error || new Error('This Section could not be moved.')
      const moved = new Map((result.data.resources || []).map((row) => [row.id, row]))
      moved.set(result.data.section.id, result.data.section)
      commitNodes(nodesRef.current.map((item) => {
        const row = moved.get(item.id)
        if (!row) return item
        return { ...item, position: nodePosition(row), style: item.type === 'section'
          ? { width: Number(row.width), height: Number(row.height) } : item.style,
        data: { ...item.data, row, isDropTarget: false } }
      }))
    })
    if (!saved && !retryRef.current) {
      const [latestSection, latestResources] = await Promise.all([
        supabase.from('sections').select('*').eq('environment_id', environment.id).eq('id', sectionId).maybeSingle(),
        supabase.from('resources').select('*').eq('environment_id', environment.id).eq('section_id', sectionId),
      ])
      if (!latestSection.error && latestSection.data && !latestResources.error) {
        const latestRows = new Map([[sectionId, latestSection.data], ...(latestResources.data || []).map((row) => [row.id, row])])
        commitNodes(nodesRef.current.map((item) => {
          const row = latestRows.get(item.id)
          return row ? { ...item, position: nodePosition(row), style: item.type === 'section'
            ? { width: Number(row.width), height: Number(row.height) } : item.style, data: { ...item.data, row } } : item
        }))
      } else commitNodes(nodesRef.current.map((item) => {
      if (item.id === sectionId || (item.type !== 'section' && item.data.row.section_id === sectionId)) {
        return { ...item, position: nodePosition(item.data.row), style: item.type === 'section'
          ? { width: Number(item.data.row.width), height: Number(item.data.row.height) } : item.style,
        data: { ...item.data, isDropTarget: false } }
      }
      return item.data.isDropTarget ? { ...item, data: { ...item.data, isDropTarget: false } } : item
      }))
      setSaveError('This Section changed elsewhere. Its latest saved layout was restored.')
    } else if (!saved) commitNodes(nodesRef.current.map((item) => {
      if (item.id === sectionId || (item.type !== 'section' && item.data.row.section_id === sectionId)) {
        return { ...item, position: nodePosition(item.data.row), style: item.type === 'section'
          ? { width: Number(item.data.row.width), height: Number(item.data.row.height) } : item.style,
        data: { ...item.data, isDropTarget: false } }
      }
      return item.data.isDropTarget ? { ...item, data: { ...item.data, isDropTarget: false } } : item
    }))
  }

  function handleNodeDragStop(_event, draggedNode) {
    if (draggedNode.type === 'section') {
      const row = draggedNode.data.row
      return persistSectionGroup(draggedNode, {
        x: draggedNode.position.x, y: draggedNode.position.y,
        width: Number(draggedNode.measured?.width || draggedNode.width || draggedNode.style?.width || row.width),
        height: Number(draggedNode.measured?.height || draggedNode.height || draggedNode.style?.height || row.height),
      })
    }
    if (!['note', 'link', 'file', 'image'].includes(draggedNode.type)) return
    const sectionId = sectionDropTarget(draggedNode)
    const patch = { x: draggedNode.position.x, y: draggedNode.position.y }
    if ((draggedNode.data.row.section_id || null) !== sectionId) patch.section_id = sectionId
    return persistPosition(draggedNode, patch)
  }

  const locked = saving || uploading || needsRetry
  const presented = profilePresentation(user, profile)
  const canManageInvitations = canManageEnvironmentContributors(role)

  async function moveResource(row, sectionId) {
    if (!editable || busyRef.current || retryRef.current || (row.section_id || null) === sectionId) return
    await runWrite(async () => {
      const updated = await updateCanvasRow(supabase, 'resources', environment.id, row.id,
        { section_id: sectionId }, row.updated_at)
      updateNodeRow(updated)
    })
  }

  function triggerMobileUpload(kind) {
    const input = kind === 'image' ? imageInputRef.current : fileInputRef.current
    input?.click()
  }

  function closeEnvironmentSettings() {
    setEnvironmentSettingsOpen(false)
    requestAnimationFrame(() => document.getElementById(window.matchMedia('(max-width: 820px)').matches
      ? 'mobile-environment-more-trigger' : 'environment-settings-trigger')?.focus())
  }

  return <main className={`spatial-home environment-canvas${locked ? ' is-locked' : ''}${mobileLayout && mobileListOpen ? ' is-mobile-list' : ''}`}
    ref={canvasRef} aria-label={`${environmentDetails.name} workspace`} onPointerDownCapture={handleMobilePointerDownCapture}
    onPointerMove={handleMobilePointerMove} onPointerUp={handleMobilePointerUp} onPointerCancel={cancelMobileNodeDrag}
    onLostPointerCapture={handleLostMobilePointerCapture}>
    <ReactFlow className="environment-desktop-canvas" nodes={mobileLayout && mobileListOpen ? [] : displayNodes} edges={[]} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
      onNodeDrag={handleNodeDrag} onNodeDragStop={handleNodeDragStop}
      onInit={(instance) => { flowRef.current = instance
        const saved = readCanvasViewport(user.id, environment.id, mobileLayoutRef.current ? 'mobile' : 'desktop')
        if (saved) instance.setViewport(saved, { duration: 0 })
        else instance.fitView({ padding: mobileLayoutRef.current ? 0.24 : 0.15,
          minZoom: mobileLayoutRef.current ? 0.34 : 0.6, maxZoom: mobileLayoutRef.current ? 0.82 : 1 })
      }} onMoveEnd={(_event, viewport) => saveCanvasViewport(user.id, environment.id,
        mobileLayoutRef.current ? 'mobile' : 'desktop', viewport)} nodesConnectable={false}
      nodesDraggable={editable && !locked && !mobileLayout} elevateNodesOnSelect={false}
      panOnDrag zoomOnScroll zoomOnPinch zoomOnDoubleClick={false}
      minZoom={mobileLayout ? 0.2 : 0.4} maxZoom={mobileLayout ? 2 : 1.5}
      proOptions={{ hideAttribution: true }}>
      <Controls position="bottom-left" showZoom showFitView showInteractive={false}
        fitViewOptions={{ padding: mobileLayout ? 0.24 : 0.15, minZoom: mobileLayout ? 0.34 : 0.6, maxZoom: mobileLayout ? 0.82 : 1 }} />
    </ReactFlow>
    {mobileLayout && !mobileListOpen && <MobileMosaicNavigation environment={environmentDetails} canEdit={editable}
      canManageInvitations={canManageInvitations}
      hasMembers={environmentDetails.type === 'shared'} onBack={() => leave(onLeave)} onList={() => {
        setMobileListOpen(true)
        requestAnimationFrame(() => document.getElementById('mobile-environment-view-mosaic-toggle')?.focus())
      }}
      onAdd={() => setMenuOpen((open) => !open)}
      onSettings={() => { setContributorsOpen(false); setInvitationsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setEnvironmentSettingsOpen((open) => !open) }}
      onContributors={() => { setEnvironmentSettingsOpen(false); setInvitationsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setContributorsOpen((open) => !open) }}
      onInvitations={() => { setContributorsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setInvitationsOpen((open) => !open) }}
      onInbox={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setCalendarOpen(false); setActivityOpen(false); setInvitationInboxOpen((open) => !open) }}
      onActivity={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setGlobalActivityOpen(false); setGlobalCalendarOpen(false); setActivityOpen((open) => !open) }}
      onCalendar={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setActivityOpen(false); setGlobalActivityOpen(false); setGlobalCalendarOpen(false); setCalendarOpen((open) => !open) }}
      onGlobalActivity={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setGlobalCalendarOpen(false); setGlobalActivityOpen((open) => !open) }}
      onGlobalCalendar={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setGlobalActivityOpen(false); setGlobalCalendarOpen((open) => !open) }}
      onProfileSettings={onOpenSettings} onSignOut={() => leave(onSignOut)} />}
    {mobileLayout && mobileListOpen && <MobileEnvironmentView environment={environmentDetails} canEdit={editable}
      canManageInvitations={canManageInvitations} nodes={displayNodes}
      locked={locked} onBack={() => leave(onLeave)} onCreate={(kind) => startCreate(kind || 'note')}
      onReturnToMosaic={() => {
        setMobileListOpen(false); setMobileSectionId(null)
        requestAnimationFrame(() => document.getElementById('mobile-mosaic-list-trigger')?.focus())
      }}
      onUpload={triggerMobileUpload} onMove={moveResource}
      onFocusSection={setMobileSectionId}
      discussionNode={displayNodes.find((node) => node.type === 'section' && node.id === mobileSectionId)}
      onOpenSettings={() => { setContributorsOpen(false); setInvitationsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setEnvironmentSettingsOpen((open) => !open) }}
      onOpenProfileSettings={onOpenSettings}
      onOpenContributors={() => { setEnvironmentSettingsOpen(false); setInvitationsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setContributorsOpen((open) => !open) }}
      onOpenInvitations={() => { setContributorsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setInvitationsOpen((open) => !open) }}
      onOpenInbox={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setCalendarOpen(false); setActivityOpen(false); setInvitationInboxOpen((open) => !open) }}
      onOpenActivity={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setGlobalActivityOpen(false); setGlobalCalendarOpen(false); setActivityOpen((open) => !open) }}
      onOpenCalendar={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setActivityOpen(false); setGlobalActivityOpen(false); setGlobalCalendarOpen(false); setCalendarOpen((open) => !open) }}
      onOpenGlobalActivity={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setGlobalCalendarOpen(false); setGlobalActivityOpen((open) => !open) }}
      onOpenGlobalCalendar={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setGlobalActivityOpen(false); setGlobalCalendarOpen((open) => !open) }}
      onSignOut={() => leave(onSignOut)} />}
    <WorkspaceBar environmentName={environmentDetails.name} environmentType={environmentDetails.type}
      onBack={() => leave(onLeave)}
      onSignOut={() => leave(onSignOut)} onOpenSettings={() => leave(onOpenSettings)}
      onShowEnvironmentSettings={() => {
        setContributorsOpen(false)
        setInvitationsOpen(false)
        setCalendarOpen(false); setActivityOpen(false)
        if (environmentSettingsOpen) closeEnvironmentSettings()
        else setEnvironmentSettingsOpen(true)
      }}
      environmentSettingsExpanded={environmentSettingsOpen}
      onShowContributors={environmentDetails.type === 'shared' ? () => {
        setEnvironmentSettingsOpen(false)
        setInvitationsOpen(false)
        setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false)
        setContributorsOpen((open) => !open)
      } : undefined}
      contributorsExpanded={contributorsOpen}
      canManageContributors={canManageEnvironmentContributors(role)}
      onOpenInvitationInbox={() => {
        setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setCalendarOpen(false); setActivityOpen(false)
        setInvitationInboxOpen((open) => !open)
      }} invitationInboxExpanded={invitationInboxOpen}
      onOpenCalendar={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setActivityOpen(false); setCalendarOpen((open) => !open) }}
      calendarExpanded={calendarOpen}
      onOpenActivity={() => { setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false); setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen((open) => !open) }}
      activityExpanded={activityOpen}
      onOpenGlobalActivity={() => {
        setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false)
        setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setGlobalCalendarOpen(false)
        setGlobalActivityOpen((open) => !open)
      }}
      onOpenGlobalCalendar={() => {
        setContributorsOpen(false); setInvitationsOpen(false); setEnvironmentSettingsOpen(false)
        setInvitationInboxOpen(false); setCalendarOpen(false); setActivityOpen(false); setGlobalActivityOpen(false)
        setGlobalCalendarOpen((open) => !open)
      }}
      userEmail={user.email} avatarName={presented.displayName} avatarUrl={presented.avatarUrl} />
    {environmentSettingsOpen && <EnvironmentSettingsPanel environment={environmentDetails} role={role}
      onClose={closeEnvironmentSettings} onSaved={setEnvironmentDetails}
      onOpenContributors={() => { setEnvironmentSettingsOpen(false); setContributorsOpen(true) }}
      onOpenInvitations={() => { setEnvironmentSettingsOpen(false); setInvitationsOpen(true) }} />}
    {contributorsOpen && environmentDetails.type === 'shared' && <ContributorPanel environmentId={environment.id}
      actorId={user.id} actorRole={role} onClose={() => setContributorsOpen(false)}
      onManageInvitations={canManageEnvironmentContributors(role) ? () => { setContributorsOpen(false); setInvitationsOpen(true) } : undefined} />}
    {invitationsOpen && environmentDetails.type === 'shared' && canManageEnvironmentContributors(role) &&
      <InvitationManagementPanel environmentId={environment.id} actorRole={role} onClose={() => setInvitationsOpen(false)} />}
    {invitationInboxOpen && <InvitationInboxPanel onClose={() => setInvitationInboxOpen(false)} />}
    {calendarOpen && <EnvironmentCalendarPanel environmentId={environment.id} role={role} userId={user.id}
      sections={sections} resources={resources} onClose={() => setCalendarOpen(false)} />}
    {activityOpen && <EnvironmentActivityPanel environmentId={environment.id} onClose={() => setActivityOpen(false)} />}
    {globalActivityOpen && <GlobalActivityPanel onClose={() => setGlobalActivityOpen(false)}
      onOpenEnvironment={(id) => { setGlobalActivityOpen(false); onOpenEnvironment({ id }) }} />}
    {globalCalendarOpen && <GlobalCalendarPanel onClose={() => setGlobalCalendarOpen(false)}
      onOpenEnvironment={(id) => { setGlobalCalendarOpen(false); onOpenEnvironment({ id }) }} />}
    {nodes.length === 0 && <div className="environment-canvas-empty">
      <p>Nothing here yet. Bring in a Section, Note, Link, File, or Image to start arranging this space.</p>
      {editable && <button type="button" onClick={() => setMenuOpen(true)}>Bring something in</button>}
      <small>Drag empty space to pan. Scroll or pinch to zoom.</small>
    </div>}
    {editable && <>
      {menuOpen && <section className="bring-in-popover environment-bring-in" aria-label="Bring something in"
        onKeyDown={(event) => { if (event.key === 'Escape') setMenuOpen(false) }}>
        <h2>Bring something in</h2>
        <button className="bring-in-option" type="button" onClick={() => startCreate('note')}><FileText size={18} aria-hidden="true" /><span><strong>Note</strong><small>Write something here</small></span></button>
        <button className="bring-in-option" type="button" onClick={() => startCreate('link')}><Link2 size={18} aria-hidden="true" /><span><strong>Link</strong><small>Bring in something from elsewhere</small></span></button>
        <button className="bring-in-option" type="button" onClick={() => startCreate('section')}><LayoutPanelTop size={18} aria-hidden="true" /><span><strong>Section</strong><small>Organize an area of this Environment</small></span></button>
        <button className="bring-in-option" type="button" onClick={() => { setMenuOpen(false); fileInputRef.current?.click() }} disabled={locked}>
          <Upload size={18} aria-hidden="true" /><span><strong>Add File</strong><small>PDF, Word, Excel, PowerPoint, or text · up to 25 MB</small></span></button>
        <button className="bring-in-option" type="button" onClick={() => { setMenuOpen(false); imageInputRef.current?.click() }} disabled={locked}>
          <FileImage size={18} aria-hidden="true" /><span><strong>Add Image</strong><small>JPEG, PNG, WebP, or GIF · up to 25 MB</small></span></button>
      </section>}
      {editor && <section className="bring-in-popover link-popover environment-editor" role="dialog" aria-modal="false" aria-label={`${editor.mode === 'create' ? 'Create' : 'Edit'} ${editor.kind}`}>
        <h2>{editor.mode === 'create' ? 'Add' : 'Edit'} {editor.kind === 'section' ? 'Section' : editor.kind}</h2>
        <form onSubmit={submitEditor}>
          <label htmlFor="environment-item-title">Title</label>
          <input id="environment-item-title" autoFocus maxLength={editor.kind === 'section' ? 160 : 200}
            value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} disabled={saving} required />
          {editor.kind === 'note' && <><label htmlFor="environment-note-body">Note</label>
            <textarea id="environment-note-body" value={editor.body}
              onChange={(event) => setEditor({ ...editor, body: event.target.value })} disabled={saving} /></>}
          {editor.kind === 'link' && <><label htmlFor="environment-link-url">URL</label>
            <input id="environment-link-url" type="url" inputMode="url" placeholder="https://…"
              value={editor.url} onChange={(event) => setEditor({ ...editor, url: event.target.value })} disabled={saving} required /></>}
          <div className="link-popover-actions">
            <button className="link-cancel" type="button" onClick={() => { setEditor(null); setSaveError('') }} disabled={locked}>Cancel</button>
            <button className="link-submit" type="submit" disabled={locked}>{saving ? 'Saving…' : 'Done'}</button>
          </div>
        </form>
      </section>}
      <button className="add-resource-control" type="button" aria-label="Bring something in" aria-expanded={menuOpen || Boolean(editor)}
        disabled={locked || Boolean(editor)} onClick={() => setMenuOpen((value) => !value)}>
        <Plus size={20} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <input ref={fileInputRef} className="visually-hidden" type="file"
        accept=".pdf,.docx,.xlsx,.pptx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
        aria-label="Choose a document file" disabled={locked} onChange={(event) => handleUploadSelection(event, 'file')} />
      <input ref={imageInputRef} className="visually-hidden" type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
        aria-label="Choose an image" disabled={locked} onChange={(event) => handleUploadSelection(event, 'image')} />
    </>}
    {(saving || saveStatus || saveError) && <div className={`environment-save-state${saveError ? ' has-error' : ''}`} role={saveError ? 'alert' : 'status'}>
      <span>{saveError ? `Could not save: ${saveError}` : saving ? 'Saving…' : saveStatus}</span>
      {needsRetry && <button type="button" onClick={retrySave} disabled={saving}>Retry</button>}
    </div>}
    {openError && <p className="environment-open-error" role="alert">{openError}</p>}
  </main>
}

export default EnvironmentCanvas
