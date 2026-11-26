# Keeps widget windows on the desktop layer, like desktop widgets should be:
# below every normal window (Chrome etc. always cover them) and not hidden by
# Win+D. main.js writes one window handle (a number) per line to stdin.
#
# How: make the desktop window ("Progman") the owner of the widget window, then
# move it to the bottom of the z-order. An owned window always stays just above
# its owner, so the widget sits right on top of the desktop.

$ErrorActionPreference = 'SilentlyContinue'

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

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }   # main.js went away
  $h = 0L
  if ([long]::TryParse($line.Trim(), [ref]$h) -and $h -ne 0) {
    try { [DesktopPin]::Pin($h) } catch {}
  }
}
