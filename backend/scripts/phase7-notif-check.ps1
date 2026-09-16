$ErrorActionPreference = "Stop"
$base = "http://localhost:3106"
$script:pass = 0
$script:fail = 0

function Check($name, $condition) {
  if ($condition) { $script:pass++; Write-Output "PASS  $name" }
  else { $script:fail++; Write-Output "FAIL  $name" }
}

Write-Output "== Starting server on :3106 (demo payments mode) =="
$env:PORT = "3106"
$env:PAYSTACK_SECRET_KEY = ""
$dotEnvPath = Join-Path (Get-Location) ".env"
$dotEnvBak = Join-Path $env:TEMP "mitex-notif-.env.bak"
if (Test-Path $dotEnvPath) { Move-Item $dotEnvPath $dotEnvBak -Force }
$out = Join-Path $env:TEMP "mitex-notif-out.log"
$errLog = Join-Path $env:TEMP "mitex-notif-err.log"
$p = Start-Process node -ArgumentList "server.js" -WorkingDirectory (Get-Location) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $errLog

try {
  $h = $null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 700
    try { $h = Invoke-RestMethod "$base/api/health" -TimeoutSec 2; if ($h.status -eq "ok") { break } } catch {}
  }
  Check "health ok" ($h -and $h.status -eq "ok")

  # Fresh buyer
  $email = "notif-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@mitex.store"
  $reg = Invoke-RestMethod "$base/api/auth/register" -Method Post -ContentType "application/json" -Body (@{ name = "Notif Buyer"; email = $email; password = "NotifPass123"; dob = "1995-06-15" } | ConvertTo-Json)
  Check "buyer registered" ($reg.devToken -or $reg.devOtp)
  if ($reg.devOtp) {
    try { Invoke-RestMethod "$base/api/auth/verify-otp" -Method Post -ContentType "application/json" -Body (@{ email = $email; code = $reg.devOtp } | ConvertTo-Json) | Out-Null } catch {}
  }
  $cl = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $email; password = "NotifPass123" } | ConvertTo-Json)
  $custHdr = @{ Authorization = "Bearer $($cl.accessToken)"; "Content-Type" = "application/json" }

  # Admin login
  $al = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "admin@mitex.store"; password = "ChangeMe123!" } | ConvertTo-Json)
  $adminHdr = @{ Authorization = "Bearer $($al.accessToken)"; "Content-Type" = "application/json" }

  # Buy a standard package in demo mode
  $co = Invoke-RestMethod "$base/api/payments/package-checkout" -Method Post -Headers $custHdr -Body (@{ packageKey = "standard" } | ConvertTo-Json)
  Check "package checkout init" ([bool]$co.reference -and $co.authorization_url -match "checkout-demo")
  $ref = $co.reference

  $dp = Invoke-RestMethod "$base/api/payments/demo-pay/$ref" -Method Post -Headers $custHdr
  Check "demo payment settles" ($dp.status -eq "paid")

  # Admin notification for the new sale (non-blocking, so poll briefly)
  Start-Sleep -Milliseconds 1200
  $adminNotifs = (Invoke-RestMethod "$base/api/notifications?limit=20" -Headers $adminHdr).notifications
  Check "admin got new_order notification" (($adminNotifs | Where-Object { $_.type -eq "new_order" }).Count -ge 1)
  $adminUnread = (Invoke-RestMethod "$base/api/notifications?limit=1" -Headers $adminHdr).unread
  Check "admin unread count > 0" ($adminUnread -ge 1)

  # Mark admin notifications read
  $markRes = Invoke-RestMethod "$base/api/notifications/read" -Method Post -Headers $adminHdr
  Check "mark all read ok" ($markRes.ok -eq $true)
  Start-Sleep -Milliseconds 200
  $adminUnread2 = (Invoke-RestMethod "$base/api/notifications?limit=1" -Headers $adminHdr).unread
  Check "admin unread reset to 0" ($adminUnread2 -eq 0)

  # Advance fulfillment -> buyer gets progress notification
  Invoke-RestMethod "$base/api/payments/orders/$ref/fulfillment" -Method Patch -Headers $adminHdr -Body (@{ fulfillmentStatus = "in_progress" } | ConvertTo-Json) | Out-Null
  Start-Sleep -Milliseconds 1200
  $buyerNotifs = (Invoke-RestMethod "$base/api/notifications?limit=20" -Headers $custHdr).notifications
  Check "buyer got order_progress notification" (@($buyerNotifs | Where-Object { $_.type -eq "order_progress" }).Count -ge 1)

  # Order search ?q= filters
  $qRes = Invoke-RestMethod "$base/api/payments/orders?q=$([uri]::EscapeDataString($email))" -Headers $adminHdr
  Check "order search by email" (@($qRes | Where-Object { $_.email -eq $email }).Count -eq 1)

  # Status filter ?status=paid only returns paid
  $paidRes = Invoke-RestMethod "$base/api/payments/orders?status=paid" -Headers $adminHdr
  Check "status filter paid" (($paidRes | Where-Object { $_.status -ne "paid" }).Count -eq 0)

  # CSV export includes our order
  $csvResp = Invoke-WebRequest "$base/api/payments/orders/export?status=paid" -Headers $adminHdr -TimeoutSec 30
  $csv = $csvResp.Content
  Check "csv has header row" ($csv -match "^reference,title,buyer_email")
  Check "csv includes the new order" ($csv -match $ref)

  Write-Output ("RESULT: {0} passed, {1} failed" -f $script:pass, $script:fail)
  if ($script:fail -gt 0) { exit 1 }
} finally {
  if ($p -and !$p.HasExited) { Stop-Process -Id $p.Id -Force }
  Remove-Item Env:\PORT -ErrorAction SilentlyContinue
  Remove-Item Env:\PAYSTACK_SECRET_KEY -ErrorAction SilentlyContinue
  if (Test-Path $dotEnvBak) { Move-Item $dotEnvBak $dotEnvPath -Force }
}