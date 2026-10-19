<#
.SYNOPSIS
  Runs the ReelPass 500-VU seat-contention load test using the official k6 image.

.DESCRIPTION
  k6 is run via grafana/k6 in Docker, mounting ./load-tests into the container.
  It targets a running ReelPass API (PostgreSQL mode) and asserts the booking
  engine never double-books a seat under concurrent contention.

  Prerequisites:
    * Docker Desktop running.
    * reelpass-postgres and reelpass-redis containers healthy.
    * The API booted in postgres mode (npm run dev:api) and healthy.
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
$sqlEvidencePath = Join-Path $loadTests 'sql-verification.json'

function Assert-ApiHealthy {
  try {
    $resp = Invoke-WebRequest -Uri "$HealthBaseUrl/health" -UseBasicParsing -TimeoutSec 5
    $health = $resp.Content | ConvertFrom-Json
    Write-Host "[ok] API healthy at $HealthBaseUrl."
    Write-Host "     Database: $($health.services.database)"
    Write-Host "     Cache   : $($health.services.cache)"
    if ($health.services.database -notlike '*PostgreSQL*') {
      throw "API is not in PostgreSQL mode (currently: $($health.services.database)). Start with DATA_MODE=postgres."
    }
  } catch {
    throw "API not reachable or healthy at $HealthBaseUrl/health: $($_.Exception.Message)"
  }
}

function Reset-Showtime {
  Write-Host ""
  Write-Host "[reset] Clearing bookings and re-opening seats on showtime '$ShowtimeId' (isolated local test)..."
  $sql = @"
DELETE FROM bookings WHERE showtime_id = '$ShowtimeId';
DELETE FROM users WHERE email LIKE 'loadtest-%';
UPDATE showtime_seats
   SET status = 'AVAILABLE', held_by_user_id = NULL, hold_expires_at = NULL, updated_at = NOW()
 WHERE showtime_id = '$ShowtimeId';
"@
  $sql | docker exec -i reelpass-postgres psql -U reelpass -d reelpass -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "[reset] psql failed (exit $LASTEXITCODE)." }

  # Clear Redis hold keys for this showtime
  docker exec -i reelpass-redis redis-cli eval "local keys = redis.call('keys', 'reelpass:hold:' .. ARGV[1] .. ':*') for i=1,#keys do redis.call('del', keys[i]) end return #keys" 0 $ShowtimeId | Out-Null
  Write-Host "[reset] Done. Database and Redis clean for showtime '$ShowtimeId'."
}

function Verify-DatabaseState {
  Write-Host ""
  Write-Host "================== PostgreSQL Database Verification =================="

  # 1. Check for any double-booked seats in booking_seats
  $dupSeatsSql = "SELECT seat_id, COUNT(*) as cnt FROM booking_seats WHERE showtime_id = '$ShowtimeId' GROUP BY seat_id HAVING COUNT(*) > 1;"
  $dupSeatsRaw = $dupSeatsSql | docker exec -i reelpass-postgres psql -U reelpass -d reelpass -t -A
  $dupSeats = @($dupSeatsRaw | Where-Object { $_ -match '\S' })
  $dupCount = $dupSeats.Count

  # 2. Check for any duplicate tickets
  $dupTicketsSql = "SELECT seat_id, COUNT(*) as cnt FROM tickets WHERE showtime_id = '$ShowtimeId' GROUP BY seat_id HAVING COUNT(*) > 1;"
  $dupTicketsRaw = $dupTicketsSql | docker exec -i reelpass-postgres psql -U reelpass -d reelpass -t -A
  $dupTickets = @($dupTicketsRaw | Where-Object { $_ -match '\S' })
  $dupTicketCount = $dupTickets.Count

  # 3. Total bookings created for load test users
  $totalBookingsSql = "SELECT COUNT(*) FROM bookings WHERE showtime_id = '$ShowtimeId' AND user_id IN (SELECT id FROM users WHERE email LIKE 'loadtest-%');"
  $totalBookings = [int](($totalBookingsSql | docker exec -i reelpass-postgres psql -U reelpass -d reelpass -t -A).Trim())

  # 4. Total seats marked HELD
  $heldSeatsSql = "SELECT COUNT(*) FROM showtime_seats WHERE showtime_id = '$ShowtimeId' AND status = 'HELD';"
  $heldSeats = [int](($heldSeatsSql | docker exec -i reelpass-postgres psql -U reelpass -d reelpass -t -A).Trim())

  Write-Host "Contested seat pool size              : $PoolSize"
  Write-Host "Total bookings created in PostgreSQL  : $totalBookings"
  Write-Host "Total seats marked HELD in PostgreSQL : $heldSeats"
  Write-Host "Double-booked seats (count > 1)       : $dupCount"
  Write-Host "Duplicate tickets (count > 1)         : $dupTicketCount"

  $zeroDoubleBookings = ($dupCount -eq 0 -and $dupTicketCount -eq 0)

  $verification = @{
    showtimeId = $ShowtimeId
    poolSize = $PoolSize
    totalBookings = $totalBookings
    heldSeats = $heldSeats
    duplicateSeats = $dupCount
    duplicateTickets = $dupTicketCount
    zeroDoubleBookings = $zeroDoubleBookings
    passed = ($zeroDoubleBookings -and $totalBookings -le $PoolSize -and $totalBookings -gt 0)
    timestamp = (Get-Date).ToString("o")
  }

  $verificationJson = $verification | ConvertTo-Json -Depth 4
  $verificationJson | Set-Content $sqlEvidencePath -Force

  if ($zeroDoubleBookings) {
    Write-Host "[VERIFIED] ZERO DOUBLE-BOOKINGS confirmed in PostgreSQL database queries."
  } else {
    Write-Host "[FAILED] DOUBLE-BOOKING DETECTED in PostgreSQL database!"
  }
  Write-Host "========================================================================"
}

Assert-ApiHealthy
if ($Reset) { Reset-Showtime }

if (Test-Path $hostSummary) { Remove-Item $hostSummary -Force }
if (Test-Path $sqlEvidencePath) { Remove-Item $sqlEvidencePath -Force }

Write-Host ""
Write-Host "[run] Starting k6 seat-contention test: VUs=$Vus Duration=$Duration Pool=$PoolSize Users=$NumUsers"
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
  Get-Content $hostSummary -Raw
} else {
  Write-Warning "[run] No summary produced - the k6 run may have failed."
}

Verify-DatabaseState
