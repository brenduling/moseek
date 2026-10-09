$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$containerName = 'supabase_db_moseek'
$running = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $running -notcontains $containerName) {
  throw "Local-only concurrency test stopped: expected '$containerName' was not found."
}
$target = @(docker exec $containerName psql -X -U postgres -d postgres -Atc "select current_database() || '|' || current_setting('server_version_num') || '|' || count(*) from supabase_migrations.schema_migrations where version = '20261010000001';")
if ($LASTEXITCODE -ne 0 -or $target -ne 'postgres|170011|1') {
  throw 'Local-only concurrency test stopped: database, PostgreSQL version, or local migration state differs.'
}

$ownerId = [guid]::NewGuid().ToString()
$memberId = [guid]::NewGuid().ToString()
$environmentId = [guid]::NewGuid().ToString()
$inviteeId = [guid]::NewGuid().ToString()
$inviteEnvironmentId = [guid]::NewGuid().ToString()
$invitationId = [guid]::NewGuid().ToString()

function Invoke-LocalPsql([string]$sql) {
  $output = docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql
  if ($LASTEXITCODE -ne 0) { throw 'Local-only concurrency fixture setup or verification failed.' }
  return ($output -join "`n").Trim()
}

$ownerLiteral = "'$ownerId'::uuid"
$memberLiteral = "'$memberId'::uuid"
$environmentLiteral = "'$environmentId'::uuid"
$inviteeLiteral = "'$inviteeId'::uuid"
$inviteEnvironmentLiteral = "'$inviteEnvironmentId'::uuid"
$invitationLiteral = "'$invitationId'::uuid"
$setupSql = @"
insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
values ($ownerLiteral,'authenticated','authenticated','phase41b-concurrency-owner-$ownerId@example.invalid','',now(),'{}','{}',now(),now(),false,false),
       ($memberLiteral,'authenticated','authenticated','phase41b-concurrency-member-$memberId@example.invalid','',now(),'{}','{}',now(),now(),false,false),
       ($inviteeLiteral,'authenticated','authenticated','phase41c-concurrency-invitee-$inviteeId@example.invalid','',now(),'{}','{}',now(),now(),false,false);
insert into public.environments (id,name,type,created_by) values ($environmentLiteral,'Concurrency fixture','shared',$ownerLiteral);
insert into public.environments (id,name,type,created_by) values ($inviteEnvironmentLiteral,'Invitation concurrency fixture','shared',$ownerLiteral);
insert into public.environment_invitations (id,environment_id,invited_user_id,invited_by,invited_by_role,role,expires_at)
values ($invitationLiteral,$inviteEnvironmentLiteral,$inviteeLiteral,$ownerLiteral,'owner','editor',now()+interval '7 days');
"@

