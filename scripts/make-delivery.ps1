# MITEX delivery packager
# Builds a clean ZIP of the website source (no secrets, no node_modules)
# ready to upload to Google Drive.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File "scripts\make-delivery.ps1" -Name "NovaMart"
#
# Result: deliveries\NovaMart.zip  +  a printed checklist of next steps.

param(
  [Parameter(Mandatory = $true)]
  [string]$Name,

  [string]$Source = "",

  # Optional: your Google Drive synced folder (Google Drive for Desktop),
  # e.g. -DriveFolder "G:\My Drive\MITEX Delivery"
  # When provided, the ZIP is copied there and uploads automatically.
  [string]$DriveFolder = ""
)

$ErrorActionPreference = "Stop"

if (-not $Source) {
  if (-not $PSScriptRoot) {
    Write-Output "Could not detect project folder. Re-run with: -File 'C:\path\to\make-delivery.ps1'"
    exit 1
  }
  $Source = Split-Path -Parent $PSScriptRoot
}

$root       = Split-Path -Parent $PSScriptRoot
$deliveries = Join-Path $root "deliveries"
$stage      = Join-Path $env:TEMP ("mitex-pack-" + [guid]::NewGuid().ToString("N").Substring(0, 8))

if (-not (Test-Path $deliveries)) { New-Item -ItemType Directory -Path $deliveries | Out-Null }
New-Item -ItemType Directory -Path $stage | Out-Null

Write-Output ""
Write-Output "== Packaging '$Name' from: $Source"

if (-not (Test-Path $Source)) {
  Write-Output ""
  Write-Output "FAILED: that source folder does not exist."
  Write-Output "        Check the spelling, or create it and put the website files inside first."
  exit 1
}

# ---- 1. Copy project files, excluding junk and secrets ----
$out = robocopy $Source $stage /E /NFL /NDL /NJH /NJS /NP `
  /XD ".git" "node_modules" "data" "deliveries" "test-results" ".opencode" `
  /XF ".env" "*.log" "*.db" "*.sqlite" "*.sqlite3" 2>&1

if ($LASTEXITCODE -ge 8) {
  Write-Output "FAILED: robocopy could not copy the project files. Details:"
  Write-Output ($out | Select-Object -Last 12)
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  exit 1
}

# ---- 2. Buyer quick-start file inside the ZIP ----
# If the product folder has its own DELIVERY-NOTES.txt, use it verbatim
# (e.g. static templates where npm/server instructions make no sense).
$notesFile = Join-Path $Source "DELIVERY-NOTES.txt"

if (Test-Path $notesFile) {
  Copy-Item -LiteralPath $notesFile -Destination (Join-Path $stage "README-START-HERE.txt") -Force
  Write-Output ""
  Write-Output "NOTE: using product-specific DELIVERY-NOTES.txt as the buyer quick-start."
} else {

$readme = @"
====================================================
 $Name  -  delivered by MITEX
====================================================

WHAT'S IN HERE
  index.html etc.  -> the public website
  backend\         -> the server code (Node.js) + database drivers
  supabase-setup.sql / db\schema.sql -> database setup scripts

RUN IT ON YOUR COMPUTER
  1. Install Node.js LTS: https://nodejs.org
  2. Open PowerShell inside this folder:

       cd backend
       npm install
       npm run seed
       node server.js

  3. Open http://localhost:3000 in your browser.

PUT IT ONLINE
  Render.com free tier works out of the box:
    - New Web Service -> connect your GitHub repo
    - Build: npm install --omit=dev   Start: node server.js   Root dir: backend

FIRST THINGS TO CHANGE
  1. backend\.env does NOT ship with this package (security).
     Create it by copying backend\.env.example and filling in:
       JWT_ACCESS_SECRET  (any long random string)
  2. Add YOUR Paystack keys to start receiving real payments.
  3. Change the admin password after first login.

Support: WhatsApp +234 701 163 3770  -  MITEX Team
"@

Set-Content -LiteralPath (Join-Path $stage "README-START-HERE.txt") -Value $readme -Encoding UTF8
}

# ---- 3. Zip it ----
$zipPath = Join-Path $deliveries ($Name + ".zip")
if (Test-Path $zipPath) {
  try {
    Remove-Item $zipPath -Force -ErrorAction Stop
  } catch {
    $stamp = Get-Date -Format "yyyyMMdd-HHmm"
    $zipPath = Join-Path $deliveries ($Name + "-" + $stamp + ".zip")
    Write-Output ""
    Write-Output ("NOTE: previous ZIP is locked (open in Explorer or syncing to Drive).")
    Write-Output ("      Saving this build as a separate file instead: " + (Split-Path -Leaf $zipPath))
  }
}
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue

$sizeKb = [math]::Round((Get-Item $zipPath).Length / 1kb, 1)
Write-Output ("DONE: " + $zipPath + "  (" + $sizeKb + " KB)")

if ($DriveFolder) {
  if (Test-Path $DriveFolder) {
    Copy-Item -LiteralPath $zipPath -Destination $DriveFolder -Force
    Write-Output ""
    Write-Output ("UPLOAD: copied to '" + $DriveFolder + "' - Google Drive will sync it automatically.")
    Write-Output "        When sync finishes, right-click the file in Drive -> Share ->"
    Write-Output "        Anyone with the link -> Viewer -> Copy link."
  } else {
    Write-Output ""
    Write-Output ("WARNING: Drive folder not found: " + $DriveFolder)
    Write-Output "         Upload the ZIP manually instead."
  }
}

Write-Output ""
Write-Output "NEXT STEPS:"
Write-Output "  1. Upload deliveries\$($Name).zip to Google Drive"
Write-Output "  2. Share -> Anyone with the link -> Viewer -> Copy link"
Write-Output "  3. Admin dashboard -> Listings -> Edit -> paste into 'Delivery link'"
Write-Output ""
