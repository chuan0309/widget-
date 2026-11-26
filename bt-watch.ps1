# Watches paired Bluetooth devices (classic and Bluetooth LE) and prints one
# JSON line - an array of {id, name, connected, battery, cod, le} - whenever
# the state changes. Started and read by main.js; it only reads, never writes.
#
# Battery comes from two places:
#   1. The Windows device property that headsets report over Hands-Free
#      (most earbuds / headphones, many phones).
#   2. The standard GATT Battery Service (0x180F) on Bluetooth LE devices
#      (most mice, keyboards, newer controllers, some earbuds, iPhone).
#      Read through WinRT, at most once a minute per device.

$ErrorActionPreference = 'SilentlyContinue'
# Background helper: never compete with the widgets' animations for the CPU
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$KEY_CONNECTED = '{83DA6326-97A6-4088-9453-A1923F573B29} 15'
$KEY_BATTERY   = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$KEY_COD       = '{2BD67D8B-8BEB-48D5-87E0-6CDA3428040A} 10'   # Bluetooth Class of Device

$POLL_SECONDS = 4
$USB_HEADSETS = @('INZONE')   # name keywords of headsets that use their own USB receiver
$GATT_EVERY_SECONDS = 120

function Get-Mac([string]$id) {
  if ($id -match 'DEV_([0-9A-F]{12})(\\|$)') { return $Matches[1].ToUpper() }        # BTHENUM\DEV_x / BTHLE\DEV_x
  if ($id -match '&([0-9A-F]{12})_C') { return $Matches[1].ToUpper() }               # classic service nodes
  if ($id -match '^BTHLEDEVICE\\.*_([0-9A-F]{12})\\') { return $Matches[1].ToUpper() } # LE GATT service nodes
  return $null
}

# ----- WinRT helpers for the GATT battery read (Windows PowerShell 5.1) -----
$gattReady = $false
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $null = [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
  $null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
  $null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
  $null = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattReadResult, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
  if ($asTaskGeneric) { $gattReady = $true }
} catch { $gattReady = $false }

function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(5000)) { return $null }   # never hang the loop on a sleepy device
  return $task.Result
}

$BATTERY_SERVICE = [Guid]'0000180f-0000-1000-8000-00805f9b34fb'
$BATTERY_LEVEL   = [Guid]'00002a19-0000-1000-8000-00805f9b34fb'

function Read-GattBattery([string]$mac) {
  if (-not $gattReady) { return $null }
  $dev = $null
  try {
    $addr = [Convert]::ToUInt64($mac, 16)
    $dev = Await ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync($addr)) ([Windows.Devices.Bluetooth.BluetoothLEDevice])
    if (-not $dev) { return $null }
    # Cached: don't make the device re-discover its services (that can drop/redo the connection)
    $svcs = Await ($dev.GetGattServicesForUuidAsync($BATTERY_SERVICE, [Windows.Devices.Bluetooth.BluetoothCacheMode]::Cached)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult])
    if (-not $svcs -or $svcs.Services.Count -eq 0) { return $null }
    $svc = $svcs.Services[0]
    $chars = Await ($svc.GetCharacteristicsForUuidAsync($BATTERY_LEVEL, [Windows.Devices.Bluetooth.BluetoothCacheMode]::Cached)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult])
    $level = $null
    if ($chars -and $chars.Characteristics.Count -gt 0) {
      $read = Await ($chars.Characteristics[0].ReadValueAsync([Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattReadResult])
      if ($read -and $read.Value -and $read.Value.Length -ge 1) {
        $level = [int][Windows.Storage.Streams.DataReader]::FromBuffer($read.Value).ReadByte()
      }
    }
    foreach ($s in $svcs.Services) { try { $s.Dispose() } catch {} }
    if ($level -ne $null -and $level -ge 0 -and $level -le 100) { return $level }
  } catch {} finally {
    if ($dev) { try { $dev.Dispose() } catch {} }
  }
  return $null
}

$gattCache = @{}   # mac -> @{ at = [datetime]; level = int or $null }

