import { useState } from 'react'
import { CalendarDays, X } from 'lucide-react'

function UpcomingLens({ events }) {
  const [visible, setVisible] = useState(true)
  if (!visible) return null

  return (
    <aside className="upcoming-lens" aria-label="Upcoming events">
      <CalendarDays size={16} strokeWidth={1.7} aria-hidden="true" />
      <span className="lens-label">Coming up</span>
      <div className="lens-events">
        {events.map((event) => (
          <span className="lens-event" key={event.date}>
            <strong>{event.date}</strong>
            <span>{event.environment}</span>
            <span>{event.title}</span>
          </span>
        ))}
      </div>
      <button className="lens-close" type="button" aria-label="Hide upcoming events" onClick={() => setVisible(false)}>
        <X size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </aside>
  )
}

export default UpcomingLens
