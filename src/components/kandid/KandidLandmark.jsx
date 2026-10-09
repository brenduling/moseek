import PresenceIndicator from './PresenceIndicator.jsx'

function KandidLandmark({ data }) {
  const { memberCount, present } = data.presence

  return (
    <div className="kandid-landmark">
      <h1>Kandid</h1>
      <p>Shared Environment · {memberCount} members</p>
      <div className="landmark-presence" aria-label={`${present.length} here now`}>
        <span className="here-now-count">{present.length} here now</span>
        <div className="landmark-presence-people">
          {present.map((person) => <PresenceIndicator person={person} key={person.userId} />)}
        </div>
      </div>
    </div>
  )
}

export default KandidLandmark
