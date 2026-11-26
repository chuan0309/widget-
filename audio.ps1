# Audio outputs (playback devices) for Glass Widgets.
#
# - Every 2 seconds prints one JSON line when the list changes:
#   [{"id": "...", "name": "Speakers (Realtek)", "default": true}, ...]
# - Reads commands from stdin:  set <device id>   -> make it the default output
#   (for all roles: console, multimedia and communications)
#
# Windows has no public API to change the default output device. This uses the
# same undocumented-but-stable IPolicyConfig COM interface that tools such as
# SoundSwitch and AudioDeviceCmdlets use.

$ErrorActionPreference = 'SilentlyContinue'
# Background helper: never compete with the widgets' animations for the CPU
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)   # no BOM
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)

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

$last = ''
$readTask = [Console]::In.ReadLineAsync()
while ($true) {
  # Commands from main.js
  while ($readTask.IsCompleted) {
    $line = $readTask.Result
    if ($line -eq $null) { exit }   # main.js went away
    if ($line -match '^set (.+)$') {
      $ok = [GlassWidgets.Audio]::SetDefault($Matches[1].Trim())
      [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ type = 'set'; ok = $ok }))
      [Console]::Out.Flush()
      $last = ''   # report the new state right away
    }
    $readTask = [Console]::In.ReadLineAsync()
  }

  $list = @([GlassWidgets.Audio]::List() | ForEach-Object { [ordered]@{ id = $_.Id; name = $_.Name; default = $_.IsDefault } })
  $json = ConvertTo-Json -InputObject $list -Compress -Depth 3
  if (-not $json) { $json = '[]' }
  if ($json -ne $last) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $last = $json
  }
  Start-Sleep -Milliseconds 2000
}
