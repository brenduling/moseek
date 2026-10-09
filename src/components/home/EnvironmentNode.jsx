import ResourcePreview from './ResourcePreview.jsx'
import ColorPicker from '../layout/ColorPicker.jsx'

function EnvironmentNode({ data }) {
  const environment = data.environment
  const isEnterable = Boolean(data.onEnter)
  const count = environment.resourceCount
  const countUnavailable = environment.resourceCountStatus === 'error' || count === undefined
  const countLoading = environment.resourceCountStatus === 'loading'
  const signal = countLoading ? 'Checking resources…'
    : countUnavailable ? 'Resource count unavailable'
      : count === 0 ? 'No resources yet' : `${count} ${count === 1 ? 'resource' : 'resources'}`

  function handleKeyDown(event) {
    if (isEnterable && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      event.stopPropagation()
      data.onEnter()
    }
  }

  return (
    <div className={`environment-node environment-node-${environment.size}${isEnterable ? ' environment-node-enterable' : ''}`}>
      <div className="environment-portal" data-color={data.color}
        role={isEnterable ? 'button' : undefined} tabIndex={isEnterable ? 0 : undefined}
        aria-label={isEnterable ? `Open ${environment.name} Environment` : undefined}
        onKeyDown={isEnterable ? handleKeyDown : undefined}>
        <div className="portal-header">
          <div className="portal-header-copy">
            <span className="portal-kicker">
              {environment.kind}{environment.members ? ` · ${environment.members} members` : ''}
            </span>
            <h2 className="portal-name">{environment.name}</h2>
            {environment.description && <p className="portal-description">{environment.description}</p>}
          </div>
          {environment.presence && (
            <div className="member-presence" aria-label={`${environment.members} members`}>
              {environment.presence.map((initials, index) => (
                <span className="member-avatar" key={`${initials}-${index}`}>{initials}</span>
              ))}
            </div>
          )}
        </div>

        <div className="portal-workspace" aria-label={`Resources in ${environment.name}`}>
          <span className="workspace-plane workspace-plane-one" aria-hidden="true" />
          <span className="workspace-plane workspace-plane-two" aria-hidden="true" />
          {environment.resources?.map((resource) => (
            <ResourcePreview resource={resource} key={resource.label} />
          ))}
          {!environment.resources?.length && <span className="portal-empty">
            {countLoading ? 'Checking this space…' : countUnavailable ? 'Preview unavailable'
              : count === 0 ? 'Nothing here yet' : 'Resources arranged in this space'}
          </span>}
        </div>
        <p className={`environment-signal${countUnavailable ? ' is-unavailable' : ''}`}>
          <span className="signal-dot" aria-hidden="true" />{signal}
        </p>
      </div>
      {isEnterable && data.onColor && <ColorPicker value={data.color} itemName={environment.name} onChange={data.onColor} />}
    </div>
  )
}

export default EnvironmentNode