try {
  [void](Invoke-LocalPsql $setupSql)
  $sessionA = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$ownerId',true);
select set_config('request.jwt.claims',json_build_object('sub','$ownerId','role','authenticated')::text,true);
select id from public.convert_environment_type($environmentLiteral,'personal');
select set_config('application_name','moseek_type_conversion_lock_held',false);
select pg_sleep(5);
commit;
"@
  $sessionB = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$ownerId',true);
select set_config('request.jwt.claims',json_build_object('sub','$ownerId','role','authenticated')::text,true);
insert into public.environment_members (environment_id,user_id,role) values ($environmentLiteral,$memberLiteral,'editor');
commit;
"@

  $job = Start-Job -ScriptBlock {
    param($dbContainer, $sql)
    $output = @(docker exec $dbContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql 2>&1)
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } -ArgumentList $containerName, $sessionA

  $conversionInFlight = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $activeConversion = Invoke-LocalPsql "select count(*) from pg_stat_activity where datname='postgres' and application_name='moseek_type_conversion_lock_held' and state='active' and query ilike '%pg_sleep(5)%';"
    if ($activeConversion -ne '0') { $conversionInFlight = $true; break }
    Start-Sleep -Milliseconds 200
  }
  if (-not $conversionInFlight) { throw 'Could not observe the local Owner conversion holding its transaction open.' }
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $sessionBOutput = @(docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sessionB 2>&1)
  $sessionBExit = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  $timer.Stop()

  Wait-Job $job -Timeout 15 | Out-Null
  if ($job.State -ne 'Completed') {
    Stop-Job $job -ErrorAction SilentlyContinue
    throw 'Concurrent conversion session did not finish within the local test timeout.'
  }
  $sessionAResult = Receive-Job $job
  Remove-Job $job

  if ($sessionAResult.ExitCode -ne 0) {
    throw "Owner conversion transaction failed during concurrency test: $($sessionAResult.Output)"
  }
  if ($sessionBExit -eq 0 -or ($sessionBOutput -join "`n") -notmatch 'Personal Environments only permit their owner') {
    throw "Concurrent membership INSERT was not rejected after conversion. Database output: $($sessionBOutput -join "`n")"
  }
  if ($timer.Elapsed.TotalSeconds -lt 2.5) {
    throw 'Concurrent membership INSERT did not wait for the in-flight type conversion lock.'
  }

  $state = Invoke-LocalPsql "select e.type::text || '|' || count(m.user_id) from public.environments e join public.environment_members m on m.environment_id=e.id where e.id=$environmentLiteral group by e.type;"
  if ($state -ne 'personal|1') {
    throw "Concurrent test left an invalid final state: $state"
  }

  $acceptSession = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$inviteeId',true);
select set_config('request.jwt.claims',json_build_object('sub','$inviteeId','role','authenticated')::text,true);
select public.respond_to_environment_invitation($invitationLiteral,true);
select set_config('application_name','moseek_invitation_acceptance_lock_held',false);
select pg_sleep(5);
commit;
"@
  $convertSession = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$ownerId',true);
select set_config('request.jwt.claims',json_build_object('sub','$ownerId','role','authenticated')::text,true);
select id from public.convert_environment_type($inviteEnvironmentLiteral,'personal');
commit;
"@
  $acceptJob = Start-Job -ScriptBlock {
    param($dbContainer, $sql)
    $output = @(docker exec $dbContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql 2>&1)
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } -ArgumentList $containerName, $acceptSession
  $acceptanceInFlight = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $activeAcceptance = Invoke-LocalPsql "select count(*) from pg_stat_activity where datname='postgres' and application_name='moseek_invitation_acceptance_lock_held' and state='active' and query ilike '%pg_sleep(5)%';"
    if ($activeAcceptance -ne '0') { $acceptanceInFlight = $true; break }
    Start-Sleep -Milliseconds 200
  }
  if (-not $acceptanceInFlight) { throw 'Could not observe invitation acceptance holding the Environment lock.' }
  $convertTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $convertOutput = @(docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $convertSession 2>&1)
  $convertExit = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  $convertTimer.Stop()
  Wait-Job $acceptJob -Timeout 15 | Out-Null
  if ($acceptJob.State -ne 'Completed') {
    Stop-Job $acceptJob -ErrorAction SilentlyContinue
    throw 'Concurrent invitation acceptance session did not finish within the local test timeout.'
  }
  $acceptResult = Receive-Job $acceptJob
  Remove-Job $acceptJob
  if ($acceptResult.ExitCode -ne 0) { throw "Invitation acceptance failed: $($acceptResult.Output)" }
  if ($convertExit -eq 0 -or ($convertOutput -join "`n") -notmatch 'Remove all other contributors') {
    throw "Concurrent conversion was not rejected after invitation acceptance. Output: $($convertOutput -join "`n")"
  }
  if ($convertTimer.Elapsed.TotalSeconds -lt 2.5) { throw 'Conversion did not wait for invitation acceptance to release the Environment lock.' }
  $inviteState = Invoke-LocalPsql "select e.type::text || '|' || count(m.user_id) || '|' || (select i.status from public.environment_invitations i where i.id=$invitationLiteral) from public.environments e join public.environment_members m on m.environment_id=e.id where e.id=$inviteEnvironmentLiteral group by e.type;"
  if ($inviteState -ne 'shared|2|accepted') { throw "Concurrent invitation test left invalid state: $inviteState" }
  Write-Output 'PASS: concurrent membership insertion is rejected after conversion; concurrent invitation acceptance serializes with conversion, leaving a Shared Environment with two members.'
} finally {
  if ($job -and $job.State -in @('Running','NotStarted')) { Stop-Job $job -ErrorAction SilentlyContinue }
  if ($job) { Remove-Job $job -Force -ErrorAction SilentlyContinue }
  if ($acceptJob -and $acceptJob.State -in @('Running','NotStarted')) { Stop-Job $acceptJob -ErrorAction SilentlyContinue }
  if ($acceptJob) { Remove-Job $acceptJob -Force -ErrorAction SilentlyContinue }
  [void](Invoke-LocalPsql "delete from public.environments where id in ($environmentLiteral,$inviteEnvironmentLiteral); delete from auth.users where id in ($ownerLiteral,$memberLiteral,$inviteeLiteral);")
}
