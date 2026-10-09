const PREFIX = 'moseek:appearance:v1:'
export const LAST_USER_KEY = 'moseek:last-user-id:v1'
export const APPEARANCE_MODES = ['light', 'dark', 'system']

export function readAppearance(userId, storage) {
  if (!userId) return 'system'
  try {
    const value = (storage ?? localStorage).getItem(`${PREFIX}${userId}`)
    return APPEARANCE_MODES.includes(value) ? value : 'system'
  } catch { return 'system' }
}

export function saveAppearance(userId, mode, storage) {
  if (!userId || !APPEARANCE_MODES.includes(mode)) return false
  try {
    (storage ?? localStorage).setItem(`${PREFIX}${userId}`, mode)
    return true
  } catch { return false }
}

export function rememberAppearanceUser(userId, storage) {
  try {
    if (userId) (storage ?? localStorage).setItem(LAST_USER_KEY, userId)
    else (storage ?? localStorage).removeItem(LAST_USER_KEY)
  } catch { /* Appearance still works without storage. */ }
}

export function resolveAppearance(mode, prefersDark) {
  return mode === 'dark' || (mode !== 'light' && prefersDark) ? 'dark' : 'light'
}

export function applyAppearance(mode, root = document.documentElement, media = window.matchMedia('(prefers-color-scheme: dark)')) {
  const resolved = resolveAppearance(mode, media.matches)
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  return resolved
}
