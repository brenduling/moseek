$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

# Local-only runner. It never accepts a URL/key, never calls a hosted Supabase
# command, and never resets the database. Synthetic test data is rolled back.
$containerName = 'supabase_db_moseek'
$migrationVersions = @(
  '20261009000000',
  '20261009000001',
  '20261009000002'
)

function Invoke-LocalPsql([string]$sql) {
  $result = docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql
  if ($LASTEXITCODE -ne 0) { throw 'Local database preflight query failed.' }
  return ($result -join "`n").Trim()
}

$runningContainers = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $containerName) {
  throw "Local-only Phase 4.0 stopped: expected running container '$containerName' was not found."
}

$version = Invoke-LocalPsql "select current_setting('server_version_num');"
if ($version -notmatch '^17') { throw "Local-only Phase 4.0 stopped: expected PostgreSQL 17, found '$version'." }
$database = Invoke-LocalPsql 'select current_database();'
if ($database -ne 'postgres') { throw "Local-only Phase 4.0 stopped: unexpected database '$database'." }

$baseVersions = @(docker exec $containerName psql -X -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations where version in ('20261008000000','20261008000001','20261008000002') order by version;")
if ($LASTEXITCODE -ne 0 -or ($baseVersions -join ',') -ne '20261008000000,20261008000001,20261008000002') {
  throw 'Local-only Phase 4.0 stopped: expected foundation and Phase 3D.2 migrations are not all recorded.'
}

$appliedVersions = @(docker exec $containerName psql -X -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations where version in ('20261009000000','20261009000001','20261009000002') order by version;")
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect local Phase 4.0 migration state.' }
$enumLabels = Invoke-LocalPsql "select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.environment_role'::regtype;"

if ($appliedVersions.Count -eq 0) {
  if ($enumLabels -ne 'owner,admin,member') {
    throw "Local-only Phase 4.0 stopped: migration ledger is at the foundation state but roles are '$enumLabels'. Inspect before proceeding."
  }
  $beforeRows = Invoke-LocalPsql "select (select count(*) from public.environments) || ':' || (select count(*) from public.environment_members) || ':' || (select count(*) from public.sections) || ':' || (select count(*) from public.resources);"
  $index = 0
  foreach ($migrationPath in @(
    (Join-Path $PSScriptRoot '..\supabase\migrations\20261009000000_phase_4_0_rename_member_to_editor.sql'),
    (Join-Path $PSScriptRoot '..\supabase\migrations\20261009000001_phase_4_0_add_viewer_role.sql'),
    (Join-Path $PSScriptRoot '..\supabase\migrations\20261009000002_phase_4_0_role_policies.sql')
  )) {
    $migrationPath = [System.IO.Path]::GetFullPath($migrationPath)
    $fileName = [System.IO.Path]::GetFileName($migrationPath)
    $migrationVersion = $fileName.Substring(0, 14)
    $migrationName = $fileName.Substring(15, $fileName.Length - 19)
    if ($migrationVersion -ne $migrationVersions[$index]) { throw "Unexpected migration file order: $fileName" }
    $containerPath = "/tmp/$fileName"
    docker cp $migrationPath "${containerName}:$containerPath" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not copy local migration $fileName into the local database container." }
    try {
      docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f $containerPath
      if ($LASTEXITCODE -ne 0) { throw "Local migration failed: $fileName. Stop and inspect the database before continuing." }
      $ledgerSql = "insert into supabase_migrations.schema_migrations (version, name, statements) values ('$migrationVersion', '$migrationName', '{}'::text[]);"
      [void](Invoke-LocalPsql $ledgerSql)
    }
    finally {
      docker exec $containerName rm -f $containerPath | Out-Null
    }
    $index++
  }
  $afterRows = Invoke-LocalPsql "select (select count(*) from public.environments) || ':' || (select count(*) from public.environment_members) || ':' || (select count(*) from public.sections) || ':' || (select count(*) from public.resources);"
  if ($afterRows -ne $beforeRows) { throw "Local migration changed existing row counts ($beforeRows -> $afterRows). Stop and inspect." }
  $appliedVersions = $migrationVersions
  $enumLabels = Invoke-LocalPsql "select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.environment_role'::regtype;"
} elseif (($appliedVersions -join ',') -ne ($migrationVersions -join ',')) {
  throw "Local-only Phase 4.0 stopped: only some Phase 4.0 migrations are recorded ($($appliedVersions -join ',')). Inspect before proceeding."
}

if ($enumLabels -ne 'owner,admin,editor,viewer') {
  throw "Local-only Phase 4.0 stopped: unexpected final role labels '$enumLabels'."
}

$postRows = Invoke-LocalPsql "select (select count(*) from public.environments) || ':' || (select count(*) from public.environment_members) || ':' || (select count(*) from public.sections) || ':' || (select count(*) from public.resources);"
Write-Output "Verified local target: $containerName, database $database, PostgreSQL $($version.Substring(0, 2))"
Write-Output "Phase 4.0 migrations: $($migrationVersions -join ', ')"
Write-Output "Existing row counts after migration (environments:members:sections:resources): $postRows"

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
      throw "$label failed with psql exit code $exitCode. Its open transaction is rolled back when the session closes."
    }
    $passed = @($output | Select-String -Pattern 'PASS:').Count
    Write-Host "$label assertions passed: $passed"
    return $passed
  }
  catch {
    $ErrorActionPreference = $previousErrorAction
    throw
  }
  finally {
    docker exec $containerName rm -f $containerPath | Out-Null
  }
}

$roleAssertions = Invoke-LocalSqlSuite 'test-role-rls-local.sql' 'Phase 4.0 role RLS suite'
$colorAssertions = Invoke-LocalSqlSuite 'test-color-rls-local.sql' 'Phase 3D.2 color regression suite'
Write-Output "Total local authenticated regression assertions passed: $($roleAssertions + $colorAssertions)"
