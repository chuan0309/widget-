# Asks the Windows location service where this computer is (once) and prints
# one JSON line: {"ok":true,"lat":..,"lon":..,"acc":..} or {"ok":false,...}.
# Needs Settings > Privacy & security > Location > "Let desktop apps access
# your location" to be on; otherwise main.js falls back to IP-based location.

$ErrorActionPreference = 'SilentlyContinue'
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal'
Add-Type -AssemblyName System.Device

$watcher = New-Object System.Device.Location.GeoCoordinateWatcher('Default')
$null = $watcher.TryStart($false, [TimeSpan]::FromSeconds(10))

$deadline = (Get-Date).AddSeconds(12)
while ($watcher.Status -ne 'Ready' -and $watcher.Status -ne 'Disabled' -and
       $watcher.Permission -ne 'Denied' -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 250
}

$loc = $watcher.Position.Location
if ($watcher.Status -eq 'Ready' -and $loc -and -not $loc.IsUnknown) {
  $out = @{ ok = $true; lat = $loc.Latitude; lon = $loc.Longitude; acc = $loc.HorizontalAccuracy }
} else {
  $out = @{ ok = $false; status = "$($watcher.Status)"; permission = "$($watcher.Permission)" }
}
$watcher.Stop()
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $out -Compress))
