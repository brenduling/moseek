import {
  Activity,
  Blocks,
  Database,
  FileText,
  GitBranch,
  HardDrive,
  Link2,
  PenTool,
  StickyNote,
} from 'lucide-react'
import PresenceIndicator from './PresenceIndicator.jsx'
import ResourceActions from './ResourceActions.jsx'

const icons = {
  activity: Activity,
  blocks: Blocks,
  database: Database,
  figma: PenTool,
  file: FileText,
  github: GitBranch,
  googleDocs: FileText,
  googleDrive: HardDrive,
  link: Link2,
  note: StickyNote,
}

function KandidResourceNode({ data, selected }) {
  const resource = data.resource
  const Icon = icons[resource.icon]

  return (
    <article className={`kandid-resource kandid-resource-${resource.kind}${selected ? ' is-selected' : ''}`}>
      <div className="kandid-resource-type">
        <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
        <span>{resource.typeLabel}</span>
      </div>
      <h3 title={resource.name}>{resource.name}</h3>
      <p>{resource.detail}</p>
      {resource.kind === 'document' && <div className="document-lines" aria-hidden="true" />}
      {data.nearbyPeople.map((person) => (
        <PresenceIndicator person={person} nearResource key={person.userId} />
      ))}
      {selected && (
        <ResourceActions
          resource={resource}
          onOpen={resource.createdType === 'link' ? data.onOpenLink : undefined}
          openLabel="Open link"
          onDelete={data.onDelete}
        />
      )}
    </article>
  )
}

export default KandidResourceNode
