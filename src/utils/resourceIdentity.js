import { validateLinkUrl } from './environmentCanvas.js'

function isPublicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host.includes('.') || host === 'localhost' || /\.(local|localhost|internal|test|invalid|example)$/.test(host)) return false
  if (host.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(host)) return false
  return true
}

export function linkIdentity(rawUrl) {
  try {
    const parsed = new URL(validateLinkUrl(rawUrl))
    return { hostname: parsed.hostname, faviconUrl: parsed.protocol === 'https:' && isPublicHostname(parsed.hostname)
      ? `${parsed.origin}/favicon.ico` : null }
  } catch { return { hostname: '', faviconUrl: null } }
}

const image = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic'])
const archive = new Set(['zip', 'rar', '7z', 'tar', 'gz'])
const document = new Set(['doc', 'docx', 'odt', 'rtf'])
const spreadsheet = new Set(['xls', 'xlsx', 'ods', 'csv'])
const presentation = new Set(['ppt', 'pptx', 'odp'])

export function classifyFile(row) {
  const mime = String(row?.mime_type || '').toLowerCase().split(';')[0].trim()
  const extension = String(row?.original_filename || '').toLowerCase().split('.').pop()
  if (mime === 'application/pdf') return { kind: 'pdf', label: 'PDF' }
  if (mime.startsWith('image/')) return { kind: 'image', label: 'Image' }
  if (/wordprocessingml|msword|opendocument\.text/.test(mime)) return { kind: 'document', label: 'Document' }
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv/.test(mime)) return { kind: 'spreadsheet', label: 'Spreadsheet' }
  if (/presentationml|ms-powerpoint|opendocument\.presentation/.test(mime)) return { kind: 'presentation', label: 'Presentation' }
  if (/zip|compressed|gzip|x-tar|x-rar|x-7z/.test(mime)) return { kind: 'archive', label: 'Archive' }
  if (mime && !['application/octet-stream', 'binary/octet-stream'].includes(mime)) return { kind: 'file', label: 'File' }
  if (extension === 'pdf') return { kind: 'pdf', label: 'PDF' }
  if (image.has(extension)) return { kind: 'image', label: 'Image' }
  if (archive.has(extension)) return { kind: 'archive', label: 'Archive' }
  if (document.has(extension)) return { kind: 'document', label: 'Document' }
  if (spreadsheet.has(extension)) return { kind: 'spreadsheet', label: 'Spreadsheet' }
  if (presentation.has(extension)) return { kind: 'presentation', label: 'Presentation' }
  return { kind: 'file', label: 'File' }
}
