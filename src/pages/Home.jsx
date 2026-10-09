import { useCallback, useEffect, useRef, useState } from 'react'
import SpatialHome from '../components/home/SpatialHome.jsx'
import { supabase } from '../lib/supabase.js'
import { loadEnvironmentColors, SERVER_COLORS_ENABLED, setEnvironmentColor } from '../lib/serverColors.js'
import { readTutorialStatus } from '../utils/onboarding.js'
import { ACTIVITY_TIME, MEANINGFUL_ACTIVITY_ACTIONS, activityDescription } from '../utils/environmentActivity.js'

const pendingSnapshots = new Map()

function fetchHomeSnapshot(userId) {
  const pending = pendingSnapshots.get(userId)
  if (pending) return pending
  const now = new Date()
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const request = Promise.allSettled([
    supabase.from('environments').select('id, name, description, type, created_at').order('created_at', { ascending: true }),
    SERVER_COLORS_ENABLED ? loadEnvironmentColors(supabase, userId) : Promise.resolve({}),
    supabase.rpc('get_home_environment_resource_counts'),
    supabase.rpc('get_home_upcoming_calendar_items', { p_local_date: localDate }),
    supabase.from('environment_activity')
      .select('id,environment_id,actor_name,action,target_label,occurred_at,environments!inner(name)')
      .in('action', MEANINGFUL_ACTIVITY_ACTIONS)
      .order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(3),
  ])
  pendingSnapshots.set(userId, request)
  request.finally(() => {
    if (pendingSnapshots.get(userId) === request) pendingSnapshots.delete(userId)
  })
  return request
}

