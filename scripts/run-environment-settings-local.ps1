$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

# Local-only migration and authenticated regression runner. It pins a fixed
# local database container, never accepts a remote URL/key, and never resets.
$containerName = 'supabase_db_moseek'
$migrationVersion = '20261010000000'
$migrationPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\supabase\migrations\20261010000000_phase_4_1a_environment_description.sql'))

function Invoke-LocalPsql([string]$sql) {
  $result = docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql
  if ($LASTEXITCODE -ne 0) { throw 'Local database preflight query failed.' }
  return ($result -join "`n").Trim()
}

$runningContainers = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $containerName) {
  throw "Local-only Phase 4.1A stopped: expected running container '$containerName' was not found."
}

$database = Invoke-LocalPsql 'select current_database();'
$version = Invoke-LocalPsql 'select current_setting(''server_version_num'');'
if ($database -ne 'postgres' -or $version -notmatch '^17') {
  throw "Local-only Phase 4.1A stopped: unexpected database target ($database, PostgreSQL $version)."
}

$requiredVersions = @('20261008000000','20261008000001','20261008000002','20261009000000','20261009000001','20261009000002')
$recordedVersions = @(docker exec $containerName psql -X -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations where version in ('$($requiredVersions -join "','")') order by version;")
if ($LASTEXITCODE -ne 0 -or ($recordedVersions -join ',') -ne ($requiredVersions -join ',')) {
  throw 'Local-only Phase 4.1A stopped: expected foundation, color, and Phase 4.0 migrations are not all recorded.'
}

$latestVersion = Invoke-LocalPsql 'select max(version) from supabase_migrations.schema_migrations;'
$migrationRecorded = Invoke-LocalPsql "select count(*) from supabase_migrations.schema_migrations where version = '$migrationVersion';"
$descriptionColumn = Invoke-LocalPsql "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'environments' and column_name = 'description' and data_type = 'text';"
$descriptionConstraint = Invoke-LocalPsql "select count(*) from pg_constraint where conrelid = 'public.environments'::regclass and conname = 'environments_description_length_check';"
$descriptionGrant = Invoke-LocalPsql "select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'environments' and column_name = 'description' and grantee = 'authenticated' and privilege_type = 'UPDATE';"

if ($migrationRecorded -eq '0') {
  if ($latestVersion -ne '20261009000002' -or $descriptionColumn -ne '0' -or $descriptionConstraint -ne '0' -or $descriptionGrant -ne '0') {
    throw 'Local-only Phase 4.1A stopped: local migration order or pre-migration schema differs from the reviewed preflight.'
  }
  $beforeRows = Invoke-LocalPsql "select (select count(*) from public.environments) || ':' || (select count(*) from public.environment_members) || ':' || (select count(*) from public.sections) || ':' || (select count(*) from public.resources);"
  $fileName = [System.IO.Path]::GetFileName($migrationPath)
  $containerPath = "/tmp/$fileName"
  docker cp $migrationPath "${containerName}:$containerPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy the local Phase 4.1A migration into the local database container.' }
  try {
    docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f $containerPath
    if ($LASTEXITCODE -ne 0) { throw 'Local Phase 4.1A migration failed. Stop and inspect the local database.' }
    [void](Invoke-LocalPsql "insert into supabase_migrations.schema_migrations (version, name, statements) values ('$migrationVersion', 'phase_4_1a_environment_description', '{}'::text[]);")
  }
  finally {
    docker exec $containerName rm -f $containerPath | Out-Null
  }
  $afterRows = Invoke-LocalPsql "select (select count(*) from public.environments) || ':' || (select count(*) from public.environment_members) || ':' || (select count(*) from public.sections) || ':' || (select count(*) from public.resources);"
  if ($afterRows -ne $beforeRows) { throw "Migration changed existing row counts ($beforeRows -> $afterRows). Stop and inspect." }
} elseif ($migrationRecorded -eq '1') {
  if ($latestVersion -ne $migrationVersion -or $descriptionColumn -ne '1' -or $descriptionConstraint -ne '1' -or $descriptionGrant -ne '1') {
    throw 'Local-only Phase 4.1A stopped: migration ledger and schema do not match.'
  }
} else {
  throw 'Local-only Phase 4.1A stopped: unexpected migration ledger state.'
}

Write-Output "Verified local target: $containerName, database $database, PostgreSQL 17"
Write-Output "Environment description migration: $migrationVersion (local only)"

$sqlFile = 'test-environment-settings-local.sql'
$testPath = Join-Path $PSScriptRoot $sqlFile
$testContainerPath = "/tmp/$sqlFile"
docker cp $testPath "${containerName}:$testContainerPath" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not copy the local Environment settings tests into the local database container.' }
try {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $psqlCommand = "psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f '$testContainerPath' 2>&1"
  $output = @(docker exec $containerName sh -c $psqlCommand)
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($exitCode -ne 0) {
    Write-Host ($output -join [Environment]::NewLine)
    throw 'Local Environment settings RLS tests failed; their transaction rolled back.'
  }
  $passed = @($output | Select-String -Pattern 'PASS:').Count
  Write-Output "Authenticated Environment settings RLS assertions passed: $passed"
} finally {
  $ErrorActionPreference = $previousErrorAction
  docker exec $containerName rm -f $testContainerPath | Out-Null
}
