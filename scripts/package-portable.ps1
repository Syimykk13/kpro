param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ReleaseRoot = Join-Path $ProjectRoot "release"
$PortableDir = Join-Path $ReleaseRoot "KASSA-PRO-Portable"
$ZipPath = Join-Path $ReleaseRoot "KASSA-PRO-Portable.zip"
$NodeExe = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$NpmCli = Join-Path $ProjectRoot ".tools\npm\bin\npm-cli.js"
$ElectronDist = Join-Path $ProjectRoot "node_modules\electron\dist"
$SqlJs = Join-Path $ProjectRoot "node_modules\sql.js"

function Get-FullPath($Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-WithinProject($Path) {
  $full = Get-FullPath $Path
  $root = (Get-FullPath $ProjectRoot).TrimEnd("\")
  if (!$full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch path outside project: $full"
  }
}

function Copy-Directory($Source, $Destination) {
  if (!(Test-Path $Source)) {
    throw "Missing source: $Source"
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

if (!$SkipBuild) {
  if ((Test-Path $NodeExe) -and (Test-Path $NpmCli)) {
    & $NodeExe $NpmCli run build
  } else {
    npm run build
  }
}

if (!(Test-Path $ElectronDist)) {
  throw "Electron runtime not found: $ElectronDist"
}
if (!(Test-Path $SqlJs)) {
  throw "sql.js runtime not found: $SqlJs"
}
if (!(Test-Path $NodeExe)) {
  throw "Portable Node.js runtime not found: $NodeExe"
}

Assert-WithinProject $ReleaseRoot
Assert-WithinProject $PortableDir
Assert-WithinProject $ZipPath

New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null
if (Test-Path $PortableDir) {
  Remove-Item -LiteralPath $PortableDir -Recurse -Force
}
if (Test-Path $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

New-Item -ItemType Directory -Path $PortableDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PortableDir ".runtime\electron") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PortableDir ".runtime\node") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PortableDir "scripts") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PortableDir "src\shared") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PortableDir "node_modules") -Force | Out-Null

Copy-Directory (Join-Path $ProjectRoot "dist") (Join-Path $PortableDir "dist")
Copy-Directory (Join-Path $ProjectRoot "dist-electron") (Join-Path $PortableDir "dist-electron")
Copy-Directory $ElectronDist (Join-Path $PortableDir ".runtime\electron")
Copy-Directory $SqlJs (Join-Path $PortableDir "node_modules\sql.js")

Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $PortableDir ".runtime\node\node.exe") -Force

$files = @(
  "KASSA-PRO.bat",
  "ADMIN-KASSA-PRO.bat",
  "CONTROL-KASSA-PRO.bat",
  "Start-Kassa.ps1",
  "Start-Admin.ps1",
  "Start-Control.ps1",
  "package.json",
  "README-PORTABLE.txt",
  "scripts\admin-local.cjs",
  "scripts\admin-data-utils.cjs",
  "src\shared\adminSeedData.json"
)

foreach ($file in $files) {
  $source = Join-Path $ProjectRoot $file
  $destination = Join-Path $PortableDir $file
  $destinationDir = Split-Path -Parent $destination
  New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

Compress-Archive -LiteralPath $PortableDir -DestinationPath $ZipPath -Force

$sizeMb = [Math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Write-Output "PORTABLE_DIR=$PortableDir"
Write-Output "ZIP=$ZipPath"
Write-Output "ZIP_SIZE_MB=$sizeMb"
