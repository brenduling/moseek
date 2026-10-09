$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$containerName = 'supabase_db_moseek'
$running = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $running -notcontains $containerName) {
  throw 'Local-only invitation-code concurrency test could not find supabase_db_moseek.'
}
$preflight = @(docker exec $containerName psql -X -U postgres -d postgres -Atc "select current_database() || '|' || current_setting('server_version_num') || '|' || count(*) from supabase_migrations.schema_migrations where version='20261012000006';")
if ($LASTEXITCODE -ne 0 -or ($preflight -join '') -ne 'postgres|170011|1') {
  throw 'Local-only invitation-code concurrency preflight failed.'
}

$ownerId = [guid]::NewGuid().ToString()
$applicantId = [guid]::NewGuid().ToString()
$environmentId = [guid]::NewGuid().ToString()
$owner = "'$ownerId'::uuid"
$applicant = "'$applicantId'::uuid"
$environment = "'$environmentId'::uuid"
$job = $null

function Invoke-LocalPsql([string]$sql) {
  $output = docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql
  if ($LASTEXITCODE -ne 0) { throw 'Local-only invitation-code fixture or verification failed.' }
  return ($output -join "`n").Trim()
}

function Start-DelayedAction([string]$userId, [string]$action, [string]$applicationName) {
  $sql = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$userId',true);
select set_config('request.jwt.claims',json_build_object('sub','$userId','role','authenticated')::text,true);
select set_config('application_name','$applicationName',false);
$action
select pg_sleep(5);
commit;
"@
  return Start-Job -ScriptBlock {
    param($dbContainer, $query)
    $output = @(docker exec $dbContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $query 2>&1)
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } -ArgumentList $containerName, $sql
}

function Wait-ForDelayedAction([string]$applicationName) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $active = Invoke-LocalPsql "select count(*) from pg_stat_activity where datname='postgres' and application_name='$applicationName' and state='active' and query ilike '%pg_sleep(5)%';"
    if ($active -ne '0') { return }
    Start-Sleep -Milliseconds 200
  }
  throw "Could not observe local transaction '$applicationName' holding its Environment lock."
}

