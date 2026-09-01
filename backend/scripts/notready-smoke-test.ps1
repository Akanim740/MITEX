$ErrorActionPreference = "Stop"
$base = "http://localhost:3103"
$script:pass = 0
$script:fail = 0

function Check($name, $condition) {
  if ($condition) { $script:pass++; Write-Output "PASS  $name" }
  else { $script:fail++; Write-Output "FAIL  $name" }
}

function StatusOf($err) {
  if ($err.Exception.Response) { return [int]$err.Exception.Response.StatusCode } else { return -1 }
}

function BodyOf($err) {
  try {
    if ($err.ErrorDetails -and $err.ErrorDetails.Message) { return $err.ErrorDetails.Message }
    $stream = $err.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } catch { return "" }
}

Write-Output "== Seeding =="
node scripts/seed.js
if ($LASTEXITCODE -ne 0) { Write-Output "Seed failed"; exit 1 }

Write-Output "`n== Starting server on :3103 (demo payments mode) =="
$env:PORT = "3103"
$env:PAYSTACK_SECRET_KEY = ""
$dotEnvPath = Join-Path (Get-Location) ".env"
$dotEnvBak = Join-Path $env:TEMP "mitex-notready.env.bak"
if (Test-Path $dotEnvPath) { Move-Item $dotEnvPath $dotEnvBak -Force }
$out = Join-Path $env:TEMP "mitex-notready-out.log"
$errLog = Join-Path $env:TEMP "mitex-notready-err.log"
$p = Start-Process node -ArgumentList "server.js" -WorkingDirectory (Get-Location) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $errLog

