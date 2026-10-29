param(
  [Parameter(Mandatory = $true)][string[]]$FrameASources,
  [Parameter(Mandatory = $true)][string[]]$FrameBSources
)
$ErrorActionPreference = 'Stop'
if ($FrameASources.Count -ne 5 -or $FrameBSources.Count -ne 5) { throw 'Provide five reviewed A strips and five opposite-stride B images.' }
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent

function Read-Frame([string]$Path, [bool]$LeftHalf) {
  $image = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $width = if ($LeftHalf) { [Math]::Floor($image.Width / 2) } else { $image.Width }
    # Analyze a proportional thumbnail; final drawing still samples the original.
    $thumbnail = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($thumbnail)
    $scale = [Math]::Min(256.0 / $width, 256.0 / $image.Height)
    $graphics.DrawImage($image, [System.Drawing.Rectangle]::new(0, 0, [int]($width * $scale), [int]($image.Height * $scale)), [System.Drawing.Rectangle]::new(0, 0, $width, $image.Height), [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Dispose()
    $left = 256; $top = 256; $right = -1; $bottom = -1
    for ($y = 0; $y -lt 256; $y++) { for ($x = 0; $x -lt 256; $x++) {
      if ($thumbnail.GetPixel($x, $y).A -gt 32) {
        $left = [Math]::Min($left, $x); $top = [Math]::Min($top, $y)
        $right = [Math]::Max($right, $x); $bottom = [Math]::Max($bottom, $y)
      }
    } }
    $thumbnail.Dispose()
    if ($right -lt 0) { throw "Empty authored frame: $Path" }
    return @{ Path = $Path; Bounds = [System.Drawing.Rectangle]::new([Math]::Max(0, [int](($left - 1) / $scale)), [Math]::Max(0, [int](($top - 1) / $scale)), [int](($right - $left + 3) / $scale), [int](($bottom - $top + 3) / $scale)) }
  } finally { $image.Dispose() }
}

for ($index = 0; $index -lt 5; $index++) {
  $frames = @((Read-Frame $FrameASources[$index] $true), (Read-Frame $FrameBSources[$index] $false))
  $destination = Join-Path $projectRoot "tools/generated-inputs/characters/char_$index.png"
  $old = [System.Drawing.Bitmap]::FromFile($destination)
  $sheet = [System.Drawing.Bitmap]::new(512, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($sheet)
  $graphics.DrawImageUnscaled($old, 0, 0)
  $old.Dispose()
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.FillRectangle([System.Drawing.Brushes]::Transparent, 0, 256, 512, 256)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  for ($column = 0; $column -lt 2; $column++) {
    $frame = $frames[$column]
    $source = [System.Drawing.Bitmap]::FromFile($frame.Path)
    $scale = [Math]::Min(220.0 / $frame.Bounds.Height, 220.0 / $frame.Bounds.Width)
    $width = [int][Math]::Round($frame.Bounds.Width * $scale)
    $height = [int][Math]::Round($frame.Bounds.Height * $scale)
    $target = [System.Drawing.Rectangle]::new($column * 256 + [int][Math]::Floor((256 - $width) / 2), 256 + 240 - $height, $width, $height)
    $graphics.DrawImage($source, $target, $frame.Bounds, [System.Drawing.GraphicsUnit]::Pixel)
    $source.Dispose()
  }
  # Enforce the atlas padding contract, including legacy stray gutter pixels.
  for ($row = 0; $row -lt 4; $row++) { for ($column = 0; $column -lt 2; $column++) {
    $x = $column * 256; $y = $row * 256
    $graphics.FillRectangle([System.Drawing.Brushes]::Transparent, $x, $y, 256, 12)
    $graphics.FillRectangle([System.Drawing.Brushes]::Transparent, $x, $y + 244, 256, 12)
    $graphics.FillRectangle([System.Drawing.Brushes]::Transparent, $x, $y, 12, 256)
    $graphics.FillRectangle([System.Drawing.Brushes]::Transparent, $x + 244, $y, 12, 256)
  } }
  $graphics.Dispose()
  $sheet.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  $sheet.Dispose()
  Copy-Item -LiteralPath $destination -Destination (Join-Path $projectRoot "public/generated-pixel-assets/characters/char_$index.png") -Force
  Write-Output "char_${index}: authored opposite-stride pair exported, 256px cells, feet baseline 240"
}
