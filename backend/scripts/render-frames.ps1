# Frame rasteriser for the MITEX AI video generator.
#
# Node owns the AI call, the crossfade and the GIF encoding; this helper exists
# only because text needs a real font. Hand-rolling a glyph rasteriser would
# mean shipping font data, so instead this shells into GDI+, which is already
# on the machine, and hands back raw 24-bit RGB for Node to encode.
#
# Contract: read a JSON spec, write one RGB frame per scene to -OutRaw.

param(
  [Parameter(Mandatory = $true)][string]$SpecFile,
  [Parameter(Mandatory = $true)][string]$OutRaw
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function Read-HexColor([string]$value, [System.Drawing.Color]$fallback) {
  if (-not $value) { return $fallback }
  try {
    return [System.Drawing.ColorTranslator]::FromHtml($value)
  } catch {
    return $fallback
  }
}

function Darken([System.Drawing.Color]$c, [int]$by) {
  $r = [Math]::Max(0, $c.R - $by)
  $g = [Math]::Max(0, $c.G - $by)
  $b = [Math]::Max(0, $c.B - $by)
  return [System.Drawing.Color]::FromArgb($c.A, $r, $g, $b)
}

function Pick-FontFamily {
  $wanted = @("Segoe UI", "Arial", "Tahoma", "Verdana", "Microsoft Sans Serif")
  $installed = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
  foreach ($name in $wanted) {
    if ($installed -contains $name) { return [System.Drawing.FontFamily]::new($name) }
  }
  return [System.Drawing.Text.GenericFontFamilies]::GenericSansSerif
}

# Shrink until the block fits, so long user copy never runs off the canvas.
function Fit-Font([System.Drawing.Graphics]$g, [string]$text, [System.Drawing.FontFamily]$family,
                   [System.Drawing.FontStyle]$style, [float]$maxW, [float]$maxH, [float]$start) {
  $size = $start
  while ($size -gt 10) {
    $f = [System.Drawing.Font]::new($family, $size, $style)
    $m = $g.MeasureString($text, $f, $maxW)
    $fits = ($m.Width -le $maxW) -and ($m.Height -le $maxH)
    $f.Dispose()
    if ($fits) { return $size }
    $size = $size - 2
  }
  return 10
}

$spec = Get-Content -Path $SpecFile -Raw -Encoding UTF8 | ConvertFrom-Json
$width = [int]$spec.width
$height = [int]$spec.height
if ($width -lt 64) { $width = 64 }
if ($height -lt 64) { $height = 64 }

$family = Pick-FontFamily
$margin = [Math]::Max(24, [int]($width * 0.09))
$maxW = $width - ($margin * 2)

if (Test-Path $OutRaw) { Remove-Item $OutRaw -Force }
$stream = [System.IO.File]::Open($OutRaw, [System.IO.FileMode]::Create)
$rowBytes = $width * 3

try {
  foreach ($scene in $spec.scenes) {
    $bg = Read-HexColor $scene.bg ([System.Drawing.Color]::FromArgb(255, 15, 23, 42))
    $fg = Read-HexColor $scene.fg ([System.Drawing.Color]::FromArgb(255, 240, 242, 245))
    $accent = Read-HexColor $scene.accent ([System.Drawing.Color]::FromArgb(255, 79, 70, 229))

    $bmp = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Vertical gradient rather than a flat fill: flat backgrounds band badly
    # once quantised to 256 colours.
    $rect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
    $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      $rect, $bg, (Darken $bg 55), [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    $title = [string]$scene.text
    $sub = [string]$scene.subtext

    $titleSize = Fit-Font $g $title $family ([System.Drawing.FontStyle]::Bold) $maxW ($height * 0.5) ([Math]::Max(20, $width * 0.085))
    $titleFont = [System.Drawing.Font]::new($family, $titleSize, [System.Drawing.FontStyle]::Bold)
    $titleSize2 = $g.MeasureString($title, $titleFont, $maxW)
    $totalH = $titleSize2.Height
    $subFont = $null
    $subSize2 = [System.Drawing.SizeF]::Empty
    if ($sub) {
      $subFont = [System.Drawing.Font]::new($family, [Math]::Max(11, $titleSize * 0.42), [System.Drawing.FontStyle]::Regular)
      $subSize2 = $g.MeasureString($sub, $subFont, $maxW)
      $totalH = $totalH + $subSize2.Height + ($height * 0.035)
    }

    $top = ($height - $totalH) / 2
    $sf = [System.Drawing.StringFormat]::new()
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
    $sf.FormatFlags = [System.Drawing.StringFormatFlags]::LineLimit

    $titleBox = [System.Drawing.RectangleF]::new($margin, $top, $maxW, $titleSize2.Height + 2)
    $titleBrush = [System.Drawing.SolidBrush]::new($fg)
    $g.DrawString($title, $titleFont, $titleBrush, $titleBox, $sf)

    if ($subFont) {
      $accentW = [Math]::Min(120, $width * 0.16)
      $accentY = $top + $titleSize2.Height + ($height * 0.035)
      $accentBrush = [System.Drawing.SolidBrush]::new($accent)
      $accentRect = [System.Drawing.RectangleF]::new(($width - $accentW) / 2, $accentY, $accentW, 4)
      $g.FillRectangle($accentBrush, $accentRect)
      $accentBrush.Dispose()

      $subY = $accentY + 4 + ($height * 0.03)
      $subBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, [Math]::Min(255, $fg.R + 40), [Math]::Min(255, $fg.G + 40), [Math]::Min(255, $fg.B + 40)))
      $subBox = [System.Drawing.RectangleF]::new($margin, $subY, $maxW, $subSize2.Height + 2)
      $g.DrawString($sub, $subFont, $subBrush, $subBox, $sf)
      $subBrush.Dispose()
      $subFont.Dispose()
    }

    $titleBrush.Dispose()
    $titleFont.Dispose()
    $g.Dispose()

    # Copy row by row: the stride includes padding that must not reach Node,
    # or every row after the first would shift and shear the image.
    #
    # NOTE: GDI+ stores Format24bppRgb as BGR, not RGB. The bytes are passed
    # through untouched here and ai-video-generator.js swaps them, because
    # doing the swap per-pixel in PowerShell is roughly 100x slower than the
    # same loop in V8.
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $stride = $data.Stride
    $row = New-Object byte[] $rowBytes
    for ($y = 0; $y -lt $height; $y++) {
      [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($data.Scan0, $y * $stride), $row, 0, $rowBytes)
      $stream.Write($row, 0, $rowBytes)
    }
    $bmp.UnlockBits($data)
    $bmp.Dispose()
  }
} finally {
  $stream.Close()
}

Write-Output ("rendered=" + @($spec.scenes).Count + " width=" + $width + " height=" + $height)
