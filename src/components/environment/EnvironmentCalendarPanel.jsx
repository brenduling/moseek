import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { canEditEnvironmentContent } from '../../lib/environmentPermissions.js'

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const DAY_NAMES = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const localDate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const localDateTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
const localInputToIso = (value) => value ? new Date(value).toISOString() : null
const itemDate = (item) => item.all_day ? item.all_day_start
  : item.starts_at || item.due_at ? localDate(new Date(item.starts_at || item.due_at)) : null
const itemTime = (item) => item.all_day || !item.starts_at ? '' : TIME.format(new Date(item.starts_at))

function emptyDraft(day) {
  return { id: '', item_type: 'event', title: '', description: '', all_day: false,
    date: day, startsAt: `${day}T09:00`, endsAt: '', dueAt: '', status: 'open',
    assignedTo: '', sectionId: '', resourceId: '' }
}

function EnvironmentCalendarPanel({ environmentId, role, userId, sections, resources, onClose }) {
  const canEdit = canEditEnvironmentContent(role)
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(() => localDate(new Date()))
  const [items, setItems] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const after = new Date(month.getFullYear(), month.getMonth() + 1, 1)
    const from = first.toISOString()
    const until = after.toISOString()
    const [timed, allDay, due, undatedTasks, memberResult] = await Promise.all([
      supabase.from('environment_calendar_items').select('*').eq('environment_id', environmentId)
        .gte('starts_at', from).lt('starts_at', until),
      supabase.from('environment_calendar_items').select('*').eq('environment_id', environmentId)
        .gte('all_day_start', localDate(first)).lt('all_day_start', localDate(after)),
      supabase.from('environment_calendar_items').select('*').eq('environment_id', environmentId)
        .gte('due_at', from).lt('due_at', until),
      supabase.from('environment_calendar_items').select('*').eq('environment_id', environmentId)
        .eq('item_type', 'task').is('due_at', null),
      supabase.from('environment_members').select('user_id,profiles(display_name)')
        .eq('environment_id', environmentId),
    ])
    const failure = timed.error || allDay.error || due.error || undatedTasks.error || memberResult.error
    if (failure) setError('Calendar items could not be loaded. Check your access and try again.')
    else {
      const merged = new Map([...(timed.data || []), ...(allDay.data || []), ...(due.data || []), ...(undatedTasks.data || [])]
        .map((item) => [item.id, item]))
      setItems([...merged.values()].sort((a, b) => (itemDate(a) || '').localeCompare(itemDate(b) || '')
        || (a.starts_at || a.due_at || '').localeCompare(b.starts_at || b.due_at || '')))
      setMembers((memberResult.data || []).map((member) => ({
        id: member.user_id, name: member.profiles?.display_name || 'Environment member',
      })))
    }
    setLoading(false)
  }, [environmentId, month])

  useEffect(() => {
    const timer = window.setTimeout(() => { load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    function onKeyDown(event) { if (event.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay())
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
  }, [month])
  const itemsByDay = useMemo(() => items.reduce((grouped, item) => {
    const date = itemDate(item)
    if (!date) return grouped
    grouped.set(date, [...(grouped.get(date) || []), item])
    return grouped
  }, new Map()), [items])
  const selectedItems = itemsByDay.get(selectedDate) || []
  const undatedTasks = items.filter((item) => item.item_type === 'task' && !item.due_at)

  function openCreate() { setNotice(''); setError(''); setDraft(emptyDraft(selectedDate)) }
  function openEdit(item) {
    setNotice(''); setError('')
    setDraft({ id: item.id, item_type: item.item_type, title: item.title, description: item.description || '',
      all_day: item.all_day, date: item.all_day ? item.all_day_start : itemDate(item),
      endDate: item.all_day_end || '',
      startsAt: localDateTime(item.starts_at), endsAt: localDateTime(item.ends_at), dueAt: localDateTime(item.due_at),
      status: item.status, assignedTo: item.assigned_to || '', sectionId: item.section_id || '', resourceId: item.resource_id || '' })
  }

  async function save(event) {
    event.preventDefault()
    if (!draft || saving || !draft.title.trim()) return
    setSaving(true); setError(''); setNotice('')
    const isEvent = draft.item_type === 'event'
    const values = {
      item_type: draft.item_type, title: draft.title.trim(), description: draft.description,
      all_day: isEvent && draft.all_day,
      starts_at: isEvent && !draft.all_day ? localInputToIso(draft.startsAt) : null,
      ends_at: isEvent && !draft.all_day ? localInputToIso(draft.endsAt) : null,
      all_day_start: isEvent && draft.all_day ? draft.date : null,
      all_day_end: isEvent && draft.all_day ? (draft.endDate || draft.date) : null,
      due_at: localInputToIso(draft.dueAt), status: isEvent ? 'event' : draft.status,
      assigned_to: draft.assignedTo || null, section_id: draft.sectionId || null,
      resource_id: draft.resourceId || null,
    }
    const result = draft.id
      ? await supabase.from('environment_calendar_items').update(values).eq('environment_id', environmentId).eq('id', draft.id).select('id').maybeSingle()
      : await supabase.from('environment_calendar_items').insert({ ...values, environment_id: environmentId, created_by: userId }).select('id').single()
    if (result.error || !result.data) setError('This calendar item could not be saved. Check its dates and your access.')
    else { setNotice(draft.id ? 'Calendar item saved.' : 'Calendar item added.'); setDraft(null); await load() }
    setSaving(false)
  }

  async function remove(item) {
    if (!item) return
    if (!window.confirm(`Remove “${item.title}” from this Environment?`)) return
    setSaving(true); setError(''); setNotice('')
    const result = await supabase.from('environment_calendar_items').delete()
      .eq('environment_id', environmentId).eq('id', item.id).select('id').maybeSingle()
    if (result.error || !result.data) setError('This calendar item could not be removed. It may have changed.')
    else { setNotice('Calendar item removed.'); setDraft(null); await load() }
    setSaving(false)
  }

  async function changeStatus(item, status) {
    if (!canEdit) return
    setSaving(true); setError(''); setNotice('')
    const result = await supabase.from('environment_calendar_items').update({ status })
      .eq('environment_id', environmentId).eq('id', item.id).select('id').maybeSingle()
    if (result.error || !result.data) setError('Task progress could not be updated.')
    else { setNotice('Task progress saved.'); await load() }
    setSaving(false)
  }

  return <section id="environment-calendar-panel" className="environment-calendar-panel" role="dialog" aria-modal="false"
    aria-labelledby="environment-calendar-title" aria-busy={loading || saving}>
    <header className="environment-panel-heading">
      <div><span className="portal-kicker">This Environment</span><h2 id="environment-calendar-title">Calendar</h2></div>
      <button type="button" className="contributors-close" onClick={onClose} aria-label="Close calendar" disabled={saving}><X size={17} /></button>
    </header>
    <div className="calendar-month-heading">
      <h3>{MONTH.format(month)}</h3>
      <div><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
        <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17} /></button></div>
    </div>
    <div className="calendar-month-grid" role="grid" aria-label={MONTH.format(month)}>
      {days.slice(0, 7).map((day) => <span className="calendar-weekday" key={day.getDay()}>{DAY_NAMES.format(day)}</span>)}
      {days.map((day) => {
        const key = localDate(day); const hasItems = (itemsByDay.get(key) || []).length > 0
        return <button key={key} role="gridcell" type="button"
          className={`calendar-day${day.getMonth() !== month.getMonth() ? ' is-outside' : ''}${key === selectedDate ? ' is-selected' : ''}${key === localDate(new Date()) ? ' is-today' : ''}`}
          aria-pressed={key === selectedDate} aria-label={`${MONTH.format(day)} ${day.getDate()}${hasItems ? ', has calendar items' : ''}`}
          onClick={() => { setSelectedDate(key); setDraft(null) }}>
          <span>{day.getDate()}</span>{hasItems && <span className="calendar-day-mark" aria-hidden="true" />}
        </button>
      })}
    </div>
    <div className="calendar-agenda-heading"><h3>{DATE.format(new Date(`${selectedDate}T12:00:00`))}</h3>
      {canEdit && <button type="button" className="environment-panel-action" onClick={openCreate}><Plus size={15} /> Add item</button>}</div>
    {error && <p className="contributors-feedback is-error" role="alert">{error}</p>}
    {notice && <p className="contributors-feedback" role="status">{notice}</p>}
    {loading ? <p className="environment-panel-empty" role="status">Loading calendar…</p>
      : selectedItems.length === 0 ? <p className="environment-panel-empty">Nothing planned for this day.</p>
        : <ol className="calendar-agenda-list">{selectedItems.map((item) => <li key={item.id}>
          <button type="button" className="calendar-agenda-item" onClick={() => canEdit && openEdit(item)} disabled={!canEdit}>
            <span className="calendar-agenda-kind">{item.item_type === 'task' ? 'Task' : 'Event'}{item.all_day ? ' · All day' : itemTime(item) ? ` · ${itemTime(item)}` : ''}</span>
            <strong>{item.title}</strong>{item.description && <span>{item.description}</span>}
            {item.due_at && <small>Due {DATE.format(new Date(item.due_at))}</small>}
          </button>
          {item.item_type === 'task' && canEdit && <select aria-label={`Progress for ${item.title}`} value={item.status}
            disabled={saving} onChange={(event) => changeStatus(item, event.target.value)}>
            <option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option>
          </select>}
        </li>)}</ol>}
    {!loading && undatedTasks.length > 0 && <section className="calendar-undated-tasks" aria-labelledby="calendar-undated-heading">
      <h3 id="calendar-undated-heading">Without a date</h3>
      <ol className="calendar-agenda-list">{undatedTasks.map((item) => <li key={item.id}>
        <button type="button" className="calendar-agenda-item" onClick={() => canEdit && openEdit(item)} disabled={!canEdit}>
          <span className="calendar-agenda-kind">Task</span><strong>{item.title}</strong>
        </button>
        {canEdit && <select aria-label={`Progress for ${item.title}`} value={item.status} disabled={saving}
          onChange={(event) => changeStatus(item, event.target.value)}>
          <option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option>
        </select>}
      </li>)}</ol>
    </section>}
    {draft && <form className="calendar-item-form" onSubmit={save}>
      <h3>{draft.id ? 'Edit calendar item' : 'Add to this Environment'}</h3>
      <label htmlFor="calendar-item-kind">Type</label>
      <select id="calendar-item-kind" value={draft.item_type} disabled={saving}
        onChange={(event) => setDraft({ ...draft, item_type: event.target.value, status: event.target.value === 'event' ? 'event' : 'open' })}>
        <option value="event">Event</option><option value="task">Task</option></select>
      <label htmlFor="calendar-item-title">Title</label>
      <input id="calendar-item-title" value={draft.title} maxLength={160} required disabled={saving}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <label htmlFor="calendar-item-description">Description</label>
      <textarea id="calendar-item-description" value={draft.description} maxLength={4000} rows={2} disabled={saving}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      {draft.item_type === 'event' && <>
        <label className="calendar-all-day"><input type="checkbox" checked={draft.all_day} disabled={saving}
          onChange={(event) => setDraft({ ...draft, all_day: event.target.checked })} /> All day</label>
        {draft.all_day ? <><label htmlFor="calendar-all-day-start">Date</label>
          <input id="calendar-all-day-start" type="date" value={draft.date} required disabled={saving}
            onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
          <label htmlFor="calendar-all-day-end">Last day (optional)</label>
          <input id="calendar-all-day-end" type="date" value={draft.endDate || draft.date} disabled={saving}
            onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
        </> : <><label htmlFor="calendar-event-start">Starts · your local time</label>
          <input id="calendar-event-start" type="datetime-local" value={draft.startsAt} required disabled={saving}
            onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} />
          <label htmlFor="calendar-event-end">Ends (optional)</label>
          <input id="calendar-event-end" type="datetime-local" value={draft.endsAt} disabled={saving}
            onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} />
        </>}
      </>}
      <label htmlFor="calendar-item-due">Deadline · your local time (optional)</label>
      <input id="calendar-item-due" type="datetime-local" value={draft.dueAt} disabled={saving}
        onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} />
      {draft.item_type === 'task' && <><label htmlFor="calendar-item-status">Progress</label>
        <select id="calendar-item-status" value={draft.status} disabled={saving}
          onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
          <option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option>
        </select></>}
      <label htmlFor="calendar-item-assignee">Assign to</label>
      <select id="calendar-item-assignee" value={draft.assignedTo} disabled={saving}
        onChange={(event) => setDraft({ ...draft, assignedTo: event.target.value })}>
        <option value="">No one</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}
      </select>
      <label htmlFor="calendar-item-section">Section (optional)</label>
      <select id="calendar-item-section" value={draft.sectionId} disabled={saving}
        onChange={(event) => setDraft({ ...draft, sectionId: event.target.value })}>
        <option value="">None</option>{sections.map((section) => <option value={section.id} key={section.id}>{section.title}</option>)}
      </select>
      <label htmlFor="calendar-item-resource">Resource (optional)</label>
      <select id="calendar-item-resource" value={draft.resourceId} disabled={saving}
        onChange={(event) => setDraft({ ...draft, resourceId: event.target.value })}>
        <option value="">None</option>{resources.map((resource) => <option value={resource.id} key={resource.id}>{resource.title}</option>)}
      </select>
      <div className="calendar-form-actions">
        {draft.id && <button type="button" className="calendar-remove" disabled={saving}
          onClick={() => remove(items.find((item) => item.id === draft.id))}>Remove</button>}
        <button type="button" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
        <button type="submit" disabled={saving || !draft.title.trim()}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>}
  </section>
}

export default EnvironmentCalendarPanel
