import { NodeResizeControl, NodeResizer } from '@xyflow/react'
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, Grip, Link2, MessageCircle, Presentation, StickyNote } from 'lucide-react'
import ResourceActions from '../kandid/ResourceActions.jsx'
import ColorPicker from '../layout/ColorPicker.jsx'
import { linkIdentity, classifyFile } from '../../utils/resourceIdentity.js'
import { formatFileSize } from '../../utils/fileStorage.js'
import { supabase } from '../../lib/supabase.js'
import { useEffect, useState } from 'react'
import SectionDiscussionBox from './SectionDiscussionBox.jsx'

function MobileDragHandle({ label, onStart, onMove }) {
  if (!onStart) return null
  return <button type="button" className="mobile-mosaic-drag-handle nodrag nopan" title={`Drag to move ${label}`}
    aria-label={`Move ${label}. Drag to reposition, or use the arrow keys.`}
    onPointerDown={(event) => { event.stopPropagation(); onStart(event) }}
    onKeyDown={(event) => {
      const vectors = { ArrowUp: [0, -24], ArrowDown: [0, 24], ArrowLeft: [-24, 0], ArrowRight: [24, 0] }
      const vector = vectors[event.key]
      if (!vector || !onMove) return
      event.preventDefault()
      event.stopPropagation()
      const scale = event.shiftKey ? 4 : 1
      onMove(vector[0] * scale, vector[1] * scale)
    }}>
    <Grip size={17} strokeWidth={1.8} aria-hidden="true" />
  </button>
}

export function SectionNode({ id, data, selected }) {
  const section = data.row
  return <div className={`kandid-section${selected ? ' is-selected' : ''}${data.isDropTarget ? ' is-drop-target' : ''}`} data-color={data.color}>
    <NodeResizer isVisible={selected && data.canEdit} minWidth={360} minHeight={240}
      maxWidth={1400} maxHeight={1000} handleClassName="moseek-resizer-handle"
      lineClassName="moseek-resizer-line" onResizeEnd={(_event, params) => data.onResize(id, params)} />
    <div className="section-heading"><MobileDragHandle label={section.title} onStart={data.canEdit ? data.onMobileDragStart : undefined} onMove={data.canEdit ? data.onMobileMove : undefined} /><h2 title={section.title}>{section.title}</h2>
      <div className="section-heading-actions">
        {data.discussion && <button type="button" className="section-discussion-trigger nodrag nopan"
          aria-expanded={data.discussionOpen} onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); data.onOpenDiscussion(data.discussion.id) }}>
          <MessageCircle size={14} aria-hidden="true" /><span>Discussion</span>
        </button>}
        {!data.discussion && selected && data.isDiscussionOwner && <button type="button"
          className="section-discussion-trigger nodrag nopan" onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); data.onCreateDiscussion(id) }}>
          <MessageCircle size={14} aria-hidden="true" /><span>Add Discussion</span>
        </button>}
        {selected && data.canEdit && <ColorPicker value={data.color} itemName={section.title}
          onChange={(color) => data.onColor('section', id, color)} />}
      </div></div>
    {selected && data.canEdit && <ResourceActions resource={{ id, name: section.title }}
      onEdit={() => data.onEdit('section', id)} editLabel="Rename"
      onDelete={data.onDelete} deleteLabel="Delete section"
      confirmationTitle="Delete this Section?"
      confirmationMessage={data.discussion
        ? 'Resources inside it will stay in this Environment. Its Discussion Box and messages will also be removed.'
        : 'Resources inside it will stay in this Environment.'} />}
    {data.discussion && data.discussionOpen && <SectionDiscussionBox discussion={data.discussion}
      userId={data.userId} role={data.discussionRole} sectionTitle={section.title}
      onClose={data.onCloseDiscussion} onRemove={data.onRemoveDiscussion} onRead={data.onDiscussionRead} />}
  </div>
}

export function NoteNode({ data, selected }) {
  const note = data.row
  return <article className={`kandid-resource kandid-resource-note editable-note${selected ? ' is-selected' : ''}`} data-color={data.color}>
    <div className="kandid-resource-type"><MobileDragHandle label={note.title} onStart={data.canEdit ? data.onMobileDragStart : undefined} onMove={data.canEdit ? data.onMobileMove : undefined} /><StickyNote size={17} strokeWidth={1.75} aria-hidden="true" /><span>Note</span>
      {selected && data.canEdit && <ColorPicker value={data.color} itemName={note.title}
        onChange={(color) => data.onColor('note', note.id, color)} />}</div>
    <h3 title={note.title}>{note.title}</h3>
    <p className="note-body-preview">{note.body || 'Nothing here yet.'}</p>
    {selected && data.canEdit && <ResourceActions resource={{ id: note.id, name: note.title }}
      onEdit={() => data.onEdit('note', note.id)} onDelete={data.onDelete}
      confirmationTitle="Delete this Note?" confirmationMessage="This Note will be removed from the Environment." />}
  </article>
}

