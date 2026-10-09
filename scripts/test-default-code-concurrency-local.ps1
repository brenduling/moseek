$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$containerName = 'supabase_db_moseek'
$running = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $running -notcontains $containerName) { throw 'Local-only default-code concurrency test could not find supabase_db_moseek.' }
$preflight = @(docker exec $containerName psql -X -U postgres -d postgres -Atc "select current_database() || '|' || current_setting('server_version_num') || '|' || count(*) from supabase_migrations.schema_migrations where version='20261012000003';")
if ($LASTEXITCODE -ne 0 -or ($preflight -join '') -ne 'postgres|170011|1') { throw 'Local-only default-code concurrency preflight failed.' }

$ownerId = [guid]::NewGuid().ToString()
$environmentId = [guid]::NewGuid().ToString()
$owner = "'$ownerId'::uuid"
$environment = "'$environmentId'::uuid"
$job = $null
function Invoke-LocalPsql([string]$sql) {
  $output = docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql
  if ($LASTEXITCODE -ne 0) { throw 'Local-only default-code fixture or verification failed.' }
  return ($output -join "`n").Trim()
}

try {
  [void](Invoke-LocalPsql @"
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
values($owner,'authenticated','authenticated','phase45-code-concurrency-$ownerId@example.invalid','',now(),'{}','{}',now(),now(),false,false);
insert into public.environments(id,name,type,created_by) values($environment,'Default code concurrency fixture','personal',$owner);
"@)
  $first = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$ownerId',true);
select set_config('request.jwt.claims',json_build_object('sub','$ownerId','role','authenticated')::text,true);
select id from public.convert_environment_type($environment,'shared');
select set_config('application_name','moseek_default_code_conversion_lock',false);
select pg_sleep(5);
commit;
"@
  $second = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$ownerId',true);
select set_config('request.jwt.claims',json_build_object('sub','$ownerId','role','authenticated')::text,true);
select id from public.convert_environment_type($environment,'shared');
commit;
"@
  $job = Start-Job -ScriptBlock {
    param($dbContainer, $sql)
    $output = @(docker exec $dbContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql 2>&1)
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } -ArgumentList $containerName, $first

  $locked = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $active = Invoke-LocalPsql "select count(*) from pg_stat_activity where datname='postgres' and application_name='moseek_default_code_conversion_lock' and state='active' and query ilike '%pg_sleep(5)%';"
    if ($active -ne '0') { $locked = $true; break }
    Start-Sleep -Milliseconds 200
  }
  if (-not $locked) { throw 'Could not observe the first conversion holding its Environment lock.' }
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $priorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $secondOutput = @(docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $second 2>&1)
  $secondExit = $LASTEXITCODE
  $ErrorActionPreference = $priorAction
  $timer.Stop()
  Wait-Job $job -Timeout 15 | Out-Null
  if ($job.State -ne 'Completed') { Stop-Job $job -ErrorAction SilentlyContinue; throw 'Concurrent default-code conversion did not finish.' }
  $firstResult = Receive-Job $job; Remove-Job $job; $job = $null
  if ($firstResult.ExitCode -ne 0) { throw "First conversion failed: $($firstResult.Output)" }
  if ($secondExit -ne 0) { throw "Second conversion failed: $($secondOutput -join "`n")" }
  if ($timer.Elapsed.TotalSeconds -lt 2.5) { throw 'Second conversion did not serialize behind the first Environment lock.' }
  $codes = Invoke-LocalPsql "select count(*) from public.environment_invitation_codes where environment_id=$environment and is_default and revoked_at is null and expires_at>now();"
  if ($codes -ne '1') { throw "Expected one active default code after concurrent conversion, found $codes." }
  Write-Output 'PASS: concurrent Personal-to-Shared conversions serialize and leave exactly one active default code.'
} finally {
  if ($job -and $job.State -in @('Running','NotStarted')) { Stop-Job $job -ErrorAction SilentlyContinue }
  if ($job) { Remove-Job $job -Force -ErrorAction SilentlyContinue }
  [void](Invoke-LocalPsql "delete from public.environments where id=$environment; delete from auth.users where id=$owner;")
}
