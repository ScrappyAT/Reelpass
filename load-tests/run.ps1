<#
.SYNOPSIS
  Runs the ReelPass 500-VU seat-contention load test using the official k6 image.

.DESCRIPTION
  k6 is not assumed to be installed locally. This runner pulls and runs
  grafana/k6 in Docker, mounting ./load-tests into the container. It targets a
  running ReelPass API (PostgreSQL mode) and asserts the booking engine never
  double-books a seat under concurrent contention.

  Prerequisites:
    * Docker Desktop running.
    * The API booted in postgres mode (npm run dev:api) and healthy.

.PARAMETER BaseUrl
  API base URL. Default http://host.docker.internal:4000/api/v1 (Docker Desktop
  resolves host.docker.internal to the host machine).

.PARAMETER ShowtimeId
  Showtime to contend over. Default st-1.

.PARAMETER Vus
  Concurrent virtual users. Default 500.

.PARAMETER Duration
  Test duration. Default 20s.

.PARAMETER PoolSize
  Number of distinct seats the VUs race for. Default 40.

.PARAMETER NumUsers
  Distinct users registered for the run (exercises Redis exclusivity). Default 50.

.PARAMETER Reset
  Destructive, LOCAL-ONLY. Before running, clears bookings and re-opens the
  target showtime's seats so the run starts from a clean slate. Never point this
  at a production database.
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://host.docker.internal:4000/api/v1',
  [string]$HealthBaseUrl = 'http://localhost:4000/api/v1',
  [string]$ShowtimeId = 'st-1',
  [int]$Vus = 500,
  [string]$Duration = '20s',
  [int]$PoolSize = 40,
  [int]$NumUsers = 50,
  [switch]$Reset
)

$ErrorActionPreference = 'Stop'
$loadTests = $PSScriptRoot
$summaryPath = '/scripts/summary.json'
$hostSummary = Join-Path $loadTests 'summary.json'

function Assert-ApiHealthy {
  try {
    $resp = Invoke-WebRequest -Uri "$HealthBaseUrl/health" -UseBasicParsing -TimeoutSec 5
    $health = $resp.Content | ConvertFrom-Json
    Write-Host "API healthy. Data mode: $($health.services.database)"
    if ($health.services.database -notlike '*PostgreSQL*') {
      Write-Warning "API is not in PostgreSQL mode. Boot it with DATA_MODE=postgres for a meaningful run."
    }
  } catch {
    throw "API not reachable at $HealthBaseUrl/health. Start it with: npm run dev:api  ($($_.Exception.Message))"
  }
}

function Reset-Showtime {
  Write-Host ""
  Write-Host "[reset] Clearing bookings and re-opening seats on showtime '$ShowtimeId' (local demo only)..."
  $sql = @"
DELETE FROM bookings WHERE showtime_id = '$ShowtimeId';
DELETE FROM users WHERE email LIKE 'loadtest-%';
UPDATE showtime_seats
   SET status = 'AVAILABLE', held_by_user_id = NULL, hold_expires_at = NULL, updated_at = NOW()
 WHERE showtime_id = '$ShowtimeId';
"@
  $sql | docker exec -i reelpass-postgres psql -U reelpass -d reelpass -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "[reset] psql failed (exit $LASTEXITCODE)." }
  Write-Host "[reset] Done."
}

Assert-ApiHealthy
if ($Reset) { Reset-Showtime }

if (Test-Path $hostSummary) { Remove-Item $hostSummary -Force }

Write-Host ""
Write-Host "[run] Starting k6 seat-contention test: VUs=$Vus duration=$Duration pool=$PoolSize users=$NumUsers"
Write-Host ""

docker run --rm -i `
  -v "${loadTests}:/scripts" `
  -e "BASE_URL=$BaseUrl" `
  -e "SHOWTIME_ID=$ShowtimeId" `
  -e "VUS=$Vus" `
  -e "DURATION=$Duration" `
  -e "POOL_SIZE=$PoolSize" `
  -e "NUM_USERS=$NumUsers" `
  -e "SUMMARY_PATH=$summaryPath" `
  grafana/k6 run /scripts/seat-contention.js

if (Test-Path $hostSummary) {
  Write-Host ""
  Write-Host "[run] Summary written to $hostSummary"
  Write-Host ""
  Get-Content $hostSummary -Raw
} else {
  Write-Warning "[run] No summary produced - the k6 run may have failed."
}
