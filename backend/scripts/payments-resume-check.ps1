$ErrorActionPreference = "Stop"
$base = "http://localhost:3105"
$script:pass = 0
$script:fail = 0

function Check($name, $condition) {
  if ($condition) { $script:pass++; Write-Output "PASS  $name" }
  else { $script:fail++; Write-Output "FAIL  $name" }
}

Write-Output "== Starting server on :3105 (demo payments mode) =="
$env:PORT = "3105"
$env:PAYSTACK_SECRET_KEY = ""
$dotEnvPath = Join-Path (Get-Location) ".env"
$dotEnvBak = Join-Path $env:TEMP "mitex-resume-.env.bak"
if (Test-Path $dotEnvPath) { Move-Item $dotEnvPath $dotEnvBak -Force }
$out = Join-Path $env:TEMP "mitex-resume-out.log"
$errLog = Join-Path $env:TEMP "mitex-resume-err.log"
$p = Start-Process node -ArgumentList "server.js" -WorkingDirectory (Get-Location) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $errLog

try {
  $h = $null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 700
    try { $h = Invoke-RestMethod "$base/api/health" -TimeoutSec 2; if ($h.status -eq "ok") { break } } catch {}
  }
  Check "health ok" ($h -and $h.status -eq "ok")

  # Register a fresh customer
  $email = "resume-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@mitex.store"
  $regBody = @{ name = "Resume Tester"; email = $email; password = "ResumePass123"; dob = "1995-06-15" } | ConvertTo-Json
  $reg = Invoke-RestMethod "$base/api/auth/register" -Method Post -ContentType "application/json" -Body $regBody
  Check "customer registered" ($reg.devToken -or $reg.devOtp)

  # Verify the account (checkout now requires a verified email).
  if ($reg.devToken) {
    try { Invoke-RestMethod "$base/api/auth/verify-email?token=$($reg.devToken)" | Out-Null } catch {}
  } elseif ($reg.devOtp) {
    try { Invoke-RestMethod "$base/api/auth/verify-otp" -Method Post -ContentType "application/json" -Body (@{ email = $email; otp = $reg.devOtp } | ConvertTo-Json) | Out-Null } catch {}
  }
  $login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = $email; password = "ResumePass123" } | ConvertTo-Json)
  Check "customer login" ([bool]$login.accessToken)
  $headers = @{ Authorization = "Bearer $($login.accessToken)"; "Content-Type" = "application/json" }

  # Create a package order (pending)
  $co = Invoke-RestMethod "$base/api/payments/package-checkout" -Method Post -Headers $headers -Body (@{ packageKey = "standard" } | ConvertTo-Json)
  Check "package checkout init" ([bool]$co.reference -and $co.authorization_url -match "checkout-demo")
  $ref = $co.reference

  # Resume the pending package order - must rotate to a NEW reference (Paystack rejects reusing one)
  $r1 = Invoke-RestMethod "$base/api/payments/resume/$ref" -Method Post -Headers $headers
  Check "resume pending package order (new reference)" ($r1.reference -and $r1.reference -ne $ref -and $r1.authorization_url -match "checkout-demo")
  $ref2 = $r1.reference

  # Pay it via demo using the rotated reference
  $dp = Invoke-RestMethod "$base/api/payments/demo-pay/$ref2" -Method Post -Headers $headers
  Check "demo-pay after resume" ($dp.status -eq "paid")

  # Resume should now 409 (already paid)
  try {
    Invoke-RestMethod "$base/api/payments/resume/$ref2" -Method Post -Headers $headers | Out-Null
    Check "resume paid order blocked" $false
  } catch {
    Check "resume paid order blocked (409)" ([int]$_.Exception.Response.StatusCode -eq 409)
  }

  # New full-checkout order for a listing, then force-fail it (markFailed path is internal; simulate by admin? skip) --
  # Instead verify 403 for cross-user resume.
  $login2 = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -Body (@{ email = "admin@mitex.store"; password = "ChangeMe123!" } | ConvertTo-Json)
  $adminHeaders = @{ Authorization = "Bearer $($login2.accessToken)"; "Content-Type" = "application/json" }
  try {
    Invoke-RestMethod "$base/api/payments/resume/$ref2" -Method Post -Headers $adminHeaders | Out-Null
    Check "cross-user resume blocked" $false
  } catch {
    Check "cross-user resume blocked (403)" ([int]$_.Exception.Response.StatusCode -eq 403)
  }

  # Unknown reference 404
  try {
    Invoke-RestMethod "$base/api/payments/resume/DOES-NOT-EXIST" -Method Post -Headers $headers | Out-Null
    Check "resume unknown order" $false
  } catch {
    Check "resume unknown order (404)" ([int]$_.Exception.Response.StatusCode -eq 404)
  }

  Write-Output ("RESULT: {0} passed, {1} failed" -f $script:pass, $script:fail)
  if ($script:fail -gt 0) { exit 1 }
} finally {
  if ($p -and !$p.HasExited) { Stop-Process -Id $p.Id -Force }
  Remove-Item Env:\PORT -ErrorAction SilentlyContinue
  Remove-Item Env:\PAYSTACK_SECRET_KEY -ErrorAction SilentlyContinue
  if (Test-Path $dotEnvBak) { Move-Item $dotEnvBak $dotEnvPath -Force }
}