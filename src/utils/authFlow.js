export const MIN_PASSWORD_LENGTH = 12

export function passwordChecks(password, confirmation) {
  return {
    length: password.length >= MIN_PASSWORD_LENGTH,
    match: password.length > 0 && password === confirmation,
  }
}

export function authReturnUrl(location) {
  return `${location.origin}${import.meta.env?.BASE_URL || '/'}`
}

export function recoveryReturnUrl(location) {
  return `${authReturnUrl(location)}?auth=recovery`
}

export function oauthReturnError(location) {
  const search = new URLSearchParams(location.search)
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  return search.has('error') || hash.has('error')
}

export function authReturnMessage(location) {
  if (!oauthReturnError(location)) return ''
  const search = new URLSearchParams(location.search)
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  const code = search.get('error_code') || hash.get('error_code')
  if (code === 'otp_expired' && search.get('auth') === 'recovery') {
    return 'This reset link has expired or already been used. Request another reset link from sign in.'
  }
  if (code === 'otp_expired') return 'This link has expired or already been used. Sign in if your email is confirmed, or request a new confirmation link.'
  if (code === 'access_denied') return 'Sign-in was not completed. You can try again.'
  return 'This sign-in link could not be used. It may have expired. Please try again.'
}
