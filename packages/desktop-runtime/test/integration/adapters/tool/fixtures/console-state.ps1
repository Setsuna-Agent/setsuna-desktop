param([Parameter(Mandatory = $true)][uint32]$TargetProcessId)
$ErrorActionPreference = 'Stop'
$output = [Console]::Out
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleProbe {
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList(uint[] ids, uint count);
}
'@
[void][ConsoleProbe]::FreeConsole()
if (-not [ConsoleProbe]::AttachConsole($TargetProcessId)) {
  throw [System.ComponentModel.Win32Exception]::new()
}
try {
  $ids = [uint32[]]::new(128)
  $count = [ConsoleProbe]::GetConsoleProcessList($ids, $ids.Length)
  $result = @{
    window = [ConsoleProbe]::GetConsoleWindow().ToInt64().ToString()
    processes = @($ids | Select-Object -First $count)
  } | ConvertTo-Json -Compress
} finally {
  [void][ConsoleProbe]::FreeConsole()
}
$output.WriteLine($result)