# ----- Main loop -----
$last = ''
while ($true) {
  $devices = @{}
  $nodes = @(Get-PnpDevice -Class Bluetooth, BTHLEDevice | Where-Object { Get-Mac $_.InstanceId })

  if ($nodes.Count -gt 0) {
    $props = Get-PnpDeviceProperty -InstanceId ($nodes.InstanceId) -KeyName $KEY_CONNECTED, $KEY_BATTERY, $KEY_COD

    foreach ($n in $nodes) {
      $mac = Get-Mac $n.InstanceId
      if (-not $devices.ContainsKey($mac)) {
        $devices[$mac] = [ordered]@{ id = $mac; name = $null; connected = $false; battery = $null; cod = $null; le = $false }
      }
      $d = $devices[$mac]
      # The DEV_ node carries the name people recognise; other nodes are services of it
      $isRoot = $n.InstanceId -match '^(BTHENUM|BTHLE)\\DEV_'
      if ($isRoot -or -not $d.name) { $d.name = $n.FriendlyName }
      if ($n.InstanceId -match '^BTHLE') { $d.le = $true }
    }

    foreach ($p in $props) {
      $mac = Get-Mac $p.InstanceId
      if (-not $mac -or -not $devices.ContainsKey($mac)) { continue }
      $d = $devices[$mac]
      if ($p.KeyName -eq $KEY_CONNECTED -and $p.Data -eq $true) { $d.connected = $true }
      if ($p.KeyName -eq $KEY_COD -and $p.Data -ne $null -and -not $d.cod) { $d.cod = [int64]$p.Data }
      if ($p.KeyName -eq $KEY_BATTERY -and $p.Data -ne $null) {
        $v = [int]$p.Data
        if ($v -ge 0 -and $v -le 100 -and ($d.battery -eq $null -or $v -gt $d.battery)) { $d.battery = $v }
      }
    }

    # LE devices that are connected but have no battery yet: ask their Battery Service
    $now = Get-Date
    foreach ($d in $devices.Values) {
      if (-not $d.connected -or -not $d.le -or $d.battery -ne $null) { continue }
      $c = $gattCache[$d.id]
      if (-not $c -or ($now - $c.at).TotalSeconds -ge $GATT_EVERY_SECONDS) {
        $c = @{ at = $now; level = (Read-GattBattery $d.id) }
        $gattCache[$d.id] = $c
      }
      if ($c.level -ne $null) { $d.battery = $c.level }
    }
    # Forget cached readings of devices that were removed (keep them across short drops)
    foreach ($k in @($gattCache.Keys)) {
      if (-not $devices.ContainsKey($k)) { $gattCache.Remove($k) }
    }
  }

  # Some wireless headsets connect through their own USB receiver instead of
  # Bluetooth (e.g. Sony INZONE). They show up as audio devices; treat a
  # working audio device whose name matches as "connected". No battery there.
  foreach ($a in @(Get-PnpDevice -Class AudioEndpoint -PresentOnly | Where-Object { $_.Status -eq 'OK' })) {
    foreach ($k in $USB_HEADSETS) {
      if ($a.FriendlyName -notmatch [regex]::Escape($k)) { continue }
      $name = $a.FriendlyName
      # "Headphones (2- INZONE Buds)" -> "INZONE Buds"
      if ($name -match '\(([^()]*' + [regex]::Escape($k) + '[^()]*)\)') { $name = $Matches[1] }
      $name = ($name -replace '^\s*\d+\s*-\s*', '').Trim()
      # Game and chat channels are two audio devices of the same headset: "INZONE Buds - Chat" -> "INZONE Buds"
      $name = ($name -replace '\s*-\s*(Chat|Game|Voice)$', '').Trim()
      $id = 'USB-' + (($name -replace '[^A-Za-z0-9]', '').ToUpper())
      if (-not $devices.ContainsKey($id)) {
        $devices[$id] = [ordered]@{ id = $id; name = $name; connected = $true; battery = $null; cod = $null; le = $false }
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
  Start-Sleep -Seconds $POLL_SECONDS
}
