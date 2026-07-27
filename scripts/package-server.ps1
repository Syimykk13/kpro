param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$Version = "1.1.2"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ReleaseRoot = Join-Path $ProjectRoot "release"
$Archive = Join-Path $ReleaseRoot "kassa-pro-server-$Version.tgz"
$NodeExe = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$NpmCli = Join-Path $ProjectRoot ".tools\npm\bin\npm-cli.js"

if (!$SkipBuild) {
  if ((Test-Path $NodeExe) -and (Test-Path $NpmCli)) {
    & $NodeExe $NpmCli run build
  } else {
    npm run build
  }
}

New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null
if (Test-Path $Archive) {
  Remove-Item -LiteralPath $Archive -Force
}

$include = @(
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.electron.json",
  "index.html",
  "cash",
  "admin",
  "control",
  "public",
  "src",
  "scripts"
) | Where-Object { Test-Path (Join-Path $ProjectRoot $_) }

Push-Location $ProjectRoot
try {
  & tar.exe -czf $Archive @include
  if ($LASTEXITCODE -ne 0) {
    throw "tar failed with code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$sizeMb = [Math]::Round((Get-Item $Archive).Length / 1MB, 2)
Write-Output "SERVER_ARCHIVE=$Archive"
Write-Output "SERVER_ARCHIVE_SIZE_MB=$sizeMb"
