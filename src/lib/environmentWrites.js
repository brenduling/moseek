export async function insertCanvasRow(db, table, values) {
  const { data, error } = await db.from(table).insert(values).select('*').single()
  if (!error) return data
  // A request may commit before its response is lost. The client-generated ID
  // makes a retry safe without creating a second row.
  if (error.code === '23505') {
    const existing = await db.from(table).select('*').eq('id', values.id)
      .eq('environment_id', values.environment_id).maybeSingle()
    if (!existing.error && existing.data?.created_by === values.created_by) return existing.data
  }
  throw error
}

export async function updateCanvasRow(db, table, environmentId, id, patch, expectedUpdatedAt = null) {
  let query = db.from(table).update(patch).eq('id', id).eq('environment_id', environmentId)
  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)
  const { data, error } = await query.select('*').maybeSingle()
  if (error) throw error
  if (!data) {
    const conflict = new Error('This item changed elsewhere. Its latest position was restored.')
    conflict.code = 'MSEEK_CONFLICT'
    throw conflict
  }
  return data
}

export async function deleteCanvasRow(db, table, environmentId, id) {
  const { data, error } = await db.from(table).delete().eq('id', id)
    .eq('environment_id', environmentId).select('id')
  if (error) throw error
  if (data?.length !== 1 || data[0].id !== id) {
    throw new Error('Could not confirm deletion. Reload this Environment to check its state.')
  }
}
