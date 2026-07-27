$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PortableNode = Join-Path $ProjectRoot ".runtime\node\node.exe"
$BundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$LocalNpm = Join-Path $ProjectRoot ".tools\npm\bin\npm-cli.js"
$AdminServer = Join-Path $ProjectRoot "scripts\admin-local.cjs"
$AdminPort = 5173
$AdminUrl = ""
$HealthUrl = ""
$LoginHealthUrl = ""
$LogDir = $ProjectRoot
$LogFile = Join-Path $LogDir "admin-launcher.log"
$LanInfoFile = Join-Path $ProjectRoot "ADMIN-ADRES.txt"

function Set-AdminPort {
  param([int]$Port)
  $script:AdminPort = $Port
  $script:AdminUrl = "http://localhost:$Port/admin/"
  $script:HealthUrl = "http://127.0.0.1:$Port/api/snapshot"
  $script:LoginHealthUrl = "http://127.0.0.1:$Port/api/admin-login"
}

Set-AdminPort -Port $AdminPort

function Write-AdminLog {
  param([string]$Message)
  try {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  } catch {
  }
}

function Show-AdminError {
  param([string]$Message)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      $Message,
      "КАССА-ПРО: ошибка запуска админки",
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

function Test-AdminLoginEndpoint {
  try {
    $response = Invoke-WebRequest -Uri $LoginHealthUrl -Method POST -ContentType "application/json" -Body '{"login":"__health__","password":"__health__"}' -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    try {
      $status = [int]$_.Exception.Response.StatusCode
      return ($status -eq 401 -or $status -eq 403)
    } catch {
      return $false
    }
  }
}

function Test-AdminReady {
  return ((Test-AdminServer) -and (Test-AdminLoginEndpoint))
}

function Stop-OldAdminServer {
  try {
    $escaped = $AdminServer.Replace("\", "\\")
    $processes = Get-CimInstance Win32_Process |
      Where-Object {
        $_.CommandLine -and
        ($_.CommandLine -like "*scripts*admin-local.cjs*" -or $_.CommandLine -like "*$AdminServer*") -and
        $_.ProcessId -ne $PID
      }
    foreach ($process in $processes) {
      Write-AdminLog ("STOP_OLD_SERVER pid=" + $process.ProcessId)
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 800
  } catch {
    Write-AdminLog ("STOP_OLD_SERVER_FAILED " + $_.Exception.Message)
  }
}

function Wait-AdminServer {
  for ($i = 0; $i -lt 15; $i++) {
    if (Test-AdminReady) {
      return $true
    }
    Start-Sleep -Milliseconds 700
  }
  return $false
}

function Open-AdminBrowser {
  try {
    Start-Process $AdminUrl
    return
  } catch {
    Write-AdminLog ("AUTO_OPEN_FAILED " + $_.Exception.Message)
  }

  try {
    $openCommand = "/c start """" ""$AdminUrl"""
    Start-Process -FilePath "cmd.exe" -ArgumentList $openCommand -WindowStyle Hidden
  } catch {
    Write-AdminLog ("CMD_OPEN_FAILED " + $_.Exception.Message)
  }
}

function Get-LanAdminUrls {
  $urls = @()
  try {
    $addresses = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
      Where-Object {
        $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
        !$_.IPAddressToString.StartsWith("127.") -and
        !$_.IPAddressToString.StartsWith("169.254.")
      } |
      ForEach-Object { $_.IPAddressToString } |
      Select-Object -Unique
    foreach ($address in $addresses) {
      $urls += "http://$address`:$AdminPort/admin/"
    }
  } catch {
    Write-AdminLog ("LAN_DETECT_FAILED " + $_.Exception.Message)
  }
  return $urls
}

function Write-LanInfo {
  try {
    $urls = Get-LanAdminUrls
    $text = @()
    $text += "KASSA-PRO Admin"
    $text += ""
    $text += "Na etom kompyutere:"
    $text += $AdminUrl
    $text += ""
    $text += "S telefona v toy zhe seti otkroyte:"
    if ($urls.Count -gt 0) {
      $text += $urls
    } else {
      $text += "LAN-adres ne nayden. Proverte podklyuchenie kompyutera k routeru."
    }
    $text += ""
    $text += "Esli telefon ne otkryvaet adres:"
    $text += "1. V Windows razreshite Node.js/PowerShell vo vhodiaschih podklyucheniyah firewall."
    $text += "2. Set Windows dolzhna byt Private/Chastnaya, ne Public/Obschedostupnaya."
    $text += "3. V routere otklyuchite izolaciyu Wi-Fi klientov/AP isolation."
    Set-Content -LiteralPath $LanInfoFile -Value $text -Encoding UTF8
    foreach ($url in $urls) {
      Write-AdminLog ("LAN_URL " + $url)
    }
  } catch {
    Write-AdminLog ("LAN_INFO_WRITE_FAILED " + $_.Exception.Message)
  }
}

Write-AdminLog ("START root=" + $ProjectRoot)
$NodeExe = if (Test-Path $PortableNode) { $PortableNode } else { $BundledNode }

if (Test-Path $NodeExe) {
  Write-AdminLog ("NODE " + $NodeExe)
  if ((Test-AdminServer) -and !(Test-AdminLoginEndpoint)) {
    Write-AdminLog "OLD_SERVER_DETECTED"
    Stop-OldAdminServer
    if ((Test-AdminServer) -and !(Test-AdminLoginEndpoint)) {
      Set-AdminPort -Port 5175
      Write-AdminLog "USING_FALLBACK_PORT 5175"
    }
  }
  if (!(Test-AdminServer)) {
    try {
      $serverCommand = "`$env:KASSA_PRO_ADMIN_PORT='$AdminPort'; & '$NodeExe' '$AdminServer'"
      Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand) -WorkingDirectory $ProjectRoot -WindowStyle Hidden
      Write-AdminLog "SERVER_START_REQUESTED"
    } catch {
      Write-AdminLog ("SERVER_START_FAILED " + $_.Exception.Message)
      Show-AdminError ("Не удалось запустить локальный сервер админки.`n`n" + $_.Exception.Message)
      exit 1
    }
  }

  if (!(Wait-AdminServer)) {
    Write-AdminLog "SERVER_HEALTH_TIMEOUT"
    Show-AdminError "Админка не смогла запуститься на http://localhost:5173/admin/. Попробуйте закрыть старые окна админки и запустить ADMIN-KASSA-PRO.bat еще раз."
    exit 1
  }

  Write-AdminLog "SERVER_READY"
  Write-LanInfo
  Open-AdminBrowser
  exit 0
}

if (Test-Path $LocalNpm) {
  Write-AdminLog "FALLBACK_NPM"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "npm run admin:dev") -WorkingDirectory $ProjectRoot
  exit 0
}

Write-AdminLog "NODE_NOT_FOUND"
Show-AdminError "Не найден Node.js для запуска локальной админки."
exit 1
