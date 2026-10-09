import { useEffect, useState } from 'react'
import { NodeResizer } from '@xyflow/react'
import { FileArchive, FileImage, FileSpreadsheet, FileText } from 'lucide-react'
import ResourceActions from './ResourceActions.jsx'
import { canOpenLocalFile, canPreviewImage, formatFileSize, getLocalFile } from '../../utils/fileStorage.js'

const icons = {
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage, svg: FileImage,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet,
  zip: FileArchive,
}

function KandidFileNode({ id, data, selected }) {
  const resource = data.resource
  const [previewUrl, setPreviewUrl] = useState(null)
  const Icon = icons[resource.extension] || FileText
  const previewable = canPreviewImage(resource)

  useEffect(() => {
    if (!previewable) return undefined
    let active = true
    let objectUrl
    getLocalFile(resource.fileStorageId).then((file) => {
      if (!active || !file) return
      objectUrl = URL.createObjectURL(file)
      setPreviewUrl(objectUrl)
    }).catch(() => {})
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [resource.fileStorageId, previewable])

  return (
    <article className={`kandid-resource kandid-file${previewable ? ' kandid-file-image' : ''}${selected ? ' is-selected' : ''}`}>
      {previewable && (
        <NodeResizer
          isVisible={selected}
          minWidth={200}
          minHeight={180}
          maxWidth={900}
          maxHeight={800}
          keepAspectRatio
          handleClassName="moseek-resizer-handle"
          lineClassName="moseek-resizer-line"
          onResizeEnd={(_event, params) => data.onResize(id, params)}
        />
      )}
      {previewable ? (
        <>
          <div className="kandid-image-stage">
            {previewUrl ? <img src={previewUrl} alt="" /> : <Icon size={22} strokeWidth={1.5} aria-hidden="true" />}
          </div>
          <div className="kandid-file-footer">
            <span>{resource.extension ? resource.extension.toUpperCase() : 'IMAGE'}</span>
            <h3 title={resource.originalName}>{resource.originalName}</h3>
            <p>{formatFileSize(resource.fileSize)}</p>
          </div>
        </>
      ) : (
        <>
          <div className="kandid-resource-type">
            <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
            <span>{resource.extension ? resource.extension.toUpperCase() : 'FILE'}</span>
          </div>
          <h3 title={resource.originalName}>{resource.originalName}</h3>
          <p>{formatFileSize(resource.fileSize)}</p>
        </>
      )}
      {selected && (
        <ResourceActions
          resource={resource}
          onOpen={data.onOpenFile}
          openLabel={canOpenLocalFile(resource) ? 'Open' : 'Download'}
          onDelete={data.onDelete}
        />
      )}
    </article>
  )
}

export default KandidFileNode
