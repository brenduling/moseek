export const ENVIRONMENT_FILE_LIMIT = 25 * 1024 * 1024
export const IMAGE_CARD_LIMITS = { minWidth: 160, minHeight: 100, maxWidth: 720, maxHeight: 560 }

const DOCUMENT_TYPES = {
  pdf: { mime: 'application/pdf', label: 'PDF' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word document' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Spreadsheet' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'Presentation' },
  txt: { mime: 'text/plain', label: 'Text file' },
}

const IMAGE_TYPES = {
  jpg: { mime: 'image/jpeg', label: 'JPEG image' },
  jpeg: { mime: 'image/jpeg', label: 'JPEG image' },
  png: { mime: 'image/png', label: 'PNG image' },
  webp: { mime: 'image/webp', label: 'WebP image' },
  gif: { mime: 'image/gif', label: 'GIF image' },
}

export function validateEnvironmentUpload(file, kind) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > ENVIRONMENT_FILE_LIMIT) {
    throw new Error('Choose a file smaller than 25 MB.')
  }
  const extension = file.name.split('.').pop()?.toLowerCase()
  const types = kind === 'image' ? IMAGE_TYPES : DOCUMENT_TYPES
  const type = types[extension]
  if (!type) throw new Error(kind === 'image'
    ? 'Choose a JPEG, PNG, WebP, or GIF image.'
    : 'Choose a PDF, DOCX, XLSX, PPTX, or TXT file.')
  if (file.type && file.type !== type.mime && !(extension === 'jpg' && file.type === 'image/pjpeg')) {
    throw new Error('This file’s type does not match its extension.')
  }
  return { ...type, extension, kind }
}

export function safeOriginalFilename(filename) {
  const base = String(filename || '').split(/[\\/]/).pop() || ''
  const clean = Array.from(base).filter((character) => {
    const code = character.codePointAt(0)
    return code >= 32 && code !== 127
  }).join('').trim()
  if (!clean) throw new Error('This file needs a name before it can be added.')
  return clean.slice(0, 255)
}

export function environmentStoragePath(environmentId, resourceId, extension) {
  return `${environmentId}/${resourceId}/${crypto.randomUUID()}.${extension}`
}

export async function imageCardDimensions(file) {
  let bitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error('This image could not be opened by the browser.') }
  const aspect = bitmap.width / bitmap.height
  const sourceWidth = bitmap.width
  const sourceHeight = bitmap.height
  bitmap.close()
  if (!Number.isFinite(aspect) || aspect < 0.3 || aspect > 7.1) {
    throw new Error('This image has an aspect ratio that cannot fit the canvas safely.')
  }
  const { minWidth, minHeight, maxWidth, maxHeight } = IMAGE_CARD_LIMITS
  const scale = Math.min(320 / sourceWidth, 420 / sourceHeight)
  const width = Math.max(minWidth, Math.min(maxWidth, Math.round(sourceWidth * scale)))
  const height = Math.max(minHeight, Math.min(maxHeight, Math.round(width / aspect)))
  return { width, height }
}
