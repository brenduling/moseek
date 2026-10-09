function PresenceIndicator({ person, nearResource = false }) {
  const label = nearResource
    ? `${person.displayName} is here`
    : `${person.displayName} · ${person.isCurrentUser ? 'You' : 'Here now'}`

  return (
    <span
      className={`presence-indicator nodrag nopan${nearResource ? ' presence-indicator-near-resource' : ''}`}
      role="img"
      aria-label={label}
      tabIndex={0}
    >
      <span className="presence-initials" aria-hidden="true">{person.initials}</span>
      <span className="presence-tooltip" aria-hidden="true">{label}</span>
    </span>
  )
}

export default PresenceIndicator
