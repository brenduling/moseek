$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

# Local-only Phase 4.1B runner. Fixed container/database checks; no remote URL,
# keys, linked Supabase commands, reset, or production connection path.
$containerName = 'supabase_db_moseek'
$migrationStages = @(
  @{ Version = '20261010000002'; Name = 'phase_4_1c_home_counts_and_usernames'; File = '20261010000002_phase_4_1c_home_counts_and_usernames.sql' },
  @{ Version = '20261010000003'; Name = 'phase_4_1c_invitation_schema'; File = '20261010000003_phase_4_1c_invitation_schema.sql' },
  @{ Version = '20261010000004'; Name = 'phase_4_1c_invitation_operations'; File = '20261010000004_phase_4_1c_invitation_operations.sql' },
  @{ Version = '20261011000000'; Previous = '20261010000004'; Name = 'phase_4_3_private_images_and_upload_limits'; File = '20261011000000_phase_4_3_private_images_and_upload_limits.sql' },
  @{ Version = '20261011000001'; Previous = '20261011000000'; Name = 'phase_4_4_atomic_section_movement'; File = '20261011000001_phase_4_4_atomic_section_movement.sql' },
  @{ Version = '20261011000002'; Previous = '20261011000001'; Name = 'phase_4_4_layout_trigger_guard'; File = '20261011000002_phase_4_4_layout_trigger_guard.sql' },
  @{ Version = '20261012000000'; Previous = '20261011000002'; Name = 'phase_4_5_default_sharing_codes'; File = '20261012000000_phase_4_5_default_sharing_codes.sql' },
  @{ Version = '20261012000001'; Previous = '20261012000000'; Name = 'phase_4_5_activity_history'; File = '20261012000001_phase_4_5_activity_history.sql' },
  @{ Version = '20261012000002'; Previous = '20261012000001'; Name = 'phase_4_5_calendar'; File = '20261012000002_phase_4_5_calendar.sql' },
  @{ Version = '20261012000003'; Previous = '20261012000002'; Name = 'phase_4_5_activity_action_labels'; File = '20261012000003_phase_4_5_activity_action_labels.sql' },
  @{ Version = '20261012000004'; Previous = '20261012000003'; Name = 'phase_4_5_hide_completed_upcoming_tasks'; File = '20261012000004_phase_4_5_hide_completed_upcoming_tasks.sql' },
  @{ Version = '20261012000005'; Previous = '20261012000004'; Name = 'phase_4_5_home_local_date'; File = '20261012000005_phase_4_5_home_local_date.sql' },
  @{ Version = '20261012000006'; Previous = '20261012000005'; Name = 'phase_4_5_seven_character_approval_codes'; File = '20261012000006_phase_4_5_seven_character_approval_codes.sql' }
)

function Invoke-LocalPsql([string]$sql) {
  $result = docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql
  if ($LASTEXITCODE -ne 0) { throw 'Local database preflight query failed.' }
  return ($result -join "`n").Trim()
}

function Invoke-LocalSqlSuite([string]$sqlFile, [string]$label) {
  $path = Join-Path $PSScriptRoot $sqlFile
  $containerPath = "/tmp/$sqlFile"
  docker cp $path "${containerName}:$containerPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not copy $label into the local database container." }
  try {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $psqlCommand = "psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f '$containerPath' 2>&1"
    $output = @(docker exec $containerName sh -c $psqlCommand)
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    if ($exitCode -ne 0) {
      Write-Host ($output -join [Environment]::NewLine)
      throw "$label failed with psql exit code $exitCode. Its transaction was rolled back when the session closed."
    }
    $passed = @($output | Select-String -Pattern 'PASS:').Count
    Write-Host "$label assertions passed: $passed"
    return $passed
  } finally {
    $ErrorActionPreference = $previousErrorAction
    docker exec $containerName rm -f $containerPath | Out-Null
  }
}

$runningContainers = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $containerName) {
  throw "Local-only Phase 4.1B stopped: expected running container '$containerName' was not found."
}

$database = Invoke-LocalPsql 'select current_database();'
$version = Invoke-LocalPsql "select current_setting('server_version_num');"
if ($database -ne 'postgres' -or $version -notmatch '^17') {
  throw "Local-only Phase 4.1B stopped: unexpected database target ($database, PostgreSQL $version)."
}

