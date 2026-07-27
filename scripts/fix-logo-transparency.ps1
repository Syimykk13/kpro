Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$PublicDir = Join-Path $ProjectRoot "public"
$LogoBase = Join-Path $PublicDir "k-pro-logo.png"
$Targets = @(
  (Join-Path $PublicDir "k-pro-logo.png"),
  (Join-Path $PublicDir "k-pro-logo-192.png"),
  (Join-Path $PublicDir "k-pro-logo-256.png"),
  (Join-Path $PublicDir "k-pro-logo-512.png")
)

function Test-BackgroundPixel([System.Drawing.Color]$Color) {
  if ($Color.A -lt 10) { return $true }
  $max = [Math]::Max($Color.R, [Math]::Max($Color.G, $Color.B))
  $min = [Math]::Min($Color.R, [Math]::Min($Color.G, $Color.B))
  return ($Color.R -ge 238 -and $Color.G -ge 238 -and $Color.B -ge 238 -and ($max - $min) -le 18)
}

function Remove-EdgeBackground([string]$Path) {
  $source = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $bmp = New-Object System.Drawing.Bitmap $source.Width, $source.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $graphics.DrawImage($source, 0, 0, $source.Width, $source.Height)
    } finally {
      $graphics.Dispose()
    }
  } finally {
    $source.Dispose()
  }

  $width = $bmp.Width
  $height = $bmp.Height
  $visited = New-Object 'bool[,]' $width, $height
  $queue = New-Object System.Collections.Generic.Queue[object]
  $enqueue = {
    param([int]$x, [int]$y)
    if ($x -lt 0 -or $y -lt 0 -or $x -ge $width -or $y -ge $height -or $visited[$x, $y]) { return }
    $visited[$x, $y] = $true
    $color = $bmp.GetPixel($x, $y)
    if (Test-BackgroundPixel $color) {
      $queue.Enqueue(@($x, $y))
    }
  }

  for ($x = 0; $x -lt $width; $x++) {
    & $enqueue $x 0
    & $enqueue $x ($height - 1)
  }
  for ($y = 0; $y -lt $height; $y++) {
    & $enqueue 0 $y
    & $enqueue ($width - 1) $y
  }

  while ($queue.Count -gt 0) {
    $point = $queue.Dequeue()
    $x = [int]$point[0]
    $y = [int]$point[1]
    $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 255, 255, 255))
    & $enqueue ($x + 1) $y
    & $enqueue ($x - 1) $y
    & $enqueue $x ($y + 1)
    & $enqueue $x ($y - 1)
  }

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function Save-ResizedPng([string]$SourcePath, [string]$DestPath, [int]$Size) {
  $source = [System.Drawing.Bitmap]::FromFile($SourcePath)
  try {
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $graphics.Clear([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($source, 0, 0, $Size, $Size)
    } finally {
      $graphics.Dispose()
    }
    $bmp.Save($DestPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  } finally {
    $source.Dispose()
  }
}

function Write-PngIco([string]$Path, [string[]]$PngPaths) {
  $images = New-Object System.Collections.Generic.List[byte[]]
  foreach ($pngPath in $PngPaths) {
    $images.Add([IO.File]::ReadAllBytes($pngPath))
  }
  $stream = [IO.File]::Create($Path)
  $writer = New-Object IO.BinaryWriter $stream
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$images.Count)
    $offset = 6 + (16 * $images.Count)
    for ($i = 0; $i -lt $images.Count; $i++) {
      $pngPath = $PngPaths[$i]
      $bmp = [System.Drawing.Bitmap]::FromFile($pngPath)
      try {
        $size = $bmp.Width
      } finally {
        $bmp.Dispose()
      }
      $icoSize = if ($size -ge 256) { 0 } else { $size }
      $writer.Write([byte]$icoSize)
      $writer.Write([byte]$icoSize)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$images[$i].Length)
      $writer.Write([UInt32]$offset)
      $offset += $images[$i].Length
    }
    foreach ($image in $images) {
      $writer.Write($image)
    }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

foreach ($target in $Targets) {
  Remove-EdgeBackground $target
}

$icon64 = Join-Path $PublicDir "k-pro-logo-64.tmp.png"
Save-ResizedPng (Join-Path $PublicDir "k-pro-logo-256.png") $icon64 64
Write-PngIco (Join-Path $PublicDir "k-pro-logo.ico") @($icon64, (Join-Path $PublicDir "k-pro-logo-192.png"), (Join-Path $PublicDir "k-pro-logo-256.png"))
Copy-Item -LiteralPath (Join-Path $PublicDir "k-pro-logo.ico") -Destination (Join-Path $PublicDir "favicon.ico") -Force
Remove-Item -LiteralPath $icon64 -Force

Write-Output "Logo transparency fixed."
