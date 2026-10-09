import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const DAY_NAMES = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const localDate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const dateOnly = (value) => {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}
const itemDate = (item) => item.all_day ? item.all_day_start
  : item.starts_at || item.due_at ? localDate(new Date(item.starts_at || item.due_at)) : null

function GlobalCalendarPanel({ onClose, onOpenEnvironment }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(() => localDate(new Date()))
  const [view, setView] = useState('month')
  const [items, setItems] = useState([])
  const [undatedTasks, setUndatedTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const after = new Date(month.getFullYear(), month.getMonth() + 1, 1)
    const firstDate = localDate(first)
    const afterDate = localDate(after)
    const [timed, allDay, due, undated] = await Promise.all([
      supabase.from('environment_calendar_items')
        .select('id,environment_id,item_type,title,description,starts_at,ends_at,due_at,all_day,all_day_start,all_day_end,status,environments!inner(name)')
        .lt('starts_at', after.toISOString())
        .or(`ends_at.gte.${first.toISOString()},starts_at.gte.${first.toISOString()}`),
      supabase.from('environment_calendar_items')
        .select('id,environment_id,item_type,title,description,starts_at,ends_at,due_at,all_day,all_day_start,all_day_end,status,environments!inner(name)')
        .lt('all_day_start', afterDate)
        .or(`all_day_end.gte.${firstDate},and(all_day_end.is.null,all_day_start.gte.${firstDate})`),
      supabase.from('environment_calendar_items')
        .select('id,environment_id,item_type,title,description,starts_at,ends_at,due_at,all_day,all_day_start,all_day_end,status,environments!inner(name)')
        .gte('due_at', first.toISOString()).lt('due_at', after.toISOString()),
      supabase.from('environment_calendar_items')
        .select('id,environment_id,item_type,title,description,starts_at,ends_at,due_at,all_day,all_day_start,all_day_end,status,environments!inner(name)')
        .eq('item_type', 'task').is('due_at', null).order('created_at', { ascending: false }).limit(100),
    ])
    const failure = timed.error || allDay.error || due.error || undated.error
    if (failure) setError('The calendar could not be loaded. Check your access and try again.')
    else {
      const merged = new Map([...(timed.data || []), ...(allDay.data || []), ...(due.data || [])].map((item) => [item.id, item]))
      setItems([...merged.values()].sort((a, b) => (itemDate(a) || '').localeCompare(itemDate(b) || '')
        || (a.starts_at || a.due_at || '').localeCompare(b.starts_at || b.due_at || '') || a.id.localeCompare(b.id)))
      setUndatedTasks(undated.data || [])
    }
    setLoading(false)
  }, [month])

  useEffect(() => {
    const timer = window.setTimeout(() => { load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    function closeOnEscape(event) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay())
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
  }, [month])
  const itemsByDay = useMemo(() => {
    const grouped = new Map()
    for (const item of items) {
      const start = item.all_day ? dateOnly(item.all_day_start) : itemDate(item) ? dateOnly(itemDate(item)) : null
      if (!start) continue
      const end = item.all_day ? dateOnly(item.all_day_end || item.all_day_start)
        : item.ends_at ? dateOnly(localDate(new Date(item.ends_at))) : start
      const visibleStart = new Date(Math.max(start.getTime(), days[0].getTime()))
      const visibleEnd = new Date(Math.min(end.getTime(), days[days.length - 1].getTime()))
      for (const day = visibleStart; day <= visibleEnd; day.setDate(day.getDate() + 1)) {
        const key = localDate(day)
        grouped.set(key, [...(grouped.get(key) || []), item])
      }
    }
    return grouped
  }, [days, items])
  const selectedItems = itemsByDay.get(selectedDate) || []

  function changeMonth(delta) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1)
    setMonth(next)
    setSelectedDate(localDate(next))
  }

  function openItem(item) { onOpenEnvironment(item.environment_id) }

  function renderItem(item) {
    const time = item.all_day ? 'All day' : item.starts_at
      ? TIME.format(new Date(item.starts_at)) : item.due_at ? TIME.format(new Date(item.due_at)) : 'Task'
    const state = item.item_type === 'task' ? (item.status === 'done' ? 'Completed' : item.status.replace('_', ' ')) : 'Event'
    return <li key={item.id}>
      <button type="button" className="calendar-agenda-item global-calendar-item" onClick={() => openItem(item)}>
        <span className="calendar-agenda-kind">{state} · {time}</span>
        <strong>{item.title}</strong>
        <small>{item.environments?.name || 'Environment'}</small>
      </button>
    </li>
  }

  return <section className="global-workspace-panel global-calendar-panel" role="dialog" aria-modal="false"
    aria-labelledby="global-calendar-title" aria-busy={loading}>
    <header className="environment-panel-heading">
      <div><span className="portal-kicker">Across your spaces</span><h2 id="global-calendar-title">Calendar</h2></div>
      <button type="button" className="contributors-close" onClick={onClose} aria-label="Close global calendar"><X size={17} /></button>
    </header>
    <div className="global-calendar-view-switch" role="group" aria-label="Calendar view">
      <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>
      <button type="button" aria-pressed={view === 'agenda'} onClick={() => setView('agenda')}>Agenda</button>
    </div>
    <div className="calendar-month-heading">
      <h3>{MONTH.format(month)}</h3>
      <div><button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={17} /></button>
        <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={17} /></button></div>
    </div>
    {view === 'month' && <div className="calendar-month-grid" role="grid" aria-label={MONTH.format(month)}>
      {days.slice(0, 7).map((day) => <span className="calendar-weekday" key={day.getDay()}>{DAY_NAMES.format(day)}</span>)}
      {days.map((day) => {
        const key = localDate(day)
        const hasItems = (itemsByDay.get(key) || []).length > 0
        return <button key={key} role="gridcell" type="button"
          className={`calendar-day${day.getMonth() !== month.getMonth() ? ' is-outside' : ''}${key === selectedDate ? ' is-selected' : ''}${key === localDate(new Date()) ? ' is-today' : ''}`}
          aria-pressed={key === selectedDate}
          aria-label={`${DATE.format(day)}${hasItems ? `, ${(itemsByDay.get(key) || []).length} items` : ''}`}
          onClick={() => setSelectedDate(key)}>
          <span>{day.getDate()}</span>{hasItems && <span className="calendar-day-mark" aria-hidden="true" />}
        </button>
      })}
    </div>}
    <div className="calendar-agenda-heading"><h3>{DATE.format(dateOnly(selectedDate))}</h3></div>
    {error ? <div className="environment-panel-empty" role="alert"><p>{error}</p>
      <button type="button" onClick={load}>Try again</button></div>
      : loading ? <p className="environment-panel-empty" role="status">Loading calendar…</p>
        : <>
          {selectedItems.length === 0 ? <p className="environment-panel-empty">Nothing planned for this day.</p>
            : <ol className="calendar-agenda-list">{selectedItems.map(renderItem)}</ol>}
          {undatedTasks.length > 0 && <section className="calendar-undated-tasks global-undated-tasks" aria-labelledby="global-undated-heading">
            <h3 id="global-undated-heading">Tasks without a date</h3>
            <ol className="calendar-agenda-list">{undatedTasks.map(renderItem)}</ol>
          </section>}
        </>}
  </section>
}

export default GlobalCalendarPanel
