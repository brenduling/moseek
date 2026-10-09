import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowLeft, CalendarDays, File, FileArchive, FileImage, FileSpreadsheet, FileText, Link2, LogOut, Mail, MessageCircle, MoreHorizontal, Plus, Presentation, Settings2, StickyNote } from 'lucide-react'
import ColorPicker from '../layout/ColorPicker.jsx'
import ResourceActions from '../kandid/ResourceActions.jsx'
import { classifyFile, linkIdentity } from '../../utils/resourceIdentity.js'
import { formatFileSize } from '../../utils/fileStorage.js'
import SectionDiscussionBox from './SectionDiscussionBox.jsx'
import { supabase } from '../../lib/supabase.js'
import { mobileEnvironmentGroups } from '../../utils/mobileEnvironment.js'

function resourceLabel(type) {
  return ({ note: 'Note', link: 'Link', file: 'File', image: 'Image' })[type] || 'Resource'
}

function ResourceIcon({ type, fileKind }) {
  const fileIcons = { pdf: FileText, image: FileImage, document: FileText, spreadsheet: FileSpreadsheet,
    presentation: Presentation, archive: FileArchive, file: File }
  const Icon = type === 'file' ? fileIcons[fileKind] || File : ({ note: StickyNote, link: Link2, image: FileImage })[type] || File
  return <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
}

function MobileResource({ node, sections, canEdit, onMove }) {
  const [faviconFailed, setFaviconFailed] = useState(false)
  const [imagePreview, setImagePreview] = useState('')
  const { row, color, onEdit, onDelete, onOpen, onColor } = node.data
  useEffect(() => {
    if (node.type !== 'image' || !row.storage_path) return undefined
    let active = true
    supabase.storage.from('environment-files').createSignedUrl(row.storage_path, 3600)
      .then(({ data, error }) => { if (active && !error) setImagePreview(data?.signedUrl || '') })
    return () => { active = false }
  }, [node.type, row.storage_path])
  const identity = node.type === 'link' ? linkIdentity(row.url) : null
  const fileType = node.type === 'file' ? classifyFile(row) : null
  const supported = ['note', 'link', 'file', 'image'].includes(node.type)
  const Icon = node.type === 'link' && identity?.faviconUrl && !faviconFailed
    ? <img className="link-favicon" src={identity.faviconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFaviconFailed(true)} />
    : <ResourceIcon type={node.type} fileKind={fileType?.kind} />
  return <article className={`mobile-environment-resource mobile-resource-${node.type}`} data-color={node.type === 'note' ? color : undefined}>
    <div className="mobile-resource-heading"><span className="mobile-resource-kind">{Icon}<span>{resourceLabel(node.type)}</span></span>
      {node.type === 'note' && canEdit && <ColorPicker value={color} itemName={row.title} onChange={(next) => onColor('note', row.id, next)} />}
      {supported && <ResourceActions resource={{ id: row.id, name: row.title, url: row.url }}
        onEdit={canEdit && ['note', 'link'].includes(node.type) ? () => onEdit(node.type, row.id) : undefined}
        onOpen={node.type !== 'note' ? (node.type === 'link' ? () => onOpen(row) : () => onOpen(row)) : undefined}
        openLabel={node.type === 'link' ? 'Open link' : `Open ${resourceLabel(node.type).toLowerCase()}`}
        onDelete={canEdit ? onDelete : undefined}
        confirmationTitle={`Remove this ${resourceLabel(node.type)}?`}
        confirmationMessage={['file', 'image'].includes(node.type)
          ? `The private ${node.type} and its Environment card will be removed.`
          : `This ${resourceLabel(node.type)} will be removed from the Environment.`} />}
    </div>
    <h3>{row.title}</h3>
    {node.type === 'note' && <p className="mobile-resource-body">{row.body || 'Nothing here yet.'}</p>}
    {node.type === 'link' && <p className="mobile-resource-secondary">{row.url}</p>}
    {node.type === 'file' && <p className="mobile-resource-secondary">{fileType.label} · {row.original_filename || row.mime_type || 'File'}
      {row.file_size != null && ` · ${formatFileSize(Number(row.file_size))}`}</p>}
    {node.type === 'image' && <p className="mobile-resource-secondary">{row.original_filename || row.mime_type || 'Image'}
      {row.file_size != null && ` · ${formatFileSize(Number(row.file_size))}`}</p>}
    {node.type === 'image' && (imagePreview ? <button type="button" className="mobile-image-preview" onClick={() => onOpen(row)} aria-label={`Open image ${row.title}`}>
      <img src={imagePreview} alt={row.title} loading="lazy" /></button>
      : <p className="mobile-resource-secondary" role="status">Private image preview unavailable.</p>)}
    {node.type === 'unsupported' && <p className="mobile-resource-secondary">This resource type is not available for editing on this device.</p>}
    {canEdit && supported && <label className="mobile-resource-location">In Section
      <select aria-label={`Move ${row.title} to a Section`} value={row.section_id || ''}
        onChange={(event) => onMove(row, event.target.value || null)}>
        <option value="">Outside a Section</option>
        {sections.map((section) => <option key={section.id} value={section.id}>{section.data.row.title}</option>)}
      </select>
    </label>}
  </article>
}

