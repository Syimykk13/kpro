param(
  [ValidateSet("Server", "Local")]
  [string]$Mode = "Server"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PortableElectronExe = Join-Path $ProjectRoot ".runtime\electron\electron.exe"
$PortableElectronDistExe = Join-Path $ProjectRoot ".runtime\electron\dist\electron.exe"
$ProjectElectronExe = Join-Path $ProjectRoot "node_modules\electron\dist\electron.exe"
$ElectronExe = if (Test-Path $PortableElectronExe) {
  $PortableElectronExe
} elseif (Test-Path $PortableElectronDistExe) {
  $PortableElectronDistExe
} else {
  $ProjectElectronExe
}
$DistMain = Join-Path $ProjectRoot "dist-electron\electron\main.js"
$DistIndex = Join-Path $ProjectRoot "dist\index.html"
$LogDir = Join-Path $env:APPDATA "kassa-pro-desktop"
$LogFile = Join-Path $LogDir "kassa-pro-launcher.log"

function Write-LauncherLog($Message) {
  try {
    New-Item -ItemType Directory -Path $LogDir -Force -ErrorAction Stop | Out-Null
    Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format o) $Message" -Encoding UTF8 -ErrorAction Stop
  } catch {
    # Лог запуска полезен, но он не должен мешать открыть кассу.
  }
}

try {
  Write-LauncherLog "start project=$ProjectRoot"

  if ($Mode -eq "Local") {
    $env:KASSA_PRO_SERVER_URL = ""
    $env:KASSA_PRO_MODE = "local"
    $env:KASSA_PRO_DATA_DIR = Join-Path $env:APPDATA "kassa-pro-desktop-local"
  } else {
    $env:KASSA_PRO_MODE = "server"
    $env:KASSA_PRO_DATA_DIR = Join-Path $env:APPDATA "kassa-pro-desktop-server"
  }

  if ($Mode -eq "Server" -and [string]::IsNullOrWhiteSpace($env:KASSA_PRO_SERVER_URL)) {
    $env:KASSA_PRO_SERVER_URL = "http://132.243.114.107:5173"
  }
  Write-LauncherLog "mode=$Mode server=$env:KASSA_PRO_SERVER_URL data=$env:KASSA_PRO_DATA_DIR"

  if (!(Test-Path $ElectronExe)) {
    throw "Не найден Electron: $ElectronExe"
  }

  if (!(Test-Path $DistMain) -or !(Test-Path $DistIndex)) {
    throw "Касса не собрана. Запустите npm run build один раз в папке проекта."
  }

  Start-Process -FilePath $ElectronExe -ArgumentList @(".") -WorkingDirectory $ProjectRoot
  Write-LauncherLog "electron started"
  exit 0
} catch {
  Write-LauncherLog "error $($_.Exception.Message)"
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    $_.Exception.Message,
    "КАССА-ПРО: ошибка запуска",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
