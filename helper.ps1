# Glass Widgets background helper: ONE PowerShell process for everything that
# needs Windows APIs (one process instead of four saves a lot of memory).
#
# Prints lines "<kind> <json>" whenever something changes:
#   bt     Bluetooth devices: [{id, name, connected, battery, cod, le}]   (every 4 s)
#   audio  playback devices: [{id, name, default}]                        (every 2 s)
# Reads commands from stdin:
#   pin <hwnd>         keep a window on the desktop layer
#   audio-set <id>     make a playback device the default
# It only reads system state, except for the two commands above.

$ErrorActionPreference = 'SilentlyContinue'
# Background helper: never compete with the widgets' animations for the CPU
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)   # no BOM
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)

# ===== Desktop layer =====
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DesktopPin {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr FindWindow(string cls, string name);

  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
  static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);

  [DllImport("user32.dll")]
  static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

  const int GWLP_HWNDPARENT = -8;
  static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
  const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;

  public static void Pin(long handle) {
    IntPtr hwnd = new IntPtr(handle);
    IntPtr desktop = FindWindow("Progman", null);
    if (desktop != IntPtr.Zero) SetWindowLongPtr(hwnd, GWLP_HWNDPARENT, desktop);
    SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  }
}
'@

# ===== DualSense battery =====
# Windows has no battery property for PlayStation controllers; Steam reads it from the
# controller's own input reports. Same here, read-only: open the HID device (shared),
# read a few input reports and take the status byte (layout as in Linux hid-playstation).
# Over Bluetooth the battery is only in the extended 0x31 report, which the controller
# sends after a program like Steam has switched it on; we never switch it ourselves
# (that would stop DirectInput games from seeing the controller).
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class DualSense {
  [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr enumerator, IntPtr hwnd, int flags);
  [DllImport("setupapi.dll", SetLastError = true)]
  static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr info, ref Guid g, int index, ref SP_DEVICE_INTERFACE_DATA data);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, int size, out int required, IntPtr info);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);

  [StructLayout(LayoutKind.Sequential)]
  struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }

  public static bool Charging;

  // Battery 0-100 of the first DualSense / DualSense Edge that reports it, or -1
  public static int Battery() {
    Guid g; HidD_GetHidGuid(out g);
    IntPtr set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, 0x12); // PRESENT | DEVICEINTERFACE
    if (set == new IntPtr(-1)) return -1;
    try {
      for (int i = 0; i < 256; i++) {
        SP_DEVICE_INTERFACE_DATA d = new SP_DEVICE_INTERFACE_DATA();
        d.cbSize = Marshal.SizeOf(d);
        if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d)) break;
        int req;
        SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out req, IntPtr.Zero);
        if (req <= 0) continue;
        IntPtr buf = Marshal.AllocHGlobal(req);
        string path;
        try {
          Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
          if (!SetupDiGetDeviceInterfaceDetail(set, ref d, buf, req, out req, IntPtr.Zero)) continue;
          path = Marshal.PtrToStringUni(IntPtr.Add(buf, 4));
        } finally { Marshal.FreeHGlobal(buf); }
        string p = (path ?? "").ToLowerInvariant();
        if (p.IndexOf("054c") < 0 || (p.IndexOf("0ce6") < 0 && p.IndexOf("0df2") < 0)) continue;
        int level = ReadLevel(path);
        if (level >= 0) return level;
      }
    } finally { SetupDiDestroyDeviceInfoList(set); }
    return -1;
  }

  static int ReadLevel(string path) {
    // GENERIC_READ, share read+write, OPEN_EXISTING, FILE_FLAG_OVERLAPPED
    SafeFileHandle h = CreateFile(path, 0x80000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
    if (h.IsInvalid) return -1;
    try {
      using (FileStream fs = new FileStream(h, FileAccess.Read, 1024, true)) {
        byte[] b = new byte[1024];
        for (int k = 0; k < 6; k++) {
          IAsyncResult ar = fs.BeginRead(b, 0, b.Length, null, null);
          if (!ar.AsyncWaitHandle.WaitOne(400)) return -1; // controller asleep / not sending
          int n = fs.EndRead(ar);
          int status = -1;
          if (b[0] == 0x01 && n >= 54) status = b[53];        // USB: report 0x01, data starts at byte 1
          else if (b[0] == 0x31 && n >= 56) status = b[54];   // Bluetooth extended: data starts at byte 2
          if (status < 0) continue;
          int lvl = status & 0x0F, state = (status & 0xF0) >> 4;
          Charging = state == 1;
          if (state == 2) return 100;                        // full
          if (state == 0 || state == 1) return Math.Min(lvl * 10 + 5, 100);
        }
      }
    } catch { }
    return -1;
  }
}
'@