function MobileSectionCard({ node, count, canEdit, onOpen, onDiscuss }) {
  const row = node.data.row
  return <article className="mobile-environment-section" data-color={node.data.color}>
    <button type="button" className="mobile-section-open" onClick={onOpen}>
      <span className="mobile-section-kicker">Section</span><strong>{row.title}</strong>
      <span className="mobile-section-count">{count} {count === 1 ? 'resource' : 'resources'}</span>
    </button>
    <div className="mobile-section-actions">
      {canEdit && <ColorPicker value={node.data.color} itemName={row.title} onChange={(color) => node.data.onColor('section', row.id, color)} />}
      {node.data.discussion && <button type="button" className="mobile-icon-button" aria-label={`Open ${row.title} discussion`}
        onClick={onDiscuss}><MessageCircle size={17} aria-hidden="true" /></button>}
      {!node.data.discussion && node.data.isDiscussionOwner && <button type="button" className="mobile-text-button" onClick={onDiscuss}>Add discussion</button>}
      {canEdit && <ResourceActions resource={{ id: row.id, name: row.title }}
        onEdit={() => node.data.onEdit('section', row.id)} onDelete={node.data.onDelete} editLabel="Rename"
        deleteLabel="Delete Section" confirmationTitle="Delete this Section?"
        confirmationMessage="Resources inside it will stay in this Environment." />}
    </div>
  </article>
}

