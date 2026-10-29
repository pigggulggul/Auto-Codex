$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root 'public/generated-pixel-assets'
$font = [System.Drawing.Font]::new('Segoe UI', 15)
$small = [System.Drawing.Font]::new('Segoe UI', 12)

$walk = [System.Drawing.Bitmap]::new(1280, 220)
$graphics = [System.Drawing.Graphics]::FromImage($walk)
$graphics.Clear([System.Drawing.Color]::FromArgb(36, 45, 54))
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
for ($index = 0; $index -lt 5; $index++) {
  $sheet = [System.Drawing.Bitmap]::FromFile((Join-Path $runtime "characters/char_$index.png"))
  $graphics.DrawString("char_$index", $font, [System.Drawing.Brushes]::White, $index * 256 + 98, 9)
  for ($column = 0; $column -lt 2; $column++) {
    $graphics.DrawImage($sheet, [System.Drawing.Rectangle]::new($index * 256 + $column * 128, 45, 128, 128), [System.Drawing.Rectangle]::new($column * 256, 256, 256, 256), [System.Drawing.GraphicsUnit]::Pixel)
    $label = if ($column -eq 0) { 'A: left foot' } else { 'B: right foot' }
    $graphics.DrawString($label, $small, [System.Drawing.Brushes]::White, $index * 256 + $column * 128 + 21, 184)
  }
  $sheet.Dispose()
}
$graphics.Dispose()
$walk.Save((Join-Path $root 'docs/walk-cycle-review.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$walk.Dispose()

$props = @(Get-ChildItem -LiteralPath (Join-Path $runtime 'furniture') -Filter '*.png' -File -Recurse | Sort-Object FullName)
$gallery = [System.Drawing.Bitmap]::new(1100, [int]([Math]::Ceiling($props.Count / 5.0) * 190))
$graphics = [System.Drawing.Graphics]::FromImage($gallery)
$graphics.Clear([System.Drawing.Color]::FromArgb(36, 45, 54))
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
for ($index = 0; $index -lt $props.Count; $index++) {
  $image = [System.Drawing.Bitmap]::FromFile($props[$index].FullName)
  $column = $index % 5; $row = [Math]::Floor($index / 5)
  $scale = [Math]::Min(180.0 / $image.Width, 140.0 / $image.Height)
  $width = [int]($image.Width * $scale); $height = [int]($image.Height * $scale)
  $graphics.DrawImage($image, [System.Drawing.Rectangle]::new($column * 220 + [int]((220 - $width) / 2), $row * 190 + 145 - $height, $width, $height))
  $graphics.DrawString($props[$index].BaseName, $small, [System.Drawing.Brushes]::White, $column * 220 + 10, $row * 190 + 159)
  $image.Dispose()
}
$graphics.Dispose()
$gallery.Save((Join-Path $root 'docs/props-review.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$gallery.Dispose()
$font.Dispose(); $small.Dispose()
Write-Output 'Wrote docs/walk-cycle-review.png and docs/props-review.png'
