[CmdletBinding(DefaultParameterSetName = 'Regression')]
param(
  [Parameter(ParameterSetName = 'Load', Mandatory)][switch]$Load,
  [Parameter(ParameterSetName = 'Load')][string]$K6Executable,
  [Parameter(ParameterSetName = 'Upgrade', Mandatory)][switch]$Upgrade
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$tag = [Guid]::NewGuid().ToString('N').Substring(0,12)
$dbName = "reelpass_it_$tag"
$pgName = "reelpass-it-pg-$tag"
$redisName = "reelpass-it-redis-$tag"
function Invoke-CheckedDocker {
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "Disposable Docker operation failed: $($args[0])" }
}
$started = @()
try {
  Invoke-CheckedDocker run --pull=never --rm -d --name $pgName --label reelpass.disposable=true --tmpfs /var/lib/postgresql/data -p 127.0.0.1::5432 -e "POSTGRES_DB=$dbName" -e 'POSTGRES_PASSWORD=disposable-test-only' postgres:16-alpine -c max_connections=220 | Out-Null
  $started += $pgName
  Invoke-CheckedDocker run --pull=never --rm -d --name $redisName --label reelpass.disposable=true --tmpfs /data -p 127.0.0.1::6379 redis:7-alpine | Out-Null
  $started += $redisName
  $pgPort = (Invoke-CheckedDocker port $pgName 5432/tcp).Split(':')[-1]
  $redisPort = (Invoke-CheckedDocker port $redisName 6379/tcp).Split(':')[-1]
  $env:DATABASE_URL = "postgres://postgres:disposable-test-only@127.0.0.1:$pgPort/$dbName"
  $env:REDIS_URL = "redis://127.0.0.1:$redisPort"
  $env:REELPASS_ISOLATED_TESTS = '1'
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $pgName pg_isready -h 127.0.0.1 -U postgres -d $dbName | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (!$ready) { throw 'Disposable PostgreSQL did not start.' }
  Write-Output "Running against disposable PostgreSQL and Redis ($tag)."
  if ($Upgrade) {
    $legacy = Invoke-CheckedDocker exec reelpass-postgres psql -X -At -v ON_ERROR_STOP=1 -U reelpass -d reelpass -c 'SELECT name FROM schema_migrations ORDER BY name'
    if (($legacy -join ',') -ne '001_init.sql,002_flutterwave_payments.sql') {
      throw 'Expected the local source database at migrations 001 and 002.'
    }
    $schema = Invoke-CheckedDocker exec reelpass-postgres pg_dump -U reelpass -d reelpass --schema=public --schema-only --no-owner --no-privileges --lock-wait-timeout=5s
    # A fresh PostgreSQL database already contains the public schema.
    (($schema | Where-Object { $_ -cne 'CREATE SCHEMA public;' }) -join [Environment]::NewLine) | & docker exec -i $pgName psql -X -q -v ON_ERROR_STOP=1 -U postgres -d $dbName
    if ($LASTEXITCODE -ne 0) { throw 'Restoring the schema into the disposable database failed.' }
    npm.cmd run test:upgrade --workspace=@matinee/api
  } elseif ($Load) {
    $env:REELPASS_LOAD_TEST = '1'
    $env:REELPASS_K6_EXE = if ($K6Executable) { (Resolve-Path -LiteralPath $K6Executable).Path }
      else { (Get-Command k6 -CommandType Application -ErrorAction Stop).Source }
    npm.cmd run test:load --workspace=@matinee/api
  } else {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Building the release entry points failed.' }
    npm.cmd run test:pg --workspace=@matinee/api
  }
  if ($LASTEXITCODE -ne 0) { throw 'Disposable test run failed.' }
} finally {
  foreach ($container in $started) {
    & docker rm -f $container | Out-Null
  }
}
