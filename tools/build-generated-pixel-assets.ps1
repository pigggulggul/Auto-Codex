$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$inputRoot = Join-Path $projectRoot "tools\generated-inputs"
$outputRoot = Join-Path $projectRoot "public\generated-pixel-assets"
$propRegions = Get-Content -LiteralPath (Join-Path $inputRoot 'props-v2-regions.json') -Raw | ConvertFrom-Json

function New-TransparentBitmap {
  param([int]$Width, [int]$Height)
  return [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function New-PixelGraphics {
  param([System.Drawing.Bitmap]$Bitmap)
  $graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  return $graphics
}

function Save-Png {
  param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $Bitmap.Dispose()
}

function Get-GridCell {
  param(
    [System.Drawing.Bitmap]$Source,
    [int]$Columns,
    [int]$Rows,
    [int]$Column,
    [int]$Row,
    [int]$Left = 0,
    [int]$Top = 0,
    [int]$RegionWidth = 0,
    [int]$RegionHeight = 0
  )
  if ($RegionWidth -le 0) { $RegionWidth = $Source.Width - $Left }
  if ($RegionHeight -le 0) { $RegionHeight = $Source.Height - $Top }
  $x1 = $Left + [Math]::Floor($RegionWidth * $Column / $Columns)
  $y1 = $Top + [Math]::Floor($RegionHeight * $Row / $Rows)
  $x2 = $Left + [Math]::Floor($RegionWidth * ($Column + 1) / $Columns)
  $y2 = $Top + [Math]::Floor($RegionHeight * ($Row + 1) / $Rows)
  $cell = New-TransparentBitmap ($x2 - $x1) ($y2 - $y1)
  $graphics = New-PixelGraphics $cell
  try {
    $graphics.DrawImage($Source, [System.Drawing.Rectangle]::new(0, 0, $cell.Width, $cell.Height), [System.Drawing.Rectangle]::new($x1, $y1, $cell.Width, $cell.Height), [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $graphics.Dispose()
  }
  return $cell
}

function Get-AlphaBounds {
  param([System.Drawing.Bitmap]$Bitmap)
  $minX = $Bitmap.Width
  $minY = $Bitmap.Height
  $maxX = -1
  $maxY = -1
  for ($y = 0; $y -lt $Bitmap.Height; $y += 1) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += 1) {
      if ($Bitmap.GetPixel($x, $y).A -gt 8) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($maxX -lt 0) { return [System.Drawing.Rectangle]::new(0, 0, $Bitmap.Width, $Bitmap.Height) }
  return [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

function Get-PropCell {
  param([System.Drawing.Bitmap]$Source, [string]$Kind, [int]$Column, [int]$Row)
  # ImageGen's authored gutters are reviewed explicitly. Equal grid cuts can
  # slice a complete pot or import leaves belonging to the cell above it.
  $layout = $propRegions.$Kind
  if ($Source.Width -ne $layout.width -or $Source.Height -ne $layout.height) { throw "Unreviewed $Kind atlas dimensions" }
  $left = $layout.columns[$Column]; $right = $layout.columns[$Column + 1]
  $top = $layout.rowCutsByColumn[$Column][$Row]; $bottom = $layout.rowCutsByColumn[$Column][$Row + 1]
  return $Source.Clone([System.Drawing.Rectangle]::new($left, $top, $right - $left, $bottom - $top), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function Render-Fit {
  param(
    [System.Drawing.Bitmap]$Source,
    [int]$Width,
    [int]$Height,
    [switch]$Trim
  )
  $bounds = if ($Trim) { Get-AlphaBounds $Source } else { [System.Drawing.Rectangle]::new(0, 0, $Source.Width, $Source.Height) }
  $scale = [Math]::Min(($Width - 2) / [double]$bounds.Width, ($Height - 2) / [double]$bounds.Height)
  $drawWidth = [Math]::Max(1, [Math]::Floor($bounds.Width * $scale))
  $drawHeight = [Math]::Max(1, [Math]::Floor($bounds.Height * $scale))
  $result = New-TransparentBitmap $Width $Height
  $graphics = New-PixelGraphics $result
  try {
    $destination = [System.Drawing.Rectangle]::new([Math]::Floor(($Width - $drawWidth) / 2), [Math]::Floor(($Height - $drawHeight) / 2), $drawWidth, $drawHeight)
    $graphics.DrawImage($Source, $destination, $bounds, [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $graphics.Dispose()
  }
  return $result
}

function Draw-Into {
  param([System.Drawing.Graphics]$Graphics, [System.Drawing.Bitmap]$Source, [int]$X, [int]$Y, [int]$Width, [int]$Height)
  $Graphics.DrawImage($Source, [System.Drawing.Rectangle]::new($X, $Y, $Width, $Height), [System.Drawing.Rectangle]::new(0, 0, $Source.Width, $Source.Height), [System.Drawing.GraphicsUnit]::Pixel)
}

function Render-Texture {
  param(
    [System.Drawing.Bitmap]$Source,
    [int]$Width,
    [int]$Height,
    [int]$Inset = 0
  )
  $bounds = [System.Drawing.Rectangle]::new(
    $Inset,
    $Inset,
    [Math]::Max(1, $Source.Width - ($Inset * 2)),
    [Math]::Max(1, $Source.Height - ($Inset * 2))
  )
  $result = New-TransparentBitmap $Width $Height
  $graphics = New-PixelGraphics $result
  try {
    $graphics.DrawImage($Source, [System.Drawing.Rectangle]::new(0, 0, $Width, $Height), $bounds, [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $graphics.Dispose()
  }
  return $result
}

function Render-Shifted {
  param(
    [System.Drawing.Bitmap]$Source,
    [int]$Width,
    [int]$Height,
    [int]$ShiftX,
    [int]$ShiftY
  )
  $result = New-TransparentBitmap $Width $Height
  $graphics = New-PixelGraphics $result
  try {
    $graphics.DrawImage($Source, [System.Drawing.Rectangle]::new($ShiftX, $ShiftY, $Width, $Height), [System.Drawing.Rectangle]::new(0, 0, $Source.Width, $Source.Height), [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $graphics.Dispose()
  }
  return $result
}

# Runtime files are overwritten in place so project-owned references under
# characters/ref are never erased by an asset rebuild.
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$tileAtlas = [System.Drawing.Bitmap]::FromFile((Join-Path $inputRoot "tile-atlas.png"))
$furnitureAtlas = [System.Drawing.Bitmap]::FromFile((Join-Path $inputRoot "furniture-atlas-v2.png"))
$decorAtlas = [System.Drawing.Bitmap]::FromFile((Join-Path $inputRoot "decor-atlas-v2.png"))
$petAtlas = [System.Drawing.Bitmap]::FromFile((Join-Path $inputRoot "pet-atlas.png"))

try {
  # Runtime images use a 2x pixel density. The world still consumes 16px
  # logical tiles, but at the default 2x world zoom each source pixel maps to
  # one screen pixel instead of being enlarged and losing facial/furniture
  # detail.
  # Floors: nine 32x32 variants sampled from the generated 8x8 tile atlas.
  $floorCells = @(
    @(0, 0), @(1, 0), @(2, 0),
    @(0, 1), @(2, 1), @(0, 2),
    @(1, 2), @(0, 3), @(1, 3)
  )
  for ($index = 0; $index -lt $floorCells.Count; $index += 1) {
    $cell = Get-GridCell $tileAtlas 8 8 $floorCells[$index][0] $floorCells[$index][1]
    # Crop the atlas divider before scaling so adjacent runtime tiles touch
    # with no transparent margin or visible source-cell gutter.
    $floor = Render-Texture $cell 32 32 4
    Save-Png $floor (Join-Path $outputRoot "floors\floor_$index.png")
    $cell.Dispose()
  }

  # A small wall atlas assembled from the generated slate and brick tiles.
  $wall = New-TransparentBitmap 128 256
  $wallGraphics = New-PixelGraphics $wall
  try {
    for ($row = 0; $row -lt 8; $row += 1) {
      for ($column = 0; $column -lt 4; $column += 1) {
        $sourceRow = if ($row -lt 4) { 6 } else { 5 }
        $cell = Get-GridCell $tileAtlas 8 8 (($column + $row) % 8) $sourceRow
        $texture = Render-Texture $cell 32 32 4
        Draw-Into $wallGraphics $texture ($column * 32) ($row * 32) 32 32
        $texture.Dispose()
        $cell.Dispose()
      }
    }
  } finally {
    $wallGraphics.Dispose()
  }
  Save-Png $wall (Join-Path $outputRoot "walls\wall_0.png")

  # Use the reviewed complete rug, not a patchwork of unrelated floor tiles.
  for ($index = 0; $index -lt 3; $index += 1) {
    $carpet = New-TransparentBitmap 128 128
    $carpetGraphics = New-PixelGraphics $carpet
    try {
      $cell = Get-PropCell $furnitureAtlas 'furniture' 2 2
      $rug = Render-Fit $cell 128 128 -Trim
      Draw-Into $carpetGraphics $rug 0 0 128 128
      $rug.Dispose()
      $cell.Dispose()
    } finally {
      $carpetGraphics.Dispose()
    }
    Save-Png $carpet (Join-Path $outputRoot "carpets\carpet_$index.png")
  }

  # Copy the reviewed 2-frame x 4-state character sheets, preserving authored
  # poses and alpha channels exactly.
  $characterOutput = Join-Path $outputRoot "characters"
  $characterSource = Join-Path $inputRoot "characters"
  New-Item -ItemType Directory -Force -Path $characterOutput | Out-Null
  for ($character = 0; $character -lt 5; $character += 1) {
    Copy-Item -LiteralPath (Join-Path $characterSource "char_$character.png") -Destination (Join-Path $characterOutput "char_$character.png") -Force
  }

  # Furniture and decor keep their logical footprints, but are exported at
  # twice the pixel density so Canvas can draw them 1:1 at the default zoom.
  # The cactus slot intentionally receives the generated flowering plant so no
  # original cactus artwork remains.
  $furnitureMappings = @(
    @{ Path = "DESK\DESK_FRONT.png"; Source = $furnitureAtlas; Columns = 3; Rows = 3; Column = 0; Row = 0; Width = 96; Height = 64 },
    @{ Path = "PC\PC_FRONT_OFF.png"; Source = $furnitureAtlas; Columns = 3; Rows = 3; Column = 2; Row = 1; Width = 64; Height = 48 },
    @{ Path = "CUSHIONED_CHAIR\CUSHIONED_CHAIR_FRONT.png"; Source = $furnitureAtlas; Columns = 3; Rows = 3; Column = 1; Row = 0; Width = 32; Height = 32 },
    @{ Path = "SOFA\SOFA_FRONT.png"; Source = $furnitureAtlas; Columns = 3; Rows = 3; Column = 2; Row = 0; Width = 64; Height = 48 },
    @{ Path = "SOFA\SOFA_BACK.png"; Source = $furnitureAtlas; Columns = 3; Rows = 3; Column = 0; Row = 1; Width = 64; Height = 48 },
    @{ Path = "COFFEE_TABLE\COFFEE_TABLE.png"; Source = $furnitureAtlas; Columns = 3; Rows = 3; Column = 1; Row = 1; Width = 64; Height = 48 },
    @{ Path = "WHITEBOARD\WHITEBOARD.png"; Source = $decorAtlas; Columns = 4; Rows = 2; Column = 0; Row = 0; Width = 64; Height = 64 },
    @{ Path = "DOUBLE_BOOKSHELF\DOUBLE_BOOKSHELF.png"; Source = $decorAtlas; Columns = 4; Rows = 2; Column = 1; Row = 0; Width = 64; Height = 64 },
    @{ Path = "PLANT\PLANT.png"; Source = $decorAtlas; Columns = 4; Rows = 2; Column = 2; Row = 0; Width = 32; Height = 64 },
    @{ Path = "LARGE_PLANT\LARGE_PLANT.png"; Source = $decorAtlas; Columns = 4; Rows = 2; Column = 3; Row = 0; Width = 64; Height = 96 },
    @{ Path = "PLANT_2\PLANT_2.png"; Source = $decorAtlas; Columns = 4; Rows = 2; Column = 0; Row = 1; Width = 32; Height = 64 },
    @{ Path = "FLOWER\FLOWER.png"; Source = $decorAtlas; Columns = 4; Rows = 2; Column = 3; Row = 1; Width = 32; Height = 64 },
    @{ Path = "COFFEE\COFFEE.png"; Source = $decorAtlas; Columns = 4; Rows = 2; Column = 2; Row = 1; Width = 32; Height = 32 },
    @{ Path = "CLOCK\CLOCK.png"; Source = $decorAtlas; Columns = 4; Rows = 2; Column = 1; Row = 1; Width = 32; Height = 32 }
  )
  foreach ($mapping in $furnitureMappings) {
    $kind = if ($mapping.Source -eq $furnitureAtlas) { 'furniture' } else { 'decor' }
    $cell = Get-PropCell $mapping.Source $kind $mapping.Column $mapping.Row
    $asset = Render-Fit $cell $mapping.Width $mapping.Height -Trim
    Save-Png $asset (Join-Path $outputRoot ("furniture\" + $mapping.Path))
    $cell.Dispose()
  }
  for ($frame = 1; $frame -le 3; $frame += 1) {
    $cell = Get-PropCell $furnitureAtlas 'furniture' (($frame - 1) % 2) 2
    $asset = Render-Fit $cell 64 48 -Trim
    Save-Png $asset (Join-Path $outputRoot ("furniture\PC\PC_FRONT_ON_$frame.png"))
    $cell.Dispose()
  }

  # Pets: the generated source contains two 5x6 regions. Export both into
  # the existing 6x6, 16px-frame contract and repeat the last source frame
  # into column six to keep all runtime states addressable.
  $petRegionWidth = [Math]::Floor($petAtlas.Width / 2)
  for ($petIndex = 0; $petIndex -lt 2; $petIndex += 1) {
    $sheet = New-TransparentBitmap 192 192
    $sheetGraphics = New-PixelGraphics $sheet
    try {
      for ($row = 0; $row -lt 6; $row += 1) {
        for ($frame = 0; $frame -lt 6; $frame += 1) {
          $sourceColumn = [Math]::Min($frame, 4)
          $cell = Get-GridCell $petAtlas 5 6 $sourceColumn $row ($petIndex * $petRegionWidth) 0 $petRegionWidth $petAtlas.Height
          $sprite = Render-Fit $cell 32 32 -Trim
          Draw-Into $sheetGraphics $sprite ($frame * 32) ($row * 32) 32 32
          $sprite.Dispose()
          $cell.Dispose()
        }
      }
    } finally {
      $sheetGraphics.Dispose()
    }
    $petName = if ($petIndex -eq 0) { "claudio" } else { "gitcat" }
    Save-Png $sheet (Join-Path $outputRoot ("pets\$petName\pet.png"))
  }

  $manifest = [ordered]@{
    version = 3
    source = "Original assets generated for Auto Codex"
    generatedAt = "2026-10-25"
    tileSize = 16
    characterSheet = "512x1024; 2 columns x 4 rows; 256x256 frames; states are idle, moving, working, thinking"
    petSheet = "192x192; 6 columns x 6 rows; 32x32 frames; 2x runtime pixel density"
    replacements = [ordered]@{
      cactus = "flower"
      pixelAgentsRuntimeAssets = $false
    }
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $outputRoot "manifest.json")
} finally {
  $tileAtlas.Dispose()
  $furnitureAtlas.Dispose()
  $decorAtlas.Dispose()
  $petAtlas.Dispose()
}

Write-Output "Generated pixel assets in $outputRoot"
