$ErrorActionPreference = "Stop"
$base = "http://localhost:3102"
$script:pass = 0
$script:fail = 0

function Check($name, $condition) {
  if ($condition) {
    $script:pass++
    Write-Output "PASS  $name"
  } else {
    $script:fail++
    Write-Output "FAIL  $name"
  }
}

function StatusOf($err) {
  if ($err.Exception.Response) { return [int]$err.Exception.Response.StatusCode } else { return -1 }
}

Write-Output "== Seeding =="
node scripts/seed.js
if ($LASTEXITCODE -ne 0) { Write-Output "Seed failed"; exit 1 }

Write-Output "`n== Starting server on :3102 (demo payments mode) =="
$env:PORT = "3102"
$env:PAYSTACK_SECRET_KEY = ""
$dotEnvPath = Join-Path (Get-Location) ".env"
$dotEnvBak = Join-Path $env:TEMP "mitex-pay-.env.bak"
if (Test-Path $dotEnvPath) { Move-Item $dotEnvPath $dotEnvBak -Force }
$out = Join-Path $env:TEMP "mitex-pay-out.log"
$errLog = Join-Path $env:TEMP "mitex-pay-err.log"
$p = Start-Process node -ArgumentList "server.js" -WorkingDirectory (Get-Location) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $errLog

try {
  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
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

  # ---- Buyer + admin accounts ----
  $email = "paybuyer$([int](Get-Date -UFormat %s))@example.com"
  $reg = Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType application/json -Body (@{ name = "Pay Buyer"; email = $email; password = "Passw0rd123"; dob = "1993-02-20" } | ConvertTo-Json)
  Invoke-RestMethod "$base/api/auth/verify-email?token=$($reg.devToken)" | Out-Null

  $custLogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = $email; password = "Passw0rd123" } | ConvertTo-Json)
  $custHdr = @{ Authorization = "Bearer $($custLogin.accessToken)" }

  $adminLogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = "admin@mitex.store"; password = "ChangeMe123!" } | ConvertTo-Json)
  $adminHdr = @{ Authorization = "Bearer $($adminLogin.accessToken)" }

  # ---- Admin creates a listing for sale ----
  $newListing = Invoke-RestMethod -Method Post -Uri "$base/api/listings" -ContentType application/json -Headers $adminHdr -Body (@{ title = "PayTest Store"; description = "E-commerce site for payment testing."; price = 150000; level = 4; tech_stack = "Node.js, Payments" } | ConvertTo-Json)
  $lid = $newListing.listing.id
  Check "test listing created" ($lid -ne $null)

  # ---- Checkout requires auth ----
  $unauth = $false
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/payments/initialize" -ContentType application/json -Body (@{ listingId = $lid } | ConvertTo-Json) | Out-Null
  } catch { $unauth = (StatusOf $_) -eq 401 }
  Check "initialize requires login (401)" $unauth

  # ---- Initialize demo checkout ----
  $init = Invoke-RestMethod -Method Post -Uri "$base/api/payments/initialize" -ContentType application/json -Headers $custHdr -Body (@{ listingId = $lid } | ConvertTo-Json)
  Check "checkout initialized in demo mode" ($init.demo -eq $true -and $init.reference -like "MITEX-*")
  Check "demo authorization_url points to checkout-demo page" ($init.authorization_url -like "*checkout-demo.html*")
  $ref = $init.reference

  # duplicate initialize on same listing is allowed but second pay attempt settles once;
  # verify order exists as pending first
  $mine = Invoke-RestMethod "$base/api/payments/orders/mine" -Headers $custHdr
  Check "order appears in my orders as pending" (($mine | Where-Object { $_.reference -eq $ref }).status -eq "pending")

  # ---- Demo pay guards ----
  $wrongUser = $false
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/payments/demo-pay/$ref" -Headers $adminHdr | Out-Null
  } catch { $wrongUser = (StatusOf $_) -eq 403 }
  Check "demo-pay blocked for non-owner (403)" $wrongUser

  # ---- Pay the demo order ----
  $paid = Invoke-RestMethod -Method Post -Uri "$base/api/payments/demo-pay/$ref" -Headers $custHdr
  Check "demo payment succeeds" ($paid.status -eq "paid")

  # ---- Listing marked sold after payment ----
  $listingAfter = Invoke-RestMethod "$base/api/listings?includeSold=true"
  $soldRow = $listingAfter | Where-Object { $_.id -eq $lid }
  Check "listing marked sold after payment" ($soldRow.status -eq "sold")
  Check "sold listing hidden from public marketplace" ((Invoke-RestMethod "$base/api/listings") | Where-Object { $_.id -eq $lid } -eq $null)

  # ---- Second purchase of sold listing rejected ----
  $soldBlock = $false
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/payments/initialize" -ContentType application/json -Headers $adminHdr -Body (@{ listingId = $lid } | ConvertTo-Json) | Out-Null
  } catch { $soldBlock = (StatusOf $_) -eq 409 }
  Check "buying a sold listing rejected (409)" $soldBlock

  # ---- Verify endpoint reflects paid status ----
  $ver = Invoke-RestMethod "$base/api/payments/verify/$ref" -Headers $custHdr
  Check "verify returns paid status" ($ver.status -eq "paid")

  # double demo-pay is idempotent
  $again = Invoke-RestMethod -Method Post -Uri "$base/api/payments/demo-pay/$ref" -Headers $custHdr
  Check "repeat demo-pay idempotent" ($again.status -eq "paid")

  # unknown reference -> 404
  $notFound = $false
  try {
    Invoke-RestMethod "$base/api/payments/verify/MITEX-does-not-exist" -Headers $custHdr | Out-Null
  } catch { $notFound = (StatusOf $_) -eq 404 }
  Check "unknown reference rejected (404)" $notFound

  # ---- Webhook rejected without valid signature in demo mode ----
  $wh = $false
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/payments/webhook" -ContentType application/json -Body '{"event":"charge.success"}' | Out-Null
  } catch { $wh = $true }
  Check "webhook unavailable in demo mode" $wh

  # ---- My orders shows paid ----
  $mine2 = Invoke-RestMethod "$base/api/payments/orders/mine" -Headers $custHdr
  Check "my orders shows paid order" (($mine2 | Where-Object { $_.reference -eq $ref }).status -eq "paid")

  # ---- Customer blocked from full orders list ----
  $forbidden = $false
  try {
    Invoke-RestMethod "$base/api/payments/orders" -Headers $custHdr | Out-Null
  } catch { $forbidden = (StatusOf $_) -eq 403 }
  Check "customer blocked from admin orders list (403)" $forbidden

  # ---- Admin sees the order + revenue stats ----
  $allOrders = Invoke-RestMethod "$base/api/payments/orders" -Headers $adminHdr
  Check "admin can list all orders" (($allOrders | Where-Object { $_.reference -eq $ref }) -ne $null)

  $dash = Invoke-RestMethod "$base/api/auth/dashboard" -Headers $adminHdr
  Check "dashboard stats include orders + revenue" ($dash.orders.paid -ge 1 -and $dash.orders.revenue -ge 150000)

} finally {
  if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  if (Test-Path $dotEnvBak) { Move-Item $dotEnvBak $dotEnvPath -Force }
}

Write-Output ""
Write-Output "RESULT: $($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) {
  Write-Output "--- server stdout ---"; Get-Content $out -ErrorAction SilentlyContinue
  Write-Output "--- server stderr ---"; Get-Content $errLog -ErrorAction SilentlyContinue
  exit 1
}
