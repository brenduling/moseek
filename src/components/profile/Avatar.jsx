import { useState } from 'react'

function Initials({ name }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'M'
  return <span aria-hidden="true">{initials}</span>
}

function AvatarImage({ name, url }) {
  const [failed, setFailed] = useState(false)
  return failed ? <Initials name={name} />
    : <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

function Avatar({ name = '', url = '', className = '' }) {
  return <span className={`moseek-avatar ${className}`} aria-label={`${name || 'Account'} avatar`}>
    {url ? <AvatarImage key={url} name={name} url={url} /> : <Initials name={name} />}
  </span>
}

export default Avatar
