import {
  CalendarDays,
  Database,
  FileText,
  GitBranch,
  Image,
  LayoutTemplate,
  Lightbulb,
  Mic2,
  PenTool,
  Presentation,
  Search,
} from 'lucide-react'

const icons = {
  calendar: CalendarDays,
  database: Database,
  figma: PenTool,
  file: FileText,
  github: GitBranch,
  image: Image,
  layout: LayoutTemplate,
  lightbulb: Lightbulb,
  mic: Mic2,
  presentation: Presentation,
  search: Search,
}

function ResourcePreview({ resource }) {
  const Icon = icons[resource.icon]

  return (
    <div
      className={`resource-preview resource-preview-${resource.tone}`}
      style={{ left: `${resource.x}%`, top: `${resource.y}%` }}
    >
      <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
      <span>{resource.label}</span>
    </div>
  )
}

export default ResourcePreview
