$ErrorActionPreference = "Stop"
$base = "http://localhost:3101"
$script:pass = 0
$script:fail = 0

function Check($name, $condition) {
  if ($condition) { $script:pass++; Write-Output "PASS  $name" }
  else { $script:fail++; Write-Output "FAIL  $name" }
}

$env:PORT = "3101"
$out = Join-Path $env:TEMP "mitex-ui-out.log"
$errLog = Join-Path $env:TEMP "mitex-ui-err.log"
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
  Check "server ready" $ready

  foreach ($page in @("register.html", "login.html", "reset-password.html", "account.html", "auth.css", "auth.js")) {
    try {
      $r = Invoke-WebRequest "$base/$page" -UseBasicParsing -TimeoutSec 5
      Check "$page served ($($r.StatusCode))" ($r.StatusCode -eq 200)
    } catch {
      Check "$page served" $false
    }
  }

  # Simulate exactly what the UI does
  $email = "uiuser$([int](Get-Date -UFormat %s))@example.com"
  $reg = Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType application/json -Body (@{ name = "UI Tester"; email = $email; password = "Passw0rd123"; dob = "1997-11-03" } | ConvertTo-Json)
  Check "register page flow -> account created" ($reg.devToken -ne $null)

  Invoke-RestMethod "$base/api/auth/verify-email?token=$($reg.devToken)" | Out-Null
  $login = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = $email; password = "Passw0rd123" } | ConvertTo-Json)
  Check "login page flow -> token received" ($login.accessToken -ne $null)
  $hdr = @{ Authorization = "Bearer $($login.accessToken)" }

  $me = Invoke-RestMethod "$base/api/auth/me" -Headers $hdr
  Check "account page load -> profile fetched" ($me.email -eq $email)

  $upd = Invoke-RestMethod -Method Put -Uri "$base/api/users/me" -ContentType application/json -Headers $hdr -Body (@{ name = "UI Tester Updated"; phone = "+2348087654321"; bio = "Testing the user interface"; avatar_url = "" } | ConvertTo-Json)
  Check "profile save works" ($upd.user.name -eq "UI Tester Updated")

  Invoke-RestMethod -Method Post -Uri "$base/api/users/me/password" -ContentType application/json -Headers $hdr -Body (@{ currentPassword = "Passw0rd123"; newPassword = "Changed789" } | ConvertTo-Json) | Out-Null
  $relogin = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType application/json -Body (@{ email = $email; password = "Changed789" } | ConvertTo-Json)
  Check "password change + re-login works" ($relogin.accessToken -ne $null)

} finally {
  if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}

Write-Output ""
Write-Output "RESULT: $($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }
