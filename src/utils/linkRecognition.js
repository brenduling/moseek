function readableLastSegment(pathname) {
  const segment = pathname.split('/').filter(Boolean).at(-1)
  if (!segment) return ''

  try {
    return decodeURIComponent(segment).replace(/[-_]+/g, ' ').trim()
  } catch {
    return segment.replace(/[-_]+/g, ' ').trim()
  }
}

function isHost(hostname, domain) {
  return hostname === domain || hostname === `www.${domain}`
}

export function recognizeLink(input) {
  const raw = input.trim()
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error('Use a full http:// or https:// link.')
  }

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Enter a valid link.')
  }

  if (!['http:', 'https:'].includes(parsed.protocol) ||
      (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) {
    throw new Error('Enter a valid http:// or https:// link.')
  }

  const hostname = parsed.hostname.toLowerCase()
  const lastSegment = readableLastSegment(parsed.pathname)
  const detail = `${hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`

  if (isHost(hostname, 'github.com')) {
    return { url: parsed.toString(), service: 'github', typeLabel: 'GitHub', icon: 'github', name: lastSegment || 'GitHub', detail }
  }
  if (isHost(hostname, 'figma.com')) {
    return { url: parsed.toString(), service: 'figma', typeLabel: 'Figma', icon: 'figma', name: 'Figma File', detail }
  }
  if (isHost(hostname, 'docs.google.com')) {
    return { url: parsed.toString(), service: 'google-docs', typeLabel: 'Google Docs', icon: 'googleDocs', name: 'Google Doc', detail }
  }
  if (isHost(hostname, 'drive.google.com')) {
    return { url: parsed.toString(), service: 'google-drive', typeLabel: 'Google Drive', icon: 'googleDrive', name: 'Google Drive file', detail }
  }

  return { url: parsed.toString(), service: 'link', typeLabel: 'Link', icon: 'link', name: lastSegment || hostname, detail }
}
