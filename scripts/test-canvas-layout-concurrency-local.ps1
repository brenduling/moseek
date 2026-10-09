$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

# Local-only test for serializing a Section group move with a contained Resource
# move. It uses authenticated sessions and always removes its synthetic rows.
$containerName = 'supabase_db_moseek'
$running = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $running -notcontains $containerName) {
  throw "Local-only canvas concurrency test stopped: expected '$containerName' was not found."
}
$target = @(docker exec $containerName psql -X -U postgres -d postgres -Atc "select current_database() || '|' || current_setting('server_version_num') || '|' || count(*) from supabase_migrations.schema_migrations where version = '20261011000002';")
if ($LASTEXITCODE -ne 0 -or $target -ne 'postgres|170011|1') {
  throw 'Local-only canvas concurrency test stopped: target or Phase 4.4 migration differs.'
}

$ownerId = [guid]::NewGuid().ToString()
$actorId = [guid]::NewGuid().ToString()
$environmentId = [guid]::NewGuid().ToString()
$sectionId = [guid]::NewGuid().ToString()
$resourceId = [guid]::NewGuid().ToString()
$job = $null
function Invoke-LocalPsql([string]$sql) {
  $output = docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql
  if ($LASTEXITCODE -ne 0) { throw 'Local canvas concurrency fixture setup or verification failed.' }
  return ($output -join "`n").Trim()
}

$actor = "'$actorId'::uuid"
$owner = "'$ownerId'::uuid"
$environment = "'$environmentId'::uuid"
$section = "'$sectionId'::uuid"
$resource = "'$resourceId'::uuid"
$appName = 'moseek_group_move_lock_held'
try {
  [void](Invoke-LocalPsql @"
insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
values ($owner,'authenticated','authenticated','phase44-layout-owner-$ownerId@example.invalid','',now(),'{}','{}',now(),now(),false,false),
       ($actor,'authenticated','authenticated','phase44-layout-editor-$actorId@example.invalid','',now(),'{}','{}',now(),now(),false,false);
insert into public.environments (id,name,type,created_by) values ($environment,'Layout concurrency fixture','shared',$owner);
insert into public.environment_members (environment_id,user_id,role) values ($environment,$actor,'editor');
insert into public.sections (id,environment_id,title,x,y,width,height,created_by)
values ($section,$environment,'Section',100,100,660,430,$owner);
insert into public.resources (id,environment_id,section_id,created_by,type,title,x,y,body)
values ($resource,$environment,$section,$owner,'note','Contained note',450,480,'Test');
"@)

  $groupMove = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$actorId',true);
select set_config('request.jwt.claims',json_build_object('sub','$actorId','role','authenticated')::text,true);
select public.move_section_group($environment,$section,200,150,660,430,(select updated_at from public.sections where id=$section));
select set_config('application_name','$appName',false);
select pg_sleep(5);
commit;
"@
  $resourceMove = @"
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$actorId',true);
select set_config('request.jwt.claims',json_build_object('sub','$actorId','role','authenticated')::text,true);
update public.resources set x=x+25 where id=$resource and environment_id=$environment;
commit;
"@

  $job = Start-Job -ScriptBlock {
    param($dbContainer, $sql)
    $output = @(docker exec $dbContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $sql 2>&1)
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } -ArgumentList $containerName, $groupMove

  $moveInFlight = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $active = Invoke-LocalPsql "select count(*) from pg_stat_activity where datname='postgres' and application_name='$appName' and state='active' and query ilike '%pg_sleep(5)%';"
    if ($active -ne '0') { $moveInFlight = $true; break }
    Start-Sleep -Milliseconds 200
  }
  if (-not $moveInFlight) { throw 'Could not observe the Section move holding its transaction open.' }

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $oldErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $secondOutput = @(docker exec $containerName psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc $resourceMove 2>&1)
  $secondExit = $LASTEXITCODE
  $ErrorActionPreference = $oldErrorAction
  $timer.Stop()

  Wait-Job $job -Timeout 15 | Out-Null
  if ($job.State -ne 'Completed') { Stop-Job $job -ErrorAction SilentlyContinue; throw 'Section group move did not finish in time.' }
  $firstResult = Receive-Job $job
  Remove-Job $job
  $job = $null
  if ($firstResult.ExitCode -ne 0) { throw "Group move session failed: $($firstResult.Output)" }
  if ($secondExit -ne 0) { throw "Concurrent Resource move failed: $($secondOutput -join "`n")" }
  if ($timer.Elapsed.TotalSeconds -lt 2.5) { throw 'Concurrent Resource movement did not wait for the Section group transaction.' }

  $layout = Invoke-LocalPsql "select s.x::integer::text || '|' || s.y::integer::text || '|' || r.x::integer::text || '|' || r.y::integer::text from public.sections s join public.resources r on r.section_id=s.id where s.id=$section and r.id=$resource;"
  if ($layout -ne '200|150|575|530') { throw "Concurrent canvas writes produced an unexpected layout: $layout" }
  Write-Output 'PASS: concurrent Section group and Resource movement serialize without losing either saved change.'
} finally {
  if ($job -and $job.State -in @('Running','NotStarted')) { Stop-Job $job -ErrorAction SilentlyContinue }
  if ($job) { Remove-Job $job -Force -ErrorAction SilentlyContinue }
  [void](Invoke-LocalPsql "delete from public.environments where id=$environment; delete from auth.users where id in ($owner,$actor);")
}
