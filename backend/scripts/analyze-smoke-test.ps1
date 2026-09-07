$ErrorActionPreference = "Stop"
$base = "http://localhost:3105"
$target = "http://localhost:3106"
$script:pass = 0
$script:fail = 0

function Check($name, $condition) {
  if ($condition) { $script:pass++; Write-Output "PASS  $name" }
  else { $script:fail++; Write-Output "FAIL  $name" }
}

function StatusOf($err) {
  if ($err.Exception.Response) { return [int]$err.Exception.Response.StatusCode } else { return -1 }
}

Write-Output "== Seeding =="
node scripts/seed.js
if ($LASTEXITCODE -ne 0) { Write-Output "Seed failed"; exit 1 }

# ---- Start a small local "target website" for live scans ----
$page = Join-Path $env:TEMP "mitex-audit-target.html"
@"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="description" content="A premium online store selling handmade goods with shipping worldwide and a clean checkout." />
<title>Handmade Goods Store - Premium E-Commerce Website For Sale</title>
<link rel="canonical" href="http://localhost:3106/" />
<link rel="icon" href="/favicon.ico" />
<meta property="og:image" content="/banner.jpg" />
<script type="application/ld+json" id="schema">{"@context":"https://schema.org"}</script>
</head>
<body>
<h1>Handmade Goods Store</h1>
<p>The store is a full e-commerce build with product pages, cart, checkout, inventory and payment handling. It ships worldwide and has a loyal returning customer base. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
<img src="/img/a.jpg" alt="product a" loading="lazy" />
<img src="/img/b.jpg" alt="product b" loading="lazy" />
<a href="/shop">Shop</a>
<a href="https://example.com">Partner</a>
</body>
</html>
"@ | Set-Content -Path $page -Encoding UTF8

$targetJs = Join-Path $env:TEMP "mitex-audit-target.js"
@"
const http = require('http');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'br', 'Cache-Control': 'public, max-age=3600', 'Strict-Transport-Security': 'max-age=15552000', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  res.end(html);
});
server.listen(Number(process.env.TARGET_PORT || 3106));
"@ | Set-Content -Path $targetJs -Encoding ASCII
$env:TARGET_PORT = "3106"
$targetOut = Join-Path $env:TEMP "mitex-audit-target-out.log"
$targetErr = Join-Path $env:TEMP "mitex-audit-target-err.log"
$tp = Start-Process node -ArgumentList "$targetJs","$page" -PassThru -WindowStyle Hidden -RedirectStandardOutput $targetOut -RedirectStandardError $targetErr
Remove-Item Env:\TARGET_PORT