$dsCache = @{ at = [datetime]::MinValue; level = -1 }
$DS_EVERY_SECONDS = 60

# ===== Audio outputs =====
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace GlassWidgets {
  [StructLayout(LayoutKind.Sequential)]
  public struct PropertyKey { public Guid fmtid; public int pid; }

  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVariant {
    [FieldOffset(0)] public short vt;
    [FieldOffset(8)] public IntPtr pointerValue;
  }

  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out int count);
    int GetAt(int index, out PropertyKey key);
    int GetValue(ref PropertyKey key, out PropVariant value);
    int SetValue(ref PropertyKey key, ref PropVariant value);
    int Commit();
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IPropertyStore store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }

  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    int GetCount(out int count);
    int Item(int index, out IMMDevice device);
  }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    int RegisterEndpointNotificationCallback(IntPtr client);
    int UnregisterEndpointNotificationCallback(IntPtr client);
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator { }

  [Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicyConfig {
    int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr format);
    int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string device, bool isDefault, IntPtr format);
    int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string device);
    int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr endpointFormat, IntPtr mixFormat);
    int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string device, bool isDefault, IntPtr defaultPeriod, IntPtr minimumPeriod);
    int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr period);
    int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr mode);
    int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string device, IntPtr mode);
    int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string device, bool fxStore, IntPtr key, IntPtr value);
    int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string device, bool fxStore, IntPtr key, IntPtr value);
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string device, int role);
    int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string device, bool visible);
  }

  [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
  class PolicyConfigClient { }

  public class Output { public string Id; public string Name; public bool IsDefault; }

  public static class Audio {
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant pv);

    const int eRender = 0, DEVICE_STATE_ACTIVE = 1, STGM_READ = 0, VT_LPWSTR = 31;

    static string FriendlyName(IMMDevice dev) {
      IPropertyStore store;
      if (dev.OpenPropertyStore(STGM_READ, out store) != 0 || store == null) return null;
      var key = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
      PropVariant pv;
      if (store.GetValue(ref key, out pv) != 0) return null;
      string name = pv.vt == VT_LPWSTR ? Marshal.PtrToStringUni(pv.pointerValue) : null;
      PropVariantClear(ref pv);
      return name;
    }

    public static List<Output> List() {
      var list = new List<Output>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      string defId = null;
      IMMDevice def;
      if (en.GetDefaultAudioEndpoint(eRender, 0, out def) == 0 && def != null) def.GetId(out defId);
      IMMDeviceCollection col;
      if (en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out col) != 0) return list;
      int n; col.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IMMDevice dev; col.Item(i, out dev);
        string id; dev.GetId(out id);
        list.Add(new Output { Id = id, Name = FriendlyName(dev) ?? id, IsDefault = id == defId });
      }
      return list;
    }

    public static bool SetDefault(string id) {
      var policy = (IPolicyConfig)new PolicyConfigClient();
      bool ok = true;
      for (int role = 0; role < 3; role++) ok &= policy.SetDefaultEndpoint(id, role) == 0;
      return ok;
    }
  }
}
'@

# ===== Bluetooth =====
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

