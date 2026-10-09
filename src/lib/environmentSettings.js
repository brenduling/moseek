export const ENVIRONMENT_NAME_MAX_LENGTH = 160
export const ENVIRONMENT_DESCRIPTION_MAX_LENGTH = 2000

export function validateEnvironmentSettings(name, description) {
  const cleanName = typeof name === 'string' ? name.trim() : ''
  const cleanDescription = typeof description === 'string' ? description.trim() : ''

  if (!cleanName) throw new Error('Give this Environment a name.')
  if (cleanName.length > ENVIRONMENT_NAME_MAX_LENGTH) {
    throw new Error(`Environment names can be up to ${ENVIRONMENT_NAME_MAX_LENGTH} characters.`)
  }
  if (cleanDescription.length > ENVIRONMENT_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`Descriptions can be up to ${ENVIRONMENT_DESCRIPTION_MAX_LENGTH} characters.`)
  }

  return { name: cleanName, description: cleanDescription || null }
}
