$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Join-Path (Get-Location) 'public/assets/Interiors/Room_Builder_subfiles_48x48'
$files = @(
  'Room_Builder_Floors_48x48.png', 'Room_Builder_Floor_Paths_48x48.png',
  'Room_Builder_Floor_Connectors_48x48.png', 'Room_Builder_Walls_48x48.png',
  'Room_Builder_3d_walls_48x48.png', 'Room_Builder_Arched_Entryways_48x48.png',
  'Room_Builder_borders_48x48.png', 'Room_Builder_baseboards_48x48.png',
  'Room_Builder_Floor_Shadows_48x48.png'
)
$output = [ordered]@{}
foreach ($file in $files) {
  $bitmap = [System.Drawing.Bitmap]::FromFile((Join-Path $root $file))
  try {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $bitmap.Width, $bitmap.Height
    $locked = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $bytes = New-Object byte[] ([Math]::Abs($locked.Stride) * $bitmap.Height)
      [System.Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $bytes, 0, $bytes.Length)
      $items = [System.Collections.Generic.List[object]]::new()
      for ($y = 0; $y -lt $bitmap.Height; $y += 48) {
        for ($x = 0; $x -lt $bitmap.Width; $x += 48) {
          $w = [Math]::Min(48, $bitmap.Width - $x); $h = [Math]::Min(48, $bitmap.Height - $y); $opaque = 0
          for ($dy = 0; $dy -lt $h -and $opaque -lt 24; $dy++) {
            for ($dx = 0; $dx -lt $w -and $opaque -lt 24; $dx++) {
              if ($bytes[($y + $dy) * [Math]::Abs($locked.Stride) + ($x + $dx) * 4 + 3] -gt 16) { $opaque++ }
            }
          }
          if ($opaque -ge 24) { $items.Add(@($x, $y, $w, $h)) }
        }
      }
      $output[$file] = @($items.ToArray())
    } finally { $bitmap.UnlockBits($locked) }
  } finally { $bitmap.Dispose() }
}
$json = ConvertTo-Json -InputObject $output -Depth 5 -Compress
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'src/world/roomBuilderTiles.json'), $json, [System.Text.UTF8Encoding]::new($false))