function Get-BtJson {
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

  # One headset can show up as several devices, one per channel
  # ("INZONE Buds - Game" + "INZONE Buds - Chat", over Bluetooth LE Audio or USB):
  # show it once. Only names with such a suffix are merged, so two identical
  # mice still show up as two.
  $byName = [ordered]@{}
  $list = @()
  foreach ($d in @($devices.Values | Where-Object { $_.name } | Sort-Object { $_.id })) {
    $base = ($d.name -replace '\s*[-\u2013\u2014]\s*(Chat|Game|Voice)$', '').Trim()
    $isChannel = $base -ne $d.name -or $d.id -like 'USB-*'
    if (-not $isChannel) { $list += $d; continue }
    $d.name = $base
    $k = $byName[$base.ToLower()]
    if (-not $k) { $byName[$base.ToLower()] = $d; $list += $d; continue }
    if ($d.connected) { $k.connected = $true }
    if ($d.battery -ne $null -and ($k.battery -eq $null -or $d.battery -gt $k.battery)) { $k.battery = $d.battery }
    if (-not $k.cod) { $k.cod = $d.cod }
  }
  # PlayStation controllers: read the battery the way Steam does (see DualSense above)
  $ds = @($list | Where-Object { $_.connected -and $_.battery -eq $null -and $_.name -match 'DualSense|Wireless Controller' })
  if ($ds.Count -gt 0) {
    $now = Get-Date
    if (($now - $script:dsCache.at).TotalSeconds -ge $DS_EVERY_SECONDS) {
      $lvl = -1
      try { $lvl = [DualSense]::Battery() } catch {}
      $script:dsCache = @{ at = $now; level = $lvl }
    }
    if ($script:dsCache.level -ge 0) { foreach ($d in $ds) { $d.battery = $script:dsCache.level } }
  }
  $json = ConvertTo-Json -InputObject $list -Compress -Depth 3
  if (-not $json) { $json = '[]' }
  return $json
}

function Get-AudioJson {
  $list = @([GlassWidgets.Audio]::List() | ForEach-Object { [ordered]@{ id = $_.Id; name = $_.Name; default = $_.IsDefault } })
  $json = ConvertTo-Json -InputObject $list -Compress -Depth 3
  if (-not $json) { $json = '[]' }
  return $json
}

# ===== Stdin reader =====
# [Console]::In.ReadLineAsync() blocks in Windows PowerShell 5.1, so read stdin on a
# background thread and let the main loop pick up finished lines without waiting.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Text;
using System.Threading;
public static class StdinPump {
  static readonly ConcurrentQueue<string> lines = new ConcurrentQueue<string>();
  static volatile bool closed;
  public static bool Closed { get { return closed && lines.IsEmpty; } }
  public static void Start() {
    var t = new Thread(() => {
      try {
        var r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string l;
        while ((l = r.ReadLine()) != null) lines.Enqueue(l);
      } catch {}
      closed = true;
    });
    t.IsBackground = true;
    t.Start();
  }
  public static string Next() { string l; return lines.TryDequeue(out l) ? l : null; }
}
'@
[StdinPump]::Start()

# ===== Main loop =====
$last = @{ bt = ''; audio = '' }
$due = @{ bt = [datetime]::MinValue; audio = [datetime]::MinValue }
function Emit([string]$kind, [string]$json) {
  if ($json -and $json -ne $last[$kind]) {
    [Console]::Out.WriteLine("$kind $json")
    [Console]::Out.Flush()
    $last[$kind] = $json
  }
}

while ($true) {
  # Commands from main.js (checked often so pinning feels instant)
  if ([StdinPump]::Closed) { exit }   # main.js went away
  while (($line = [StdinPump]::Next()) -ne $null) {
    if ($line -match '^pin (\d+)$') {
      try { [DesktopPin]::Pin([long]$Matches[1]) } catch {}
    } elseif ($line -match '^audio-set (.+)$') {
      try { $null = [GlassWidgets.Audio]::SetDefault($Matches[1].Trim()) } catch {}
      $due.audio = [datetime]::MinValue   # report the new default right away
    }
  }

  $now = Get-Date
  if ($now -ge $due.audio) { try { Emit 'audio' (Get-AudioJson) } catch {}; $due.audio = $now.AddSeconds(2) }
  if ($now -ge $due.bt)    { try { Emit 'bt' (Get-BtJson) } catch {}; $due.bt = (Get-Date).AddSeconds($POLL_SECONDS) }
  Start-Sleep -Milliseconds 150
}
