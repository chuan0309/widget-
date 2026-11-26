# Phone Link notifications for Glass Widgets.
#
# Phone Link shows the phone's notifications as Windows notifications. Windows
# keeps every notification that is in the Notification Center in its own
# database (%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db).
# This reads the ones that came from Phone Link, read-only, with the SQLite
# that ships with Windows (winsqlite3.dll), and prints one JSON line whenever
# the list changes (checked every 4 seconds).

$ErrorActionPreference = 'SilentlyContinue'
# Background helper: never compete with the widgets' animations for the CPU
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)   # no BOM

Add-Type -ReferencedAssemblies System.Xml -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Xml;

namespace GlassWidgets {
  public static class PhoneLink {
    const int SQLITE_OPEN_READONLY = 1, SQLITE_ROW = 100;

    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int sqlite3_busy_timeout(IntPtr db, int ms);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nBytes, out IntPtr stmt, IntPtr tail);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int sqlite3_step(IntPtr stmt);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)]
    static extern long sqlite3_column_int64(IntPtr stmt, int col);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)]
    static extern IntPtr sqlite3_column_blob(IntPtr stmt, int col);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int sqlite3_column_bytes(IntPtr stmt, int col);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int sqlite3_finalize(IntPtr stmt);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.StdCall)]
    static extern int sqlite3_close_v2(IntPtr db);

    static byte[] Utf8z(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }

    static byte[] Blob(IntPtr stmt, int col) {
      int n = sqlite3_column_bytes(stmt, col);
      IntPtr p = sqlite3_column_blob(stmt, col);
      var b = new byte[Math.Max(0, n)];
      if (n > 0 && p != IntPtr.Zero) Marshal.Copy(p, b, 0, n);
      return b;
    }

    static string Text(byte[] b) {
      if (b.Length >= 2 && b[1] == 0) return Encoding.Unicode.GetString(b);   // UTF-16
      return Encoding.UTF8.GetString(b);
    }

    static string Json(string s) {
      if (s == null) return "null";
      var sb = new StringBuilder("\"");
      foreach (char c in s) {
        switch (c) {
          case '"': sb.Append("\\\""); break;
          case '\\': sb.Append("\\\\"); break;
          case '\n': sb.Append("\\n"); break;
          case '\r': break;
          case '\t': sb.Append("\\t"); break;
          default:
            if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c); else sb.Append(c);
            break;
        }
      }
      return sb.Append('"').ToString();
    }

    // Returns a JSON array, or {"error": "..."} when the database can't be read.
    public static string Read(string path, int limit) {
      IntPtr db;
      if (sqlite3_open_v2(Utf8z(path), out db, SQLITE_OPEN_READONLY, IntPtr.Zero) != 0) {
        if (db != IntPtr.Zero) sqlite3_close_v2(db);
        return "{\"error\":\"open\"}";
      }
      sqlite3_busy_timeout(db, 1500);
      string sql =
        "SELECT n.Id, n.ArrivalTime, n.Payload FROM Notification n " +
        "JOIN NotificationHandler h ON h.RecordId = n.HandlerId " +
        "WHERE h.PrimaryId LIKE '%YourPhone%' AND n.Type = 'toast' " +
        "ORDER BY n.ArrivalTime DESC LIMIT " + limit;
      IntPtr stmt;
      if (sqlite3_prepare_v2(db, Utf8z(sql), -1, out stmt, IntPtr.Zero) != 0) {
        sqlite3_close_v2(db);
        return "{\"error\":\"query\"}";
      }
      var items = new List<string>();
      while (sqlite3_step(stmt) == SQLITE_ROW) {
        long id = sqlite3_column_int64(stmt, 0);
        long ft = sqlite3_column_int64(stmt, 1);
        long ms = ft > 116444736000000000L ? (ft - 116444736000000000L) / 10000 : 0;
        var texts = new List<string>();
        string app = null, logo = null;
        try {
          var doc = new XmlDocument();
          doc.LoadXml(Text(Blob(stmt, 2)).Trim('\0', '﻿', ' ', '\r', '\n'));
          foreach (XmlNode t in doc.SelectNodes("//text")) {
            string v = t.InnerText.Trim();
            if (v.Length == 0) continue;
            var placement = t.Attributes != null ? t.Attributes["placement"] : null;
            if (placement != null && placement.Value == "attribution") app = v;
            else texts.Add(v);
          }
          foreach (XmlNode img in doc.SelectNodes("//image")) {
            var p = img.Attributes != null ? img.Attributes["placement"] : null;
            var src = img.Attributes != null ? img.Attributes["src"] : null;
            if (src != null && (logo == null || (p != null && p.Value == "appLogoOverride"))) logo = src.Value;
          }
        } catch { continue; }
        var parts = new List<string>();
        foreach (var t in texts) parts.Add(Json(t));
        items.Add("{\"id\":" + id + ",\"time\":" + ms + ",\"app\":" + Json(app) +
                  ",\"texts\":[" + string.Join(",", parts) + "],\"logo\":" + Json(logo) + "}");
      }
      sqlite3_finalize(stmt);
      sqlite3_close_v2(db);
      return "[" + string.Join(",", items) + "]";
    }
  }
}
'@

$db = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Notifications\wpndatabase.db'
$last = ''
while ($true) {
  if (Test-Path $db) { $json = [GlassWidgets.PhoneLink]::Read($db, 20) } else { $json = '{"error":"notfound"}' }
  if ($json -ne $last) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $last = $json
  }
  Start-Sleep -Seconds 4
}