function Invoke-CompetingAction([string]$sql) {
  $priorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = @(docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql 2>&1)
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $priorAction
  if ($exitCode -ne 0) { throw "Competing local action failed: $($output -join "`n")" }
  return ($output -join "`n")
}

try {
  [void](Invoke-LocalPsql @"
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) values
($owner,'authenticated','authenticated','phase45-code-race-owner-$ownerId@example.invalid','',now(),'{}','{}',now(),now(),false,false),
($applicant,'authenticated','authenticated','phase45-code-race-applicant-$applicantId@example.invalid','',now(),'{}','{}',now(),now(),false,false);
insert into public.environments(id,name,type,created_by) values($environment,'Invitation code race fixture','shared',$owner);
"@)

  $codeQuery = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$ownerId',true);
select set_config('request.jwt.claims',json_build_object('sub','$ownerId','role','authenticated')::text,true);
select invitation_code from public.create_environment_invitation_code($environment,'editor');
commit;
"@
  $codeOutput = Invoke-LocalPsql $codeQuery
  $matches = @([regex]::Matches($codeOutput, '(?m)^[A-HJ-NP-Z2-9]{7}$'))
  if ($matches.Count -ne 1) { throw 'Local RPC did not return exactly one seven-character code value.' }
  $code = $matches[0].Value
  if ($code -notmatch '[A-Z]' -or $code -notmatch '[2-9]') {
    throw 'Local RPC returned a code missing a required letter or digit.'
  }

  $firstRedeem = Start-DelayedAction $applicantId "select public.redeem_environment_invitation_code('$code');" 'moseek_code_redemption_first'
  $job = $firstRedeem
  Wait-ForDelayedAction 'moseek_code_redemption_first'
  $secondRedeem = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$applicantId',true);
select set_config('request.jwt.claims',json_build_object('sub','$applicantId','role','authenticated')::text,true);
select public.redeem_environment_invitation_code('$code');
commit;
"@
  $secondOutput = Invoke-CompetingAction $secondRedeem
  Wait-Job $job -Timeout 15 | Out-Null
  if ($job.State -ne 'Completed') { Stop-Job $job -ErrorAction SilentlyContinue; throw 'Concurrent duplicate code redemption did not finish.' }
  $firstResult = Receive-Job $job
  Remove-Job $job
  $job = $null
  if ($firstResult.ExitCode -ne 0 -or $firstResult.Output -notmatch 'approval_pending' -or $secondOutput -notmatch 'approval_pending') {
    throw 'Concurrent duplicate code redemptions did not both return Pending approval.'
  }
  $duplicateState = Invoke-LocalPsql "select (select count(*) from public.environment_join_requests where environment_id=$environment and user_id=$applicant and status='pending') || '|' || (select count(*) from public.environment_members where environment_id=$environment and user_id=$applicant);"
  if ($duplicateState -ne '1|0') { throw "Concurrent redemptions produced unexpected request/membership state: $duplicateState." }
  Write-Output 'PASS: concurrent code redemptions create one pending request and no membership.'

  $requestId = Invoke-LocalPsql "select id from public.environment_join_requests where environment_id=$environment and user_id=$applicant and status='pending' limit 1;"
  $ownerApproval = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$ownerId',true);
select set_config('request.jwt.claims',json_build_object('sub','$ownerId','role','authenticated')::text,true);
select set_config('application_name','moseek_code_approval_race',false);
select public.respond_to_environment_join_request('$requestId'::uuid,true);
select pg_sleep(5);
commit;
"@
  $job = Start-Job -ScriptBlock {
    param($dbContainer, $query)
    $output = @(docker exec $dbContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $query 2>&1)
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } -ArgumentList $containerName, $ownerApproval
  Wait-ForDelayedAction 'moseek_code_approval_race'
  $racingRedemption = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$applicantId',true);
select set_config('request.jwt.claims',json_build_object('sub','$applicantId','role','authenticated')::text,true);
select public.redeem_environment_invitation_code('$code');
commit;
"@
  $racingResult = Invoke-CompetingAction $racingRedemption
  Wait-Job $job -Timeout 15 | Out-Null
  if ($job.State -ne 'Completed') { Stop-Job $job -ErrorAction SilentlyContinue; throw 'Concurrent approval and redemption did not finish.' }
  $approvalResult = Receive-Job $job
  Remove-Job $job
  $job = $null
  if ($approvalResult.ExitCode -ne 0 -or $approvalResult.Output -notmatch 'accepted' -or $racingResult -notmatch 'already_joined') {
    $approvalState = [regex]::Match($approvalResult.Output, '\b(accepted|declined|expired|revoked|unavailable)\b').Value
    $redemptionState = [regex]::Match($racingResult, '\b(already_joined|approval_pending|invalid|rate_limited)\b').Value
    throw "Concurrent approval/redemption returned unexpected states (approval exit $($approvalResult.ExitCode): '$approvalState'; redemption: '$redemptionState')."
  }
  $finalState = Invoke-LocalPsql "select (select count(*) from public.environment_members where environment_id=$environment and user_id=$applicant and role='editor') || '|' || (select count(*) from public.environment_join_requests where environment_id=$environment and user_id=$applicant and status='accepted');"
  if ($finalState -ne '1|1') { throw "Concurrent approval/redemption produced unexpected state: $finalState." }
  Write-Output 'PASS: approval and repeated redemption serialize with exactly one authorized membership.'
} finally {
  if ($job -and $job.State -in @('Running','NotStarted')) { Stop-Job $job -ErrorAction SilentlyContinue }
  if ($job) { Remove-Job $job -Force -ErrorAction SilentlyContinue }
  [void](Invoke-LocalPsql "delete from public.environments where id=$environment; delete from auth.users where id in ($owner,$applicant);")
}
