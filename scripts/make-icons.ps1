# Generates MITEX PWA app icons (gold M on dark background)
# Run once from anywhere: powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "icons"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

function New-MitexIcon {
  param([int]$Size, [string]$OutPath, [switch]$Maskable)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 7, 11, 20))
  $g.FillRectangle($bg, 0, 0, $Size, $Size)

  $gold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 251, 191, 36))

  $letterPx = if ($Maskable) { [int]($Size * 0.42) } else { [int]($Size * 0.60) }
  $font = New-Object System.Drawing.Font("Arial", [float]$letterPx, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, ($Size * -0.02), $Size, $Size)
  $g.DrawString("M", $font, $gold, $rect, $sf)

  $barH = [Math]::Max(2, [int]($Size * 0.03))
  $barW = if ($Maskable) { [int]($Size * 0.28) } else { [int]($Size * 0.40) }
  $barX = [int](($Size - $barW) / 2)
  $barY = if ($Maskable) { [int]($Size * 0.74) } else { [int]($Size * 0.82) }
  $g.FillRectangle($gold, $barX, $barY, $barW, $barH)

  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("created " + $OutPath)
}

New-MitexIcon -Size 192 -OutPath (Join-Path $dir "icon-192.png")
New-MitexIcon -Size 512 -OutPath (Join-Path $dir "icon-512.png")
New-MitexIcon -Size 512 -OutPath (Join-Path $dir "icon-maskable-512.png") -Maskable
