export const environments = [
  {
    id: 'kandid',
    name: 'Kandid',
    kind: 'Shared',
    members: 5,
    presence: ['B', 'R', 'C', '+2'],
    size: 'large',
    position: { x: 560, y: 205 },
    resources: [
      { label: 'Manuscript', icon: 'file', x: 13, y: 24, tone: 'paper' },
      { label: 'GitHub', icon: 'github', x: 57, y: 16, tone: 'compact' },
      { label: 'Figma', icon: 'figma', x: 39, y: 51, tone: 'compact' },
      { label: 'Supabase', icon: 'database', x: 68, y: 68, tone: 'compact' },
    ],
    signal: 'Ruth revised Chapter 4 · 18m',
  },
  {
    id: 'dict-startup',
    name: 'DICT Startup',
    kind: 'Shared',
    members: 3,
    presence: ['B', 'C', 'M'],
    size: 'medium',
    position: { x: 1085, y: 365 },
    resources: [
      { label: 'Pitch Deck', icon: 'presentation', x: 13, y: 25, tone: 'paper' },
      { label: 'Prototype', icon: 'layout', x: 53, y: 45, tone: 'compact' },
      { label: 'Research', icon: 'search', x: 22, y: 69, tone: 'compact' },
    ],
    signal: 'Pitch deck updated · Yesterday',
  },
  {
    id: 'itcert-training',
    name: 'ITCERT Training',
    kind: 'Shared',
    members: 6,
    presence: ['B', 'A', 'J', '+3'],
    size: 'medium',
    position: { x: 655, y: 615 },
    resources: [
      { label: 'Speaker', icon: 'mic', x: 13, y: 32, tone: 'compact' },
      { label: 'Poster', icon: 'image', x: 48, y: 18, tone: 'paper' },
      { label: 'Program', icon: 'calendar', x: 39, y: 70, tone: 'compact' },
    ],
    signal: 'Speaker details added · Oct 7',
  },
  {
    id: 'personal',
    name: 'Personal',
    kind: 'Personal',
    size: 'small',
    position: { x: 170, y: 560 },
    resources: [
      { label: 'Notes', icon: 'file', x: 16, y: 25, tone: 'paper' },
      { label: 'Research', icon: 'search', x: 48, y: 52, tone: 'compact' },
      { label: 'Ideas', icon: 'lightbulb', x: 18, y: 73, tone: 'compact' },
    ],
    signal: '3 notes changed · Oct 6',
  },
]

export const upcomingEvents = [
  { date: 'Oct 10', environment: 'Kandid', title: 'Performance testing' },
  { date: 'Oct 11', environment: 'DICT Startup', title: 'Submission' },
  { date: 'Oct 16', environment: 'ITCERT', title: 'Training' },
]