export default function MobileEnvironmentView({ environment, nodes, locked, onBack, onCreate, onUpload,
  canEdit, canManageInvitations, onMove, onFocusSection, onOpenSettings, onOpenProfileSettings, onOpenContributors, onOpenInvitations, onOpenInbox, onOpenActivity,
  onOpenCalendar, onOpenGlobalActivity, onOpenGlobalCalendar, onSignOut, discussionNode, onReturnToMosaic }) {
  const [sectionId, setSectionId] = useState(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const sectionHistoryActive = useRef(false)
  const { sections, resources, focusedSection: focused, visibleResources, sectionCounts: counts } = mobileEnvironmentGroups(nodes, sectionId)
  const discussion = discussionNode?.data?.discussion
  const discussionIsOpen = Boolean(discussion && discussionNode?.data.discussionOpen)

  useEffect(() => {
    function restoreOverview() {
      if (!sectionHistoryActive.current) return
      sectionHistoryActive.current = false
      setSectionId(null)
      onFocusSection?.(null)
    }
    window.addEventListener('popstate', restoreOverview)
    return () => window.removeEventListener('popstate', restoreOverview)
  }, [onFocusSection])

  function openTool(tool) { setMoreOpen(false); tool?.() }
  function focusSection(id) {
    if (!id && sectionId && sectionHistoryActive.current) { window.history.back(); return }
    if (id && !sectionId && !sectionHistoryActive.current) {
      window.history.pushState({ ...(window.history.state || {}), moseekMobileSection: true }, '', window.location.href)
      sectionHistoryActive.current = true
    }
    setSectionId(id)
    onFocusSection?.(id)
  }
  return <section className="mobile-environment-view" aria-label={`${environment.name} mobile workspace`}>
    <header className="mobile-environment-heading">
        <button type="button" className="mobile-back-button" onClick={focused ? () => focusSection(null) : onBack} aria-label={focused ? 'Back to Environment overview' : 'Back to Home'}>
        <ArrowLeft size={19} aria-hidden="true" />
      </button>
      <div className="mobile-environment-heading-copy"><span>{environment.type === 'personal' ? 'Personal Environment' : 'Shared Environment'}</span>
        <h1>{focused?.data.row.title || environment.name}</h1></div>
      <button id="mobile-environment-view-mosaic-toggle" type="button" className="mobile-environment-view-toggle" onClick={onReturnToMosaic} aria-label="Return to spatial Environment mosaic">Mosaic</button>
      {canEdit && <button type="button" className="mobile-environment-add" disabled={locked} onClick={onCreate}><Plus size={18} aria-hidden="true" /><span>Add</span></button>}
    </header>

    <div className="mobile-environment-content">
      {focused ? <>
        <div className="mobile-section-intro"><p>Resources in this Section stay together when you arrange your Environment.</p>
          {focused.data.discussion && <button type="button" onClick={() => discussionNode?.data.onOpenDiscussion(focused.data.discussion.id)}><MessageCircle size={16} aria-hidden="true" /> Discussion</button>}
          {!focused.data.discussion && focused.data.isDiscussionOwner && <button type="button" onClick={() => discussionNode?.data.onCreateDiscussion(focused.id)}><MessageCircle size={16} aria-hidden="true" /> Add discussion</button>}
        </div>
        {visibleResources.length ? <div className="mobile-resource-list">{visibleResources.map((node) => <MobileResource key={node.id} node={node} sections={sections} canEdit={canEdit} onMove={onMove} />)}</div>
          : <div className="mobile-environment-empty"><h2>This Section is ready</h2><p>Add a Note, Link, File, or Image to begin.</p></div>}
      </> : <>
        <div className="mobile-environment-summary"><p>{environment.description || 'A place for your notes, links, files, and ideas.'}</p>
          <span>{resources.length + sections.length} items</span>
        </div>
        {sections.length > 0 && <section className="mobile-sections-list" aria-labelledby="mobile-sections-title">
          <div className="mobile-list-heading"><h2 id="mobile-sections-title">Sections</h2><span>{sections.length}</span></div>
          {sections.map((node) => <MobileSectionCard key={node.id} node={node} count={counts[node.id]} canEdit={canEdit}
            onOpen={() => focusSection(node.id)} onDiscuss={() => { focusSection(node.id); node.data.discussion
              ? node.data.onOpenDiscussion(node.data.discussion.id) : node.data.onCreateDiscussion(node.id) }} />)}
        </section>}
        {visibleResources.length > 0 && <section className="mobile-resources-list" aria-labelledby="mobile-resources-title">
          <div className="mobile-list-heading"><h2 id="mobile-resources-title">{sections.length ? 'Outside Sections' : 'Resources'}</h2><span>{visibleResources.length}</span></div>
          <div className="mobile-resource-list">{visibleResources.map((node) => <MobileResource key={node.id} node={node} sections={sections} canEdit={canEdit} onMove={onMove} />)}</div>
        </section>}
        {sections.length === 0 && visibleResources.length === 0 && <div className="mobile-environment-empty"><h2>Your space is ready</h2>
          <p>Bring in a Section, Note, Link, File, or Image to start arranging this Environment.</p>
          {canEdit && <button type="button" className="mobile-primary-action" disabled={locked} onClick={onCreate}>Bring something in</button>}
        </div>}
      </>}
    </div>

    <nav className="mobile-bottom-nav" aria-label="Environment navigation">
      <button type="button" aria-current={!focused ? 'page' : undefined} onClick={() => focusSection(null)}><span className="mobile-nav-mark" aria-hidden="true">m</span><small>Space</small></button>
      <button type="button" onClick={() => openTool(onOpenCalendar)}><CalendarDays size={19} aria-hidden="true"/><small>Calendar</small></button>
      <button type="button" onClick={() => openTool(onOpenActivity)}><Activity size={19} aria-hidden="true"/><small>Activity</small></button>
      {environment.type === 'shared' && <button type="button" onClick={() => openTool(onOpenContributors)}><span className="mobile-nav-mark" aria-hidden="true">+</span><small>People</small></button>}
      <button id="mobile-environment-more-trigger" type="button" aria-expanded={moreOpen} aria-controls="mobile-environment-more" onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal size={20} aria-hidden="true"/><small>More</small></button>
    </nav>
    {moreOpen && <div className="mobile-more-sheet" id="mobile-environment-more" role="group" aria-label="More Environment options">
      <button type="button" onClick={() => openTool(onOpenSettings)}><Settings2 size={18} aria-hidden="true"/>Environment settings</button>
      {environment.type === 'shared' && <button type="button" onClick={() => openTool(onOpenContributors)}>View contributors</button>}
      {environment.type === 'shared' && canManageInvitations && <button type="button" onClick={() => openTool(onOpenInvitations)}>Invitations</button>}
      <button type="button" onClick={() => openTool(onOpenInbox)}><Mail size={18} aria-hidden="true"/>Invitation inbox</button>
      <button type="button" onClick={() => openTool(onOpenGlobalActivity)}><Activity size={18} aria-hidden="true"/>All activity</button>
      <button type="button" onClick={() => openTool(onOpenGlobalCalendar)}><CalendarDays size={18} aria-hidden="true"/>All calendar events</button>
      <button type="button" onClick={() => openTool(onOpenProfileSettings)}><Settings2 size={18} aria-hidden="true"/>Profile and settings</button>
      <button type="button" onClick={() => openTool(onSignOut)}><LogOut size={18} aria-hidden="true"/>Sign out</button>
    </div>}
    {canEdit && !moreOpen && <div className="mobile-quick-add" role="group" aria-label="Add to Environment">
      <button type="button" disabled={locked} onClick={() => onCreate('note')}><StickyNote size={17} aria-hidden="true"/><span>Note</span></button>
      <button type="button" disabled={locked} onClick={() => onCreate('link')}><Link2 size={17} aria-hidden="true"/><span>Link</span></button>
      <button type="button" disabled={locked} onClick={() => onCreate('section')}><span className="mobile-nav-mark" aria-hidden="true">+</span><span>Section</span></button>
      <button type="button" disabled={locked} onClick={() => onUpload('file')}><File size={17} aria-hidden="true"/><span>File</span></button>
      <button type="button" disabled={locked} onClick={() => onUpload('image')}><FileImage size={17} aria-hidden="true"/><span>Image</span></button>
    </div>}
    {discussionIsOpen && <SectionDiscussionBox discussion={discussion} userId={discussionNode.data.userId}
      role={discussionNode.data.discussionRole} sectionTitle={discussionNode.data.row.title}
      onClose={discussionNode.data.onCloseDiscussion} onRemove={discussionNode.data.onRemoveDiscussion}
      onRead={discussionNode.data.onDiscussionRead} />}
  </section>
}
