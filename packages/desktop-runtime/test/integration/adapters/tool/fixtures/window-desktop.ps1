param([Parameter(Mandatory = $true)][long]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WindowProbe {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder name, uint length, out uint needed);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
  public static string Desktop(uint thread) {
    return DesktopName(GetThreadDesktop(thread));
  }
  public static string InputDesktop() {
    var desktop = OpenInputDesktop(0, false, 1);
    if (desktop == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    try { return DesktopName(desktop); } finally { CloseDesktop(desktop); }
  }
  private static string DesktopName(IntPtr desktop) {
    var name = new StringBuilder(256); uint needed;
    if (!GetUserObjectInformation(desktop, 2, name, 512, out needed)) throw new System.ComponentModel.Win32Exception();
    return name.ToString();
  }
}
'@
$target = [IntPtr]::new($WindowHandle)
$windowProcessId = [uint32]0
$windowThread = [WindowProbe]::GetWindowThreadProcessId($target, [ref]$windowProcessId)
$response = [UIntPtr]::Zero
$responded = [WindowProbe]::SendMessageTimeout($target, 0, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 2000, [ref]$response)
@{
  desktop = [WindowProbe]::Desktop($windowThread)
  callerDesktop = [WindowProbe]::Desktop([WindowProbe]::GetCurrentThreadId())
  inputDesktop = [WindowProbe]::InputDesktop()
  visible = [WindowProbe]::IsWindowVisible($target)
  responsive = $responded -ne [IntPtr]::Zero
  pid = $windowProcessId
} | ConvertTo-Json -Compress
