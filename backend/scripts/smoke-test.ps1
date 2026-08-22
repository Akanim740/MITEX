$ErrorActionPreference = "Stop"
$base = "http://localhost:3100"
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

Write-Output "`n== Starting server on :3100 =="
$env:PORT = "3100"
$out = Join-Path $env:TEMP "mitex-server-out.log"
$errLog = Join-Path $env:TEMP "mitex-server-err.log"
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

  # ---- Registration + email verification ----
  $email = "buyer$([int](Get-Date -UFormat %s))@example.com"
  $reg = Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType application/json -Body (@{ name = "Test Buyer"; email = $email; password = "Passw0rd123" } | ConvertTo-Json)
  Check "register returns 201 + devToken" ($reg.devToken -ne $null)

  $verify = Invoke-RestMethod "$base/api/auth/verify-email?token=$($reg.devToken)"
  Check "email verification works" ($verify.message -like "*verified*")

  # duplicate register rejected
  $dup = $false
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType application/json -Body (@{ name = "Test Buyer"; email = $email; password = "Passw0rd123" } | ConvertTo-Json) | Out-Null
  } catch { $dup = (StatusOf $_) -eq 409 }
  Check "duplicate registration rejected (409)" $dup

  # weak password rejected
  $weak = $false
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType application/json -Body (@{ name = "Weak Guy"; email = "weak@example.com"; password = "short" } | ConvertTo-Json) | Out-Null
  } catch { $weak = (StatusOf $_) -eq 400 }
  Check "weak password rejected (400)" $weak

  # ---- Customer login + role guard ----
  $custSess = $null
  $custLogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = $email; password = "Passw0rd123" } | ConvertTo-Json) -SessionVariable custSess
  Check "customer login works" ($custLogin.user.role -eq "customer")

  $me = Invoke-RestMethod "$base/api/auth/me" -Headers @{ Authorization = "Bearer $($custLogin.accessToken)" }
  Check "GET /me returns profile" ($me.email -eq $email)

  $forbidden = $false
  try {
    Invoke-RestMethod "$base/api/enquiries" -Headers @{ Authorization = "Bearer $($custLogin.accessToken)" } | Out-Null
  } catch { $forbidden = (StatusOf $_) -eq 403 }
  Check "customer blocked from enquiries (403)" $forbidden

  # ---- Profile editing ----
  $upd = Invoke-RestMethod -Method Put -Uri "$base/api/users/me" -ContentType application/json -Headers @{ Authorization = "Bearer $($custLogin.accessToken)" } -Body (@{ name = "Renamed Buyer"; phone = "+2348012345678"; bio = "I buy websites" } | ConvertTo-Json)
  Check "profile edit works" ($upd.user.name -eq "Renamed Buyer" -and $upd.user.phone -eq "+2348012345678")

  # ---- Public enquiry ----
  $enq = Invoke-RestMethod -Method Post -Uri "$base/api/enquiries" -ContentType application/json -Body (@{ name = "Ada Obi"; email = "ada@example.com"; intent = "buy"; level = 5; message = "I need an e-commerce website for my boutique." } | ConvertTo-Json)
  Check "public enquiry accepted" ($enq.id -ne $null)

  # ---- Admin login + protected routes ----
  $adminLogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = "admin@mitex.store"; password = "ChangeMe123!" } | ConvertTo-Json) -SessionVariable adminSess
  Check "admin login works" ($adminLogin.user.role -eq "admin")
  $adminHdr = @{ Authorization = "Bearer $($adminLogin.accessToken)" }

  $dash = Invoke-RestMethod "$base/api/auth/dashboard" -Headers $adminHdr
  Check "dashboard stats accessible to admin" ($dash.enquiries.total -ge 1)

  $list = Invoke-RestMethod "$base/api/enquiries" -Headers $adminHdr
  Check "admin can list enquiries" ($list.Count -ge 1)

  # ---- Listings CRUD ----
  $newListing = Invoke-RestMethod -Method Post -Uri "$base/api/listings" -ContentType application/json -Headers $adminHdr -Body (@{ title = "SmokeTest Site"; description = "A listing created by the automated smoke test."; price = 99000; level = 3 } | ConvertTo-Json)
  Check "listing created" ($newListing.listing.id -ne $null)
  $lid = $newListing.listing.id

  $pubListings = Invoke-RestMethod "$base/api/listings"
  Check "public listings include new one" (($pubListings | Where-Object { $_.id -eq $lid }) -ne $null)

  $updL = Invoke-RestMethod -Method Put -Uri "$base/api/listings/$lid" -ContentType application/json -Headers $adminHdr -Body (@{ status = "sold" } | ConvertTo-Json)
  Check "listing update works" ($updL.listing.status -eq "sold")

  $delL = Invoke-RestMethod -Method Delete -Uri "$base/api/listings/$lid" -Headers $adminHdr
  Check "listing delete works" ($delL.message -eq "Deleted")

  # ---- Refresh session rotation ----
  $refr = Invoke-RestMethod -Method Post -Uri "$base/api/auth/refresh" -WebSession $adminSess
  Check "refresh issues new access token" ($refr.accessToken -ne $null)

  # ---- Password reset flow (customer account) ----
  $forgot = Invoke-RestMethod -Method Post -Uri "$base/api/auth/forgot-password" -ContentType application/json -Body (@{ email = $email } | ConvertTo-Json)
  Check "forgot-password returns dev token" ($forgot.devToken -ne $null)

  Invoke-RestMethod -Method Post -Uri "$base/api/auth/reset-password" -ContentType application/json -Body (@{ token = $forgot.devToken; newPassword = "NewPass456" } | ConvertTo-Json) | Out-Null
  $relogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = $email; password = "NewPass456" } | ConvertTo-Json)
  Check "login with reset password works" ($relogin.user.email -eq $email)

  # old sessions revoked after reset -> refresh with stale cookie fails
  $stale = $false
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/auth/refresh" -WebSession $custSess | Out-Null
  } catch { $stale = $true }
  Check "sessions revoked after password reset" $stale

  # ---- Logout revokes session ----
  Invoke-RestMethod -Method Post -Uri "$base/api/auth/logout" -WebSession $adminSess | Out-Null
  $afterLogout = $false
  try {
    Invoke-RestMethod -Method Post -Uri "$base/api/auth/refresh" -WebSession $adminSess | Out-Null
  } catch { $afterLogout = $true }
  Check "logout invalidates refresh cookie" $afterLogout

  # ---- Users admin route ----
  $users = Invoke-RestMethod "$base/api/users" -Headers $adminHdr
  Check "admin can list users" ($users.Count -ge 2)

} finally {
  if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}

Write-Output ""
Write-Output "RESULT: $($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) {
  Write-Output "--- server stdout ---"; Get-Content $out -ErrorAction SilentlyContinue
  Write-Output "--- server stderr ---"; Get-Content $errLog -ErrorAction SilentlyContinue
  exit 1
}