try {
  $ready = $false
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 700
    try {
      $h = Invoke-RestMethod "$base/api/health" -TimeoutSec 2
      $ready = ($h.status -eq "ok")
      break
    } catch {}
  }
  Check "health endpoint ok" $ready
  if (-not $ready) {
    Write-Output "--- server stdout ---"; Get-Content $out -ErrorAction SilentlyContinue
    Write-Output "--- server stderr ---"; Get-Content $errLog -ErrorAction SilentlyContinue
    exit 1
  }

  $stamp = [int](Get-Date -UFormat %s)

  # ---- Buyer ----
  $buyerEmail = "nrbuyer$stamp@example.com"
  $reg = Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType application/json -Body (@{ name = "NotReady Buyer"; email = $buyerEmail; password = "Passw0rd123"; dob = "1993-02-20" } | ConvertTo-Json)
  Invoke-RestMethod "$base/api/auth/verify-email?token=$($reg.devToken)" | Out-Null
  $buyerLogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = $buyerEmail; password = "Passw0rd123" } | ConvertTo-Json)
  $buyerHdr = @{ Authorization = "Bearer $($buyerLogin.accessToken)" }

  # ---- Worker (customer account promoted to staff directly in sqlite) ----
  $workerEmail = "nrworker$stamp@example.com"
  $wreg = Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType application/json -Body (@{ name = "NotReady Worker"; email = $workerEmail; password = "Passw0rd123"; dob = "1992-01-15" } | ConvertTo-Json)
  Invoke-RestMethod "$base/api/auth/verify-email?token=$($wreg.devToken)" | Out-Null
  $env:PROMOTE_EMAIL = $workerEmail
  $promoteJs = Join-Path $env:TEMP "mitex-promote-staff.js"
  @"
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.cwd(), 'data', 'mitex.db'));
const email = process.env.PROMOTE_EMAIL;
db.exec("UPDATE users SET role='staff', active=1 WHERE email='" + email + "'");
"@ | Set-Content -Path $promoteJs -Encoding ASCII
  & node $promoteJs
  Remove-Item Env:\PROMOTE_EMAIL
  if ($LASTEXITCODE -ne 0) { Write-Output "worker promote failed"; exit 1 }

  $workerLogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = $workerEmail; password = "Passw0rd123" } | ConvertTo-Json)
  $workerHdr = @{ Authorization = "Bearer $($workerLogin.accessToken)" }
  $workerId = $workerLogin.user.id
  Check "worker promoted to staff role" ($workerLogin.user.role -eq "staff")
  Check "worker id captured" ($workerId -ne $null)

  # ---- Admin ----
  $adminLogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = "admin@mitex.store"; password = "ChangeMe123!" } | ConvertTo-Json)
  $adminHdr = @{ Authorization = "Bearer $($adminLogin.accessToken)" }

  # ---- Admin creates listing WITHOUT delivery link, assigned to worker ----
  $newListing = Invoke-RestMethod -Method Post -Uri "$base/api/listings" -ContentType application/json -Headers $adminHdr -Body (@{ title = "NotReady Store $stamp"; description = "Site under construction, no delivery link yet."; price = 125000; level = 3; tech_stack = "Node.js, HTML" } | ConvertTo-Json)
  $lid = $newListing.listing.id
  Check "listing created without delivery link" ($lid -ne $null)
  Invoke-RestMethod -Method Put -Uri "$base/api/listings/$lid" -ContentType application/json -Headers $adminHdr -Body (@{ employeeId = $workerId } | ConvertTo-Json) | Out-Null

  # ---- Payment must be HARD-BLOCKED ----
  $blockedInit = $false
  $initCode = ""
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/payments/initialize" -ContentType application/json -Headers $buyerHdr -Body (@{ listingId = $lid } | ConvertTo-Json) | Out-Null
  } catch {
    $blockedInit = (StatusOf $_) -eq 409
    $parsed = BodyOf $_ | ConvertFrom-Json
    $initCode = $parsed.code
  }
  Check "initialize blocked (409) without delivery link" $blockedInit
  Check "initialize returns DELIVERY_NOT_READY code" ($initCode -eq "DELIVERY_NOT_READY")

  $blockedTap = $false
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/payments/one-tap" -ContentType application/json -Headers $buyerHdr -Body (@{ listingId = $lid } | ConvertTo-Json) | Out-Null
  } catch { $blockedTap = (StatusOf $_) -eq 409 }
  Check "one-tap blocked (409) without delivery link" $blockedTap

  # ---- Buyer intent ----
  $intent = Invoke-RestMethod -Method Post -Uri "$base/api/payments/buy-intent" -ContentType application/json -Headers $buyerHdr -Body (@{ listingId = $lid } | ConvertTo-Json)
  Check "buy-intent accepted (201)" ($intent.deliveryReady -eq $false)
  $intent2 = $null
  try {
    $intent2 = Invoke-RestMethod -Method Post -Uri "$base/api/payments/buy-intent" -ContentType application/json -Headers $buyerHdr -Body (@{ listingId = $lid } | ConvertTo-Json)
  } catch {}
  Check "buy-intent dedupes (no 500 on repeat)" ($intent2 -ne $null -and $intent2.deliveryReady -eq $false)

  # Buyer must NOT be notified yet (nothing ready)
  $buyerNotifs = Invoke-RestMethod -Uri "$base/api/notifications" -Headers $buyerHdr
  Check "no ready-notification before delivery link" (@($buyerNotifs.notifications).Count -eq 0)

  # ---- Worker gets buyer_waiting notification ----
  $waitingSeen = $false
  for ($i = 0; $i -lt 10; $i++) {
    $wn = Invoke-RestMethod -Uri "$base/api/notifications" -Headers $workerHdr
    if (@($wn.notifications | Where-Object { $_.type -eq "buyer_waiting" }).Count -gt 0) { $waitingSeen = $true; break }
    Start-Sleep -Milliseconds 400
  }
  Check "worker notified of buyer waiting" $waitingSeen

  # ---- Worker sets delivery link -> buyer notified + ready to pay ----
  $pubList = Invoke-RestMethod -Uri "$base/api/listings"
  $cold = $pubList | Where-Object { "$($_.id)" -eq "$lid" }
  Check "public listing exposes deliveryReady=false" ($cold.deliveryReady -eq $false)

  Invoke-RestMethod -Method Put -Uri "$base/api/listings/$lid" -ContentType application/json -Headers $workerHdr -Body (@{ deliveryUrl = "https://example.com/mitex-site.zip" } | ConvertTo-Json) | Out-Null

  $readySeen = $false
  for ($i = 0; $i -lt 10; $i++) {
    $bn = Invoke-RestMethod -Uri "$base/api/notifications" -Headers $buyerHdr
    if (@($bn.notifications | Where-Object { $_.type -eq "listing_ready" }).Count -gt 0) { $readySeen = $true; break }
    Start-Sleep -Milliseconds 400
  }
  Check "buyer notified when delivery link is set" $readySeen

  # ---- After delivery link, checkout succeeds again ----
  $init = Invoke-RestMethod -Method Post -Uri "$base/api/payments/initialize" -ContentType application/json -Headers $buyerHdr -Body (@{ listingId = $lid } | ConvertTo-Json)
  Check "checkout re-opened after delivery link (demo)" ($init.demo -eq $true -and $init.reference -like "MITEX-*")

  # ================================================================
  # SOLD → AVAILABLE transition: worker saves delivery link
  # ================================================================
  $soldL = Invoke-RestMethod -Method Post -Uri "$base/api/listings" -ContentType application/json -Headers $adminHdr -Body (@{ title = "SoldThenReady $stamp"; description = "A listing that starts sold, then becomes available when worker delivers."; price = 200000; level = 2; tech_stack = "HTML, CSS" } | ConvertTo-Json)
  $soldLid = $soldL.listing.id
  Invoke-RestMethod -Method Put -Uri "$base/api/listings/$soldLid" -ContentType application/json -Headers $adminHdr -Body (@{ employeeId = $workerId; status = "sold" } | ConvertTo-Json) | Out-Null
  $beforePub = (Invoke-RestMethod -Uri "$base/api/listings") | Where-Object { "$($_.id)" -eq "$soldLid" }
  Check "sold listing hidden from public marketplace" ($beforePub -eq $null)

  # Worker saves delivery link → should flip sold → available
  $afterWorker = Invoke-RestMethod -Method Put -Uri "$base/api/listings/$soldLid" -ContentType application/json -Headers $workerHdr -Body (@{ deliveryUrl = "https://example.com/sold-then-ready.zip" } | ConvertTo-Json)
  Check "worker delivery link flips status to available" ($afterWorker.listing.status -eq "available")

  $afterPub = (Invoke-RestMethod -Uri "$base/api/listings") | Where-Object { "$($_.id)" -eq "$soldLid" }
  Check "listing now visible on public marketplace" ($afterPub -ne $null)
  Check "public listing shows deliveryReady=true" ($afterPub.deliveryReady -eq $true)

  Write-Output "`n== Results: $($script:pass) passed, $($script:fail) failed =="
  if ($script:fail -gt 0) { exit 1 }
} finally {
  if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  if (Test-Path $dotEnvBak) { Move-Item $dotEnvBak $dotEnvPath -Force }
  Remove-Item Env:\PORT -ErrorAction SilentlyContinue
  Remove-Item Env:\PAYSTACK_SECRET_KEY -ErrorAction SilentlyContinue
}