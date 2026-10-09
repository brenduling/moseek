$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

# This runner is deliberately local-only: fixed Docker container/database,
# PostgreSQL version guard, no URL/key input, and no linked/reset commands.
$container = 'supabase_db_moseek'
$running = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $running -notcontains $container) {
  throw "Stopped: expected local database container '$container' is not running."
}

function Invoke-LocalQuery([string]$sql) {
  $result = docker exec $container psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql
  if ($LASTEXITCODE -ne 0) { throw 'Local-only database preflight failed.' }
  return ($result -join "`n").Trim()
}

$target = Invoke-LocalQuery "select current_database() || ':' || current_setting('server_version_num');"
if ($target -notmatch '^postgres:17[0-9]+$') { throw "Stopped: unexpected local target '$target'." }
$requiredPrevious = '20261012000006'
$previous = Invoke-LocalQuery "select count(*) from supabase_migrations.schema_migrations where version='$requiredPrevious';"
if ($previous -ne '1') { throw 'Stopped: local migration history does not include the completed Phase 4.5 migration.' }

$version = '20261013000000'
$applied = Invoke-LocalQuery "select count(*) from supabase_migrations.schema_migrations where version='$version';"
$before = Invoke-LocalQuery "select (select count(*) from public.environments)||':'||(select count(*) from public.environment_members)||':'||(select count(*) from public.sections)||':'||(select count(*) from public.resources)||':'||(select count(*) from public.environment_activity)||':'||(select count(*) from public.environment_calendar_items);"
if ($applied -eq '0') {
  $migration = Join-Path $PSScriptRoot "..\supabase\migrations\${version}_phase_4_6_global_views_discussions.sql"
  $containerPath = '/tmp/20261013000000_phase_4_6_global_views_discussions.sql'
  docker cp $migration "${container}:$containerPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy the Phase 4.6 migration to the local database container.' }
  try {
    docker exec $container psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f $containerPath
    if ($LASTEXITCODE -ne 0) { throw 'Local Phase 4.6 migration failed; stop and inspect the rolled-back migration.' }
    [void](Invoke-LocalQuery "insert into supabase_migrations.schema_migrations(version,name,statements) values ('$version','phase_4_6_global_views_discussions','{}'::text[]);")
  } finally { docker exec $container rm -f $containerPath | Out-Null }
} elseif ($applied -ne '1') { throw 'Local Phase 4.6 migration ledger is inconsistent.' }

$after = Invoke-LocalQuery "select (select count(*) from public.environments)||':'||(select count(*) from public.environment_members)||':'||(select count(*) from public.sections)||':'||(select count(*) from public.resources)||':'||(select count(*) from public.environment_activity)||':'||(select count(*) from public.environment_calendar_items);"
if ($before -ne $after) { throw "Migration changed pre-existing row counts ($before -> $after)." }
$checks = @(
  @{ File='test-phase-4-6-discussions-local.sql'; Label='Phase 4.6 discussion and Realtime authorization suite' },
  @{ File='test-phase-4-5-activity-local.sql'; Label='Phase 4.5 activity regression suite' },
  @{ File='test-phase-4-5-calendar-local.sql'; Label='Phase 4.5 calendar regression suite' },
  @{ File='test-home-resource-counts-local.sql'; Label='Home resource count regression suite' },
  @{ File='test-role-rls-local.sql'; Label='Environment role RLS regression suite' },
  @{ File='test-color-rls-local.sql'; Label='Phase 3D.2 color RLS regression suite' }
)

Write-Output "Verified local target: container $container; database postgres; PostgreSQL 17"
Write-Output "Phase 4.6 migration: $(if ($applied -eq '1') { 'already applied locally' } else { 'applied locally' })"
Write-Output 'Existing Environment, membership, Section, Resource, activity, and calendar counts were unchanged by migration.'
foreach ($check in $checks) {
  $path = Join-Path $PSScriptRoot $check.File
  $containerPath = "/tmp/$($check.File)"
  docker cp $path "${container}:$containerPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not copy $($check.Label) into the local container." }
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = @(docker exec $container sh -c "psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f '$containerPath' 2>&1")
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -ne 0) {
      Write-Output ($output -join [Environment]::NewLine)
      throw "$($check.Label) failed. The test transaction was rolled back by the SQL script."
    }
    $assertions = @($output | Where-Object { $_ -match 'PASS:' }).Count
    Write-Output "$($check.Label): $assertions assertions passed."
  } finally { docker exec $container rm -f $containerPath | Out-Null }
}
Write-Output 'All test fixtures are transactional and rolled back; no production or hosted target was contacted.'
