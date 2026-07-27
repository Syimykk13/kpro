param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$Targets = @(
  (Join-Path $env:APPDATA "kassa-pro-desktop"),
  (Join-Path $env:APPDATA "kassa-pro-desktop-server"),
  (Join-Path $env:APPDATA "kassa-pro-desktop-local")
)

$BackupRoot = Join-Path $env:APPDATA ("kassa-pro-test-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

$Moved = @()
foreach ($Target in $Targets) {
  if (Test-Path -LiteralPath $Target) {
    $Name = Split-Path -Leaf $Target
    $Destination = Join-Path $BackupRoot $Name
    Move-Item -LiteralPath $Target -Destination $Destination -Force
    $Moved += $Target
  }
}

if (!$Quiet) {
  if ($Moved.Count -gt 0) {
    Write-Host "Очищены тестовые данные кассы:"
    $Moved | ForEach-Object { Write-Host " - $_" }
    Write-Host "Резервная копия: $BackupRoot"
  } else {
    Write-Host "Локальные тестовые данные кассы не найдены. Создана пустая папка резервной копии: $BackupRoot"
  }
}
