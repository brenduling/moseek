$ErrorActionPreference = 'Stop'

# This runner has no Supabase URL or credential inputs. It only talks to the
# explicitly named local Docker container and refuses any other target.
$containerName = 'supabase_db_moseek'
$runningContainers = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $containerName) {
  throw "Local-only test stopped: expected running container '$containerName' was not found."
}

$version = docker exec $containerName psql -U postgres -d postgres -Atc "select current_setting('server_version_num');"
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^17') {
  throw "Local-only test stopped: '$containerName' did not report PostgreSQL 17."
}

$migrationVersions = @(docker exec $containerName psql -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations where version in ('20261008000000','20261008000001','20261008000002') order by version;")
if ($LASTEXITCODE -ne 0 -or ($migrationVersions -join ',') -ne '20261008000000,20261008000001,20261008000002') {
  throw 'Local-only test stopped: expected three Phase 3D.2 migrations are not all recorded on this local database.'
}

$sqlPath = Join-Path $PSScriptRoot 'test-color-rls-local.sql'
$containerSqlPath = '/tmp/moseek-phase-3d2-color-rls.sql'
docker cp $sqlPath "${containerName}:$containerSqlPath" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Could not copy the regression script into the verified local database container.'
}

try {
  Write-Output "Local target: $containerName, PostgreSQL 17, database postgres"
  Write-Output 'Migration versions: 20261008000000, 20261008000001, 20261008000002'
  docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f $containerSqlPath
  if ($LASTEXITCODE -ne 0) {
    throw "Regression suite failed with psql exit code $LASTEXITCODE. Its open transaction is rolled back when the session closes."
  }
}
finally {
  docker exec $containerName rm -f $containerSqlPath | Out-Null
}
