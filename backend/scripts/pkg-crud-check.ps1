$ErrorActionPreference = "Stop"
$base = "http://localhost:3104"
$script:pass = 0
$script:fail = 0

function Check($name, $condition) {
  if ($condition) { $script:pass++; Write-Output "PASS  $name" }
  else { $script:fail++; Write-Output "FAIL  $name" }
}

Write-Output "== Starting server on :3104 =="
$env:PORT = "3104"
$out = Join-Path $env:TEMP "mitex-pkgcrud-out.log"
$errLog = Join-Path $env:TEMP "mitex-pkgcrud-err.log"
$p = Start-Process node -ArgumentList "server.js" -WorkingDirectory (Get-Location) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $errLog

try {
  $h = $null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 700
    try { $h = Invoke-RestMethod "$base/api/health" -TimeoutSec 2; if ($h.status -eq "ok") { break } } catch {}
  }
  Check "health ok" ($h -and $h.status -eq "ok")

  $loginBody = @{ email = "admin@mitex.store"; password = "ChangeMe123!" } | ConvertTo-Json
  $login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType "application/json" -Body $loginBody
  Check "admin login" ([bool]$login.accessToken)
  $headers = @{ Authorization = "Bearer $($login.accessToken)" }
  $authHeaders = @{ Authorization = "Bearer $($login.accessToken)"; "Content-Type" = "application/json" }

  $plainHeaders = @{ "Content-Type" = "application/json" }
  try {
    Invoke-RestMethod "$base/api/packages" -Method Post -Headers $plainHeaders -Body (@{ key = "anon-test"; name = "Anon Test" } | ConvertTo-Json)
    Check "anon create blocked" $false
  } catch {
    Check "anon create blocked (401)" ([int]$_.Exception.Response.StatusCode -eq 401)
  }

  $created = Invoke-RestMethod "$base/api/packages" -Method Post -Headers $authHeaders -Body (@{ key = "test-x"; name = "Test Package"; code = "Tst"; price = 12345; popular = $true; features = @("a","b") } | ConvertTo-Json -Depth 5)
  Check "create package" ($created.key -eq "test-x" -and $created.price -eq 12345)

  $dupResp = $null
  try {
    Invoke-RestMethod "$base/api/packages" -Method Post -Headers $authHeaders -Body (@{ key = "test-x"; name = "Dup" } | ConvertTo-Json)
    Check "duplicate rejected" $false
  } catch {
    Check "duplicate key rejected (409)" ([int]$_.Exception.Response.StatusCode -eq 409)
  }

  $updated = Invoke-RestMethod "$base/api/packages/test-x" -Method Put -Headers $authHeaders -Body (@{ price = 22222; name = "Renamed" } | ConvertTo-Json)
  Check "update package" ($updated.price -eq 22222 -and $updated.name -eq "Renamed")

  $list = ((Invoke-WebRequest "$base/api/packages").Content | ConvertFrom-Json)
  Check "public list still has standard" ([bool]($list | Where-Object { $_.key -eq "standard" }))

  $del = Invoke-RestMethod "$base/api/packages/test-x" -Method Delete -Headers $headers
  Check "delete package" ($del.ok -eq $true)

  $plainHeaders = @{ "Content-Type" = "application/json" }
  try {
    Invoke-RestMethod "$base/api/packages" -Method Post -Headers $plainHeaders -Body (@{ key = "blocked"; name = "X" } | ConvertTo-Json)
    Check "unauthenticated create blocked" $false
  } catch {
    Check "unauthenticated create blocked (401)" ([int]$_.Exception.Response.StatusCode -eq 401)
  }

  Write-Output ("RESULT: {0} passed, {1} failed" -f $script:pass, $script:fail)
  if ($script:fail -gt 0) { exit 1 }
} finally {
  if ($p -and !$p.HasExited) { Stop-Process -Id $p.Id -Force }
  Remove-Item Env:\PORT -ErrorAction SilentlyContinue
}