function Home({ user, profile, onOpenEnvironment, onOpenTutorial, onOpenSettings, onSignOut, initialJoinCode, onJoinCodeConsumed }) {
  const [environments, setEnvironments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState('')
  const [colorError, setColorError] = useState('')
  const [colorReady, setColorReady] = useState(!SERVER_COLORS_ENABLED)
  const [preferences, setPreferences] = useState({})
  const preferencesRef = useRef({})
  const [resourceCounts, setResourceCounts] = useState({})
  const [resourceCountStatus, setResourceCountStatus] = useState('loading')
  const [resourceCountError, setResourceCountError] = useState('')
  const [upcomingItems, setUpcomingItems] = useState([])
  const [upcomingStatus, setUpcomingStatus] = useState('loading')
  const [activityItems, setActivityItems] = useState([])
  const [globalActivityStatus, setGlobalActivityStatus] = useState('loading')
  const openEnvironmentRef = useRef(onOpenEnvironment)
  useEffect(() => { openEnvironmentRef.current = onOpenEnvironment }, [onOpenEnvironment])

  const applySnapshot = useCallback((results) => {
    const environmentResult = results[0]
    if (environmentResult.status === 'rejected' || environmentResult.value.error) {
      setError(environmentResult.status === 'rejected' ? 'Could not load your Environments.' : environmentResult.value.error.message)
    } else {
      setEnvironments(environmentResult.value.data)
      setError('')
    }
    if (SERVER_COLORS_ENABLED) {
      const colorResult = results[1]
      if (colorResult.status === 'rejected') {
        setColorError(colorResult.reason?.message || 'Could not load your colors.')
        setColorReady(false)
      } else {
        preferencesRef.current = colorResult.value
        setPreferences(colorResult.value)
        setColorError('')
        setColorReady(true)
      }
    }
    const countResult = results[2]
    if (countResult.status === 'rejected' || countResult.value.error) {
      setResourceCounts({})
      setResourceCountStatus('error')
      setResourceCountError(countResult.status === 'rejected'
        ? 'Resource counts could not be loaded.' : 'Resource counts could not be loaded.')
    } else {
      setResourceCounts(Object.fromEntries((countResult.value.data || [])
        .map((row) => [row.environment_id, Number(row.resource_count)])))
      setResourceCountStatus('ready')
      setResourceCountError('')
    }
    const upcomingResult = results[3]
    if (upcomingResult.status === 'rejected' || upcomingResult.value.error) {
      setUpcomingItems([])
      setUpcomingStatus('error')
    } else {
      setUpcomingItems((upcomingResult.value.data || []).map((item) => {
        const date = item.all_day_start || item.starts_at || item.due_at
        return { id: item.item_id, kind: 'upcoming', title: item.title,
          detail: `${item.environment_name} · ${date ? new Date(item.all_day_start ? `${date}T12:00:00` : date).toLocaleString(undefined, { dateStyle: 'medium', ...(item.all_day_start ? {} : { timeStyle: 'short' }) }) : 'No date'}` }
      }))
      setUpcomingStatus('ready')
    }
    const activityResult = results[4]
    if (activityResult.status === 'rejected' || activityResult.value.error) {
      setActivityItems([])
      setGlobalActivityStatus('error')
    } else {
      setActivityItems((activityResult.value.data || []).map((item) => ({
        id: `activity-${item.id}`, kind: 'activity', title: `${item.actor_name} · ${activityDescription(item)}`,
        detail: [item.target_label, item.environments?.name, ACTIVITY_TIME.format(new Date(item.occurred_at))].filter(Boolean).join(' · '),
        onOpen: () => openEnvironmentRef.current({ id: item.environment_id }),
      })))
      setGlobalActivityStatus('ready')
    }
    setLoading(false)
    setLoadedOnce(true)
  }, [])

  const refresh = useCallback(async () => {
    applySnapshot(await fetchHomeSnapshot(user.id))
  }, [applySnapshot, user.id])

  useEffect(() => {
    let active = true
    fetchHomeSnapshot(user.id).then((results) => { if (active) applySnapshot(results) })
    return () => { active = false }
  }, [applySnapshot, user.id])

  async function saveEnvironmentColor(environmentId, color) {
    if (!SERVER_COLORS_ENABLED || !colorReady) throw new Error('Colors are not available right now.')
    const row = await setEnvironmentColor(supabase, user.id, environmentId,
      preferencesRef.current[environmentId], color)
    preferencesRef.current = { ...preferencesRef.current, [environmentId]: row }
    setPreferences(preferencesRef.current)
    return row
  }

  async function createEnvironment({ name, type }) {
    const { error: createError } = await supabase.from('environments')
      .insert({ name, type, created_by: user.id })
    if (createError) throw createError
    setLoading(true)
    await refresh()
  }

  return <SpatialHome
    key={`${user.id}:${profile?.updated_at || 'profile-loading'}:${loadedOnce}:${colorReady}:${Boolean(error)}:${resourceCountStatus}:${Object.entries(resourceCounts).sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}=${count}`).join(':')}:${environments.map((environment) => environment.id).join(':')}`}
    user={user}
    profile={profile}
    environments={environments}
    loading={loading}
    loadedOnce={loadedOnce}
    error={error}
    colorError={colorError}
    colorReady={colorReady}
    colorPreferences={preferences}
    resourceCounts={resourceCounts}
    resourceCountStatus={resourceCountStatus}
    resourceCountError={resourceCountError}
    activityItems={[...activityItems, ...upcomingItems].slice(0, 5)}
    activityError={globalActivityStatus === 'error' ? 'Activity could not be loaded.'
      : upcomingStatus === 'error' ? 'Upcoming items could not be loaded.' : ''}
    onSaveColor={saveEnvironmentColor}
    onRetryColors={() => { setLoading(true); refresh() }}
    onRetry={() => { setLoading(true); refresh() }}
    onCreate={createEnvironment}
    onOpenEnvironment={onOpenEnvironment}
    onOpenTutorial={onOpenTutorial}
    onOpenSettings={onOpenSettings}
    tutorialStatus={readTutorialStatus(user.id)}
    onSignOut={onSignOut}
    onInvitationAccepted={refresh}
    initialJoinCode={initialJoinCode}
    onJoinCodeConsumed={onJoinCodeConsumed}
  />
}

export default Home