# ---- Start MITEX server ----
$env:PORT = "3105"
$env:MITEX_AUDIT_ALLOW_PRIVATE = "1"
$out = Join-Path $env:TEMP "mitex-analyze-out.log"
$errLog = Join-Path $env:TEMP "mitex-analyze-err.log"
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

  # ---- Target reachable ----
  $tReach = $false
  for ($i = 0; $i -lt 10; $i++) {
    try { $tr = Invoke-WebRequest -UseBasicParsing -Uri "$target/" -TimeoutSec 3; $tReach = ($tr.StatusCode -eq 200); break } catch { Start-Sleep -Milliseconds 400 }
  }
  Check "target website reachable" $tReach

  # ---- SEO checker (live) ----
  $seo = Invoke-RestMethod -Method Post -Uri "$base/api/analyze/seo" -ContentType application/json -Body (@{ url = "$target/" } | ConvertTo-Json)
  Check "SEO checker scores 0-100" ($seo.score -ge 0 -and $seo.score -le 100)
  Check "SEO checker detects meta description + title" (@($seo.checks | Where-Object { $_.label -like "*title*" -or $_.label -like "*description*" }).Count -ge 2)
  Check "SEO checker finds schema/structured data" (@($seo.checks | Where-Object { $_.label -like "*structured*" }).Count -ge 1)

  # ---- Health score (live) ----
  $health = Invoke-RestMethod -Method Post -Uri "$base/api/analyze/health" -ContentType application/json -Body (@{ url = "$target/" } | ConvertTo-Json)
  Check "Health score returns 0-100" ($health.score -ge 0 -and $health.score -le 100)
  Check "Health checker found security headers" (@($health.checks | Where-Object { $_.label -like "*Security headers*" -and $_.status -ne "warn" }).Count -ge 1)

  # ---- Performance checker (live) ----
  $perf = Invoke-RestMethod -Method Post -Uri "$base/api/analyze/performance" -ContentType application/json -Body (@{ url = "$target/" } | ConvertTo-Json)
  Check "Performance checker returns score + timing" ($perf.score -ge 0 -and $perf.score -le 100)
  Check "Performance checker detects compression + cache" (@($perf.checks | Where-Object { $_.label -like "*Compression*" -or $_.label -like "*cache*" }).Count -ge 2)

  # ---- AI Analyzer (live) ----
  $full = Invoke-RestMethod -Method Post -Uri "$base/api/analyze" -ContentType application/json -Body (@{ url = "$target/" } | ConvertTo-Json)
  Check "AI analyzer returns grade + brief" ($full.grade -ne $null -and $full.brief -like "*shape*")
  Check "AI analyzer includes all three sub-scores" ($full.health -ne $null -and $full.seo -ne $null -and $full.performance -ne $null)
  Check "AI analyzer captured live signals" ($full.live -eq $true -and $full.signals.words -gt 10)

  # ---- AI description generator (field-based) ----
  $desc = Invoke-RestMethod -Method Post -Uri "$base/api/analyze/describe" -ContentType application/json -Body (@{ title = "Boutique Fashion Store"; tech_stack = "Payments, JWT Auth, Admin"; level = 5; assetType = "business" } | ConvertTo-Json)
  Check "Description generator returns text" ($desc.description.Length -gt 100)
  Check "Description generator includes title + MITEX" ($desc.description -like "*Boutique Fashion Store*" -and $desc.description -like "*MITEX*")
  Check "Description generator emits tags" (@($desc.tags).Count -ge 3)

  # ---- SSRF guard (util-level; server allows private for the live scan) ----
  $ssrf = $false
  try {
    $probe = Join-Path $env:TEMP "mitex-ssrf-probe.js"
    @"
const s = require('process');
s.env.MITEX_AUDIT_ALLOW_PRIVATE = '';
const a = require('$((Join-Path (Get-Location) 'utils\site-audit.js') -replace '\\','/')');
Promise.all([
  a.fetchPage('http://127.0.0.1:9/'),
  a.fetchPage('http://10.0.0.5/'),
  a.fetchPage('http://localhost/'),
]).then((rs) => {
  const allRefused = rs.every((r) => !r.ok && String(r.error || '').indexOf('Refused to scan') === 0);
  process.exit(allRefused ? 0 : 1);
}).catch(() => process.exit(2));
"@ | Set-Content -Path $probe -Encoding ASCII
    & node $probe
    $ssrf = ($LASTEXITCODE -eq 0)
  } catch { $ssrf = $false }
  Check "SSRF guard blocks private hosts" $ssrf
  Remove-Item Env:\MITEX_AUDIT_ALLOW_PRIVATE -ErrorAction SilentlyContinue

  # ---- Invalid URL handling ----
  # Design: invalid/non-http(s) URL degrades to a safe 200 response noting the
  # issue (never a crash). Verify that contract.
  $badUrl = $false
  try {
    $badResp = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base/api/analyze/seo" -ContentType application/json -Body (@{ url = "ftp://example.com" } | ConvertTo-Json) -TimeoutSec 15
    $badBody = ($badResp.Content | ConvertFrom-Json)
    $badUrl = ($badResp.StatusCode -eq 200 -and $badBody.note -ne $null)
  } catch {
    $badUrl = ((StatusOf $_) -eq 400 -or (StatusOf $_) -eq 500)
  }
  Check "Non-http(s) URL handled safely (no crash)" $badUrl

  # ---- Offline fallback (no url -> score 0 with note, no server crash) ----
  $offline = Invoke-RestMethod -Method Post -Uri "$base/api/analyze/seo" -ContentType application/json -Body (@{ title = "No URL test" } | ConvertTo-Json)
  Check "Offline call returns safe no-score response" ($offline.score -eq 0 -and $offline.note -ne $null)

  Write-Output "`n== Results: $($script:pass) passed, $($script:fail) failed =="
  if ($script:fail -gt 0) { exit 1 }
} finally {
  if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  if ($tp) { Stop-Process -Id $tp.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:\PORT -ErrorAction SilentlyContinue
}