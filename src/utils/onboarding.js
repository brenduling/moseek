const KEY_PREFIX = 'moseek:onboarding:v1:'

export const tutorialSteps = [
  { id: 'environment', title: 'A place for your work', text: 'An Environment keeps the pieces of one project together.' },
  { id: 'create', title: 'Create an Environment', text: 'Make a practice space here. It stays only in this guide.' },
  { id: 'navigate', title: 'Find your way around', text: 'Drag empty space to pan. Scroll or pinch to zoom.' },
  { id: 'section', title: 'Give things a place', text: 'Use + to add a Section. It helps group work visually.' },
  { id: 'note', title: 'Leave yourself a note', text: 'Use + to add a Note, then select it and choose Edit.' },
  { id: 'link', title: 'Bring in a link', text: 'Use + to add a Link to something elsewhere.' },
  { id: 'move', title: 'Arrange your work', text: 'Drag a Section, Note, or Link to a new place.' },
  { id: 'saving', title: 'It stays where you left it', text: 'In a real Environment, changes save when you finish editing or dragging. This practice space resets when you leave.' },
  { id: 'home', title: 'Come back anytime', text: 'Return Home to see your Environments. You can revisit this guide from More options.' },
]

export function readTutorialStatus(userId, storage) {
  try {
    const value = (storage ?? localStorage).getItem(`${KEY_PREFIX}${userId}`)
    return value === 'completed' || value === 'skipped' ? value : 'new'
  } catch { return 'new' }
}

export function saveTutorialStatus(userId, status, storage) {
  if (!['completed', 'skipped'].includes(status)) return false
  try {
    (storage ?? localStorage).setItem(`${KEY_PREFIX}${userId}`, status)
    return true
  } catch { return false }
}

export function resetTutorialStatus(userId, storage) {
  try {
    (storage ?? localStorage).removeItem(`${KEY_PREFIX}${userId}`)
    return true
  } catch { return false }
}

export function canAdvanceTutorial(stepId, actions) {
  const required = { create: 'created', navigate: 'navigated', section: 'section',
    note: 'noteEdited', link: 'link', move: 'moved' }
  return !required[stepId] || actions.has(required[stepId])
}