function LinkMark({ faviconUrl }) {
  const [faviconFailed, setFaviconFailed] = useState(false)
  return faviconUrl && !faviconFailed
    ? <img className="link-favicon" src={faviconUrl} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={() => setFaviconFailed(true)} />
    : <Link2 size={17} strokeWidth={1.75} aria-hidden="true" />
}

export function LinkNode({ data, selected }) {
  const link = data.row
  const identity = linkIdentity(link.url)
  return <article className={`kandid-resource kandid-resource-external${selected ? ' is-selected' : ''}`}>
    <div className="kandid-resource-type"><MobileDragHandle label={link.title} onStart={data.canEdit ? data.onMobileDragStart : undefined} onMove={data.canEdit ? data.onMobileMove : undefined} /><LinkMark key={identity.faviconUrl || link.url}
      faviconUrl={identity.faviconUrl} /><span>Link</span></div>
    <h3 title={link.title}>{link.title}</h3>
    <p title={link.url}>{link.url}</p>
    {selected && <ResourceActions resource={{ id: link.id, name: link.title, url: link.url }}
      onOpen={data.onOpen} openLabel="Open link"
      onEdit={data.canEdit ? () => data.onEdit('link', link.id) : undefined}
      onDelete={data.canEdit ? data.onDelete : undefined}
      confirmationTitle="Delete this Link?" confirmationMessage="This Link will be removed from the Environment." />}
  </article>
}

const fileIcons = { pdf: FileText, image: FileImage, document: FileText,
  spreadsheet: FileSpreadsheet, presentation: Presentation, archive: FileArchive, file: File }

export function FileNode({ data, selected }) {
  const file = data.row
  const type = classifyFile(file)
  const Icon = fileIcons[type.kind]
  return <article className="kandid-resource kandid-file environment-file" aria-label={`${type.label}: ${file.title}`}>
    <div className="kandid-resource-type"><MobileDragHandle label={file.title} onStart={data.canEdit ? data.onMobileDragStart : undefined} onMove={data.canEdit ? data.onMobileMove : undefined} /><Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span>{type.label}</span></div>
    <h3 title={file.original_filename || file.title}>{file.title}</h3>
    <p title={file.original_filename || ''}>{file.original_filename || 'File'}</p>
    {file.file_size != null && <p>{formatFileSize(Number(file.file_size))}</p>}
    {selected && <ResourceActions resource={{ id: file.id, name: file.title }}
      onOpen={() => data.onOpen(file)} openLabel="Open or download file"
      onDelete={data.canEdit ? data.onDelete : undefined} deleteLabel="Remove file"
      confirmationTitle="Remove this file?" confirmationMessage="The private file and its Environment card will be removed." />}
  </article>
}

export function ImageNode({ id, data, selected }) {
  const image = data.row
  const [preview, setPreview] = useState('loading')
  const [signedUrl, setSignedUrl] = useState('')

  useEffect(() => {
    let active = true
    supabase.storage.from('environment-files').createSignedUrl(image.storage_path, 3600)
      .then(({ data: result, error }) => {
        if (!active) return
        if (error || !result?.signedUrl) setPreview('unavailable')
        else { setSignedUrl(result.signedUrl); setPreview('ready') }
      })
    return () => { active = false }
  }, [image.storage_path])

  return <article className={`environment-image-card${selected ? ' is-selected' : ''}`} aria-label={`Image: ${image.title}`}>
    {selected && data.canEdit && <NodeResizeControl nodeId={id} position="bottom-right" keepAspectRatio
      minWidth={160} minHeight={100} maxWidth={720} maxHeight={560}
      className="environment-image-resize-handle" onResizeEnd={(_event, params) => data.onResize(id, params)} />}
    {preview === 'ready' ? <img className="environment-image-preview" src={signedUrl} alt={image.title} draggable="false" />
      : <div className="environment-image-fallback" role={preview === 'unavailable' ? 'status' : undefined}>
        {preview === 'loading' ? 'Loading image…' : 'Preview unavailable'}
      </div>}
    <div className="environment-image-caption"><MobileDragHandle label={image.title} onStart={data.canEdit ? data.onMobileDragStart : undefined} onMove={data.canEdit ? data.onMobileMove : undefined} /><strong title={image.title}>{image.title}</strong>
      <span>{formatFileSize(Number(image.file_size))}</span></div>
    {selected && <ResourceActions resource={{ id: image.id, name: image.title }}
      onOpen={() => data.onOpen(image)} openLabel="Open image"
      onDelete={data.canEdit ? data.onDelete : undefined} deleteLabel="Remove image"
      confirmationTitle="Remove this image?" confirmationMessage="The private image and its Environment card will be removed." />}
  </article>
}

export function UnsupportedResourceNode({ data }) {
  return <article className="kandid-resource kandid-resource-work">
    <div className="kandid-resource-type"><FileText size={17} strokeWidth={1.75} aria-hidden="true" /><span>{data.row.type}</span></div>
    <h3>{data.row.title}</h3>
    <p>This Resource is not available in this canvas yet.</p>
  </article>
}
