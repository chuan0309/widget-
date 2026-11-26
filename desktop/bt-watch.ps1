# Polls Windows for paired Bluetooth devices and prints one JSON line
# (array of {id, name, connected, battery}) every time the state changes.
# Started and read by main.js; it never writes anything to the system.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# DEVPKEY values Windows exposes on Bluetooth device nodes
$KEY_CONNECTED = '{83DA6326-97A6-4088-9453-A1923F573B29} 15'
$KEY_BATTERY   = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'

function Get-Mac([string]$id) {
  if ($id -match 'DEV_([0-9A-F]{12})') { return $Matches[1] }
  if ($id -match '&([0-9A-F]{12})_C') { return $Matches[1] }
  return $null
}

$last = ''
while ($true) {
  $devices = @{}
  $nodes = @(Get-PnpDevice -Class Bluetooth | Where-Object { Get-Mac $_.InstanceId })

  if ($nodes.Count -gt 0) {
    $props = Get-PnpDeviceProperty -InstanceId ($nodes.InstanceId) -KeyName $KEY_CONNECTED, $KEY_BATTERY

    foreach ($n in $nodes) {
      $mac = Get-Mac $n.InstanceId
      if (-not $devices.ContainsKey($mac)) {
        $devices[$mac] = [ordered]@{ id = $mac; name = $null; connected = $false; battery = $null }
      }
      $d = $devices[$mac]
      # The DEV_ node carries the name people recognise; other nodes are services of it
      if ($n.InstanceId -match 'DEV_' -or -not $d.name) { $d.name = $n.FriendlyName }
    }

    foreach ($p in $props) {
      $mac = Get-Mac $p.InstanceId
      if (-not $mac -or -not $devices.ContainsKey($mac)) { continue }
      $d = $devices[$mac]
      if ($p.KeyName -eq $KEY_CONNECTED -and $p.Data -eq $true) { $d.connected = $true }
      if ($p.KeyName -eq $KEY_BATTERY -and $p.Data -ne $null) {
        $v = [int]$p.Data
        if ($v -ge 0 -and $v -le 100 -and ($d.battery -eq $null -or $v -gt $d.battery)) { $d.battery = $v }
      }
    }
  }

  $list = @($devices.Values | Where-Object { $_.name } | Sort-Object { $_.id })
  $json = ConvertTo-Json -InputObject $list -Compress -Depth 3
  if (-not $json) { $json = '[]' }
  if ($json -ne $last) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $last = $json
  }
  Start-Sleep -Seconds 3
}
