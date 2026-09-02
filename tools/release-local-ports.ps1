param(
  [int[]]$Ports = @(4780, 4781),
  [int]$TimeoutSeconds = 8
)

$ErrorActionPreference = "Stop"

function Get-Listeners {
  $listeners = @()
  foreach ($line in @(netstat.exe -ano -p tcp | Select-String "\sLISTENING\s")) {
    $parts = @($line.ToString() -split "\s+" | Where-Object { $_ })
    if ($parts.Count -lt 5) { continue }
    $localEndpoint = $parts[1]
    $portText = ($localEndpoint -split ":")[-1]
    $port = 0
    $ownerId = 0
    if (-not [int]::TryParse($portText, [ref]$port)) { continue }
    if (-not [int]::TryParse($parts[4], [ref]$ownerId)) { continue }
    if ($Ports -contains $port) {
      $listeners += [PSCustomObject]@{ LocalPort = $port; OwningProcess = $ownerId }
    }
  }
  return @($listeners | Where-Object { $_.OwningProcess -gt 0 } | Sort-Object OwningProcess, LocalPort -Unique)
}

$listeners = Get-Listeners
foreach ($listener in $listeners) {
  $ownerId = [int]$listener.OwningProcess
  try {
    $process = Get-Process -Id $ownerId -ErrorAction Stop
    Write-Host ("[Auto Codex] Stopping PID {0} ({1}) on local port {2}." -f $ownerId, $process.ProcessName, $listener.LocalPort)
    Stop-Process -Id $ownerId -Force -ErrorAction Stop
  } catch {
    throw ("Could not stop PID {0} listening on port {1}: {2}" -f $ownerId, $listener.LocalPort, $_.Exception.Message)
  }
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  $remaining = Get-Listeners
  if ($remaining.Count -eq 0) {
    Write-Host "[Auto Codex] Local ports 4780/4781 are available."
    exit 0
  }
  Start-Sleep -Milliseconds 150
} while ((Get-Date) -lt $deadline)

$portsStillBusy = ($remaining | Select-Object -ExpandProperty LocalPort -Unique) -join ", "
throw "Local port(s) still occupied after cleanup: $portsStillBusy"
