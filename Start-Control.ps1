$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PortableNode = Join-Path $ProjectRoot ".runtime\node\node.exe"
$BundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$LocalNpm = Join-Path $ProjectRoot ".tools\npm\bin\npm-cli.js"
$AdminServer = Join-Path $ProjectRoot "scripts\admin-local.cjs"
$ControlUrl = "http://localhost:5173/control/"
$HealthUrl = "http://127.0.0.1:5173/api/snapshot"
$ControlHealthUrl = "http://127.0.0.1:5173/control/"
$LogFile = Join-Path $ProjectRoot "control-launcher.log"

function Write-ControlLog {
  param([string]$Message)
  try {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  } catch {
  }
}

function Show-ControlError {
  param([string]$Message)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      $Message,
      "КАССА-ПРО: ошибка запуска контрольной панели",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {
    Write-Host $Message
  }
}

function Test-AdminServer {
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-ControlPage {
  try {
    $response = Invoke-WebRequest -Uri $ControlHealthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content.Contains("control-root")
  } catch {
    return $false
  }
}

function Wait-AdminServer {
  for ($i = 0; $i -lt 15; $i++) {
    if ((Test-AdminServer) -and (Test-ControlPage)) {
      return $true
    }
    Start-Sleep -Milliseconds 700
  }
  return $false
}

function Stop-ProjectAdminServer {
  try {
    $escapedRoot = $ProjectRoot.Replace("\", "\\")
    $processes = Get-CimInstance Win32_Process |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine -like "*admin-local.cjs*" -and
        ($_.CommandLine -like "*$ProjectRoot*" -or $_.CommandLine -like "*$escapedRoot*")
      }
    foreach ($process in $processes) {
      Write-ControlLog ("STOP_OLD_SERVER pid=" + $process.ProcessId)
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Write-ControlLog ("STOP_OLD_SERVER_FAILED " + $_.Exception.Message)
  }
}

function Start-ProjectAdminServer {
  $serverCommand = "& '$NodeExe' '$AdminServer'"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand) -WorkingDirectory $ProjectRoot -WindowStyle Hidden
  Write-ControlLog "SERVER_START_REQUESTED"
}

function Open-ControlBrowser {
  try {
    Start-Process $ControlUrl
    return
  } catch {
    Write-ControlLog ("AUTO_OPEN_FAILED " + $_.Exception.Message)
  }

  try {
    $openCommand = "/c start """" ""$ControlUrl"""
    Start-Process -FilePath "cmd.exe" -ArgumentList $openCommand -WindowStyle Hidden
  } catch {
    Write-ControlLog ("CMD_OPEN_FAILED " + $_.Exception.Message)
  }
}

Write-ControlLog ("START root=" + $ProjectRoot)
$NodeExe = if (Test-Path $PortableNode) { $PortableNode } else { $BundledNode }

if (Test-Path $NodeExe) {
  Write-ControlLog ("NODE " + $NodeExe)
  if ((Test-AdminServer) -and !(Test-ControlPage)) {
    Write-ControlLog "SERVER_WITHOUT_CONTROL_FOUND_RESTARTING"
    Stop-ProjectAdminServer
    Start-Sleep -Milliseconds 800
  }

  if (!(Test-AdminServer)) {
    try {
      Start-ProjectAdminServer
    } catch {
      Write-ControlLog ("SERVER_START_FAILED " + $_.Exception.Message)
      Show-ControlError ("Не удалось запустить локальный сервер контрольной панели.`n`n" + $_.Exception.Message)
      exit 1
    }
  }

  if (!(Wait-AdminServer)) {
    Write-ControlLog "SERVER_HEALTH_TIMEOUT"
    Show-ControlError "Контрольная панель не смогла запуститься на http://localhost:5173/control/. Закройте старую админку и запустите CONTROL-KASSA-PRO.bat еще раз."
    exit 1
  }

  Write-ControlLog "SERVER_READY"
  Open-ControlBrowser
  exit 0
}

if (Test-Path $LocalNpm) {
  Write-ControlLog "FALLBACK_NPM"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "npm run admin:dev") -WorkingDirectory $ProjectRoot
  Start-Sleep -Seconds 2
  Open-ControlBrowser
  exit 0
}

Write-ControlLog "NODE_NOT_FOUND"
Show-ControlError "Не найден Node.js для запуска контрольной панели."
exit 1