$requiredVersions = @('20261008000000','20261008000001','20261008000002','20261009000000','20261009000001','20261009000002','20261010000000','20261010000001')
$recorded = @(docker exec $containerName psql -X -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations where version in ('$($requiredVersions -join "','")') order by version;")
if ($LASTEXITCODE -ne 0 -or ($recorded -join ',') -ne ($requiredVersions -join ',')) {
  throw 'Local-only Phase 4.1B stopped: expected foundation, color, Phase 4.0, and Phase 4.1A migrations are not all recorded.'
}

$typeUpdateGrant = Invoke-LocalPsql "select has_column_privilege('authenticated','public.environments','type','UPDATE');"
$invitationTables = Invoke-LocalPsql "select count(*) from information_schema.tables where table_schema='public' and table_name ilike '%invit%';"
if ($typeUpdateGrant -ne 'f' -or $invitationTables -ne '3') {
  throw 'Local-only Phase 4.1B stopped: direct type grant or invitation schema differs from reviewed assumptions.'
}

$beforeRows = Invoke-LocalPsql "select (select count(*) from public.environments) || ':' || (select count(*) from public.environment_members) || ':' || (select count(*) from public.sections) || ':' || (select count(*) from public.resources) || ':' || (select count(*) from public.environment_color_preferences);"
$latestVersion = Invoke-LocalPsql 'select max(version) from supabase_migrations.schema_migrations;'
foreach ($stage in $migrationStages) {
  $migrationRecorded = Invoke-LocalPsql "select count(*) from supabase_migrations.schema_migrations where version = '$($stage.Version)';"
  if ($migrationRecorded -eq '0') {
    $expectedPrevious = if ($stage.Previous) { $stage.Previous } else { ([long]$stage.Version - 1).ToString() }
    if ($latestVersion -ne $expectedPrevious) {
      throw "Local migration order differs before $($stage.Version). Expected $expectedPrevious, found $latestVersion."
    }
    $migrationPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\supabase\migrations\$($stage.File)"))
    $containerPath = "/tmp/$($stage.File)"
    docker cp $migrationPath "${containerName}:$containerPath" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not copy local migration $($stage.File) into the database container." }
    try {
      docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f $containerPath
      if ($LASTEXITCODE -ne 0) { throw "Local migration failed: $($stage.File). Stop and inspect the local database." }
      [void](Invoke-LocalPsql "insert into supabase_migrations.schema_migrations (version, name, statements) values ('$($stage.Version)', '$($stage.Name)', '{}'::text[]);")
    } finally {
      docker exec $containerName rm -f $containerPath | Out-Null
    }
    $latestVersion = $stage.Version
  } elseif ($migrationRecorded -ne '1' -or [long]$latestVersion -lt [long]$stage.Version) {
    throw "Local migration ledger is inconsistent at $($stage.Version)."
  }
}

$migrationVersion = '20261012000006'
$conversionFunction = Invoke-LocalPsql "select count(*) from pg_proc where oid = to_regprocedure('public.convert_environment_type(uuid,public.environment_type)');"
$groupMoveFunction = Invoke-LocalPsql "select count(*) from pg_proc where oid = to_regprocedure('public.move_section_group(uuid,uuid,numeric,numeric,numeric,numeric,timestamp with time zone)');"
$invitationSchema = Invoke-LocalPsql "select count(*) from information_schema.tables where table_schema='public' and table_name in ('environment_invitations','environment_invitation_codes','environment_join_requests','environment_invitation_code_attempts');"
$homeCountFunction = Invoke-LocalPsql "select count(*) from pg_proc where oid = to_regprocedure('public.get_home_environment_resource_counts()');"
$upcomingFunction = Invoke-LocalPsql "select count(*) from pg_proc where oid = to_regprocedure('public.get_home_upcoming_calendar_items(date)');"
$activityTable = Invoke-LocalPsql "select count(*) from information_schema.tables where table_schema='public' and table_name='environment_activity';"
$calendarTable = Invoke-LocalPsql "select count(*) from information_schema.tables where table_schema='public' and table_name='environment_calendar_items';"
if ($conversionFunction -ne '1' -or $groupMoveFunction -ne '1' -or $invitationSchema -ne '4' -or
    $homeCountFunction -ne '1' -or $upcomingFunction -ne '1' -or $activityTable -ne '1' -or $calendarTable -ne '1') {
  throw 'Local migration ledger and Phase 4.1C schema do not match.'
}

$afterMigrationRows = Invoke-LocalPsql "select (select count(*) from public.environments) || ':' || (select count(*) from public.environment_members) || ':' || (select count(*) from public.sections) || ':' || (select count(*) from public.resources) || ':' || (select count(*) from public.environment_color_preferences);"
if ($afterMigrationRows -ne $beforeRows) { throw "Migration changed existing row counts ($beforeRows -> $afterMigrationRows). Stop and inspect." }
$sharedWithoutDefault = Invoke-LocalPsql "select count(*) from public.environments e where e.type='shared' and not exists (select 1 from public.environment_invitation_codes c where c.environment_id=e.id and c.is_default);"
if ($sharedWithoutDefault -ne '0') { throw 'Local Phase 4.5 preflight found a Shared Environment without a default-code record.' }
$functionOwner = Invoke-LocalPsql "select pg_get_userbyid(proowner) from pg_proc where oid = to_regprocedure('public.convert_environment_type(uuid,public.environment_type)');"
$executeGrant = Invoke-LocalPsql "select has_function_privilege('authenticated','public.convert_environment_type(uuid,public.environment_type)','EXECUTE');"
if ($functionOwner -ne 'postgres' -or $executeGrant -ne 't') {
  throw 'Local-only Phase 4.1B stopped: the trusted function owner or authenticated RPC grant does not match expectations.'
}

Write-Output "Verified local target: $containerName, database $database, PostgreSQL 17"
Write-Output "Environment type update grant for authenticated: $typeUpdateGrant"
Write-Output "Invitation tables found: $invitationTables"
Write-Output "Phase 4.5 migrations applied locally through: $migrationVersion"
Write-Output 'Verified each current Shared Environment has a default-code lifecycle record.'
$typeAssertions = Invoke-LocalSqlSuite 'test-environment-type-conversion-local.sql' 'Phase 4.1B type conversion suite'
$countAssertions = Invoke-LocalSqlSuite 'test-home-resource-counts-local.sql' 'Phase 4.1C Home resource count suite'
$invitationAssertions = Invoke-LocalSqlSuite 'test-environment-invitations-local.sql' 'Phase 4.1C invitation regression suite'
$fileImageAssertions = Invoke-LocalSqlSuite 'test-file-image-sections-local.sql' 'Phase 4.3–4.4 File, Image, and Sections suite'
$defaultCodeAssertions = Invoke-LocalSqlSuite 'test-phase-4-5-default-codes-local.sql' 'Phase 4.5 default sharing-code suite'
$activityAssertions = Invoke-LocalSqlSuite 'test-phase-4-5-activity-local.sql' 'Phase 4.5 activity history suite'
$calendarAssertions = Invoke-LocalSqlSuite 'test-phase-4-5-calendar-local.sql' 'Phase 4.5 calendar suite'
$settingsAssertions = Invoke-LocalSqlSuite 'test-environment-settings-local.sql' 'Phase 4.1A Environment settings regression suite'
$roleAssertions = Invoke-LocalSqlSuite 'test-role-rls-local.sql' 'Phase 4.0 role RLS regression suite'
$colorAssertions = Invoke-LocalSqlSuite 'test-color-rls-local.sql' 'Phase 3D.2 color regression suite'
$concurrencyOutput = @(& (Join-Path $PSScriptRoot 'test-environment-type-concurrency-local.ps1'))
if ($LASTEXITCODE -ne 0 -or ($concurrencyOutput -join "`n") -notmatch 'PASS: concurrent membership insertion') {
  throw 'Phase 4.1B local membership concurrency test failed.'
}
Write-Output ($concurrencyOutput -join [Environment]::NewLine)
$canvasConcurrencyOutput = @(& (Join-Path $PSScriptRoot 'test-canvas-layout-concurrency-local.ps1'))
if ($LASTEXITCODE -ne 0 -or ($canvasConcurrencyOutput -join "`n") -notmatch 'PASS: concurrent Section group and Resource movement') {
  throw 'Phase 4.4 local canvas layout concurrency test failed.'
}
Write-Output ($canvasConcurrencyOutput -join [Environment]::NewLine)
$codeConcurrencyOutput = @(& (Join-Path $PSScriptRoot 'test-default-code-concurrency-local.ps1'))
if ($LASTEXITCODE -ne 0 -or ($codeConcurrencyOutput -join "`n") -notmatch 'PASS: concurrent Personal-to-Shared conversions') {
  throw 'Phase 4.5 local default-code concurrency test failed.'
}
Write-Output ($codeConcurrencyOutput -join [Environment]::NewLine)
$redemptionConcurrencyOutput = @(& (Join-Path $PSScriptRoot 'test-invitation-code-redemption-concurrency-local.ps1'))
if ($LASTEXITCODE -ne 0 -or ($redemptionConcurrencyOutput -join "`n") -notmatch 'PASS: concurrent code redemptions') {
  throw 'Local concurrent invitation-code redemption test failed.'
}
Write-Output ($redemptionConcurrencyOutput -join [Environment]::NewLine)
Write-Output "Synthetic row counts after rollback: $(Invoke-LocalPsql "select (select count(*) from public.environments) || ':' || (select count(*) from public.environment_members) || ':' || (select count(*) from public.sections) || ':' || (select count(*) from public.resources) || ':' || (select count(*) from public.environment_color_preferences);")"
Write-Output "Total local authenticated assertions passed: $($typeAssertions + $countAssertions + $invitationAssertions + $fileImageAssertions + $defaultCodeAssertions + $activityAssertions + $calendarAssertions + $settingsAssertions + $roleAssertions + $colorAssertions + 5)"
