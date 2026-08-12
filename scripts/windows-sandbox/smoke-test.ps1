param(
  [Parameter(Mandatory = $true)]
  [string]$Binary,

  [Parameter(Mandatory = $true)]
  [string]$ProbeBinary,

  [int]$ExistingProxyPort = 0,

  [string[]]$AdditionalReadableRoots = @(),

  [string]$RootBase = '',

  [switch]$KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$binaryPath = (Resolve-Path -LiteralPath $Binary).Path
$probeBinaryPath = (Resolve-Path -LiteralPath $ProbeBinary).Path
if ($ExistingProxyPort -ne 0 -and ($ExistingProxyPort -lt 61080 -or $ExistingProxyPort -gt 61089)) {
  throw 'ExistingProxyPort must be within the reserved range 61080-61089'
}

$tempBase = if ($RootBase) {
  (Resolve-Path -LiteralPath $RootBase).Path
} elseif ($env:RUNNER_TEMP) {
  (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
} else {
  (Resolve-Path -LiteralPath ([System.IO.Path]::GetTempPath())).Path
}
$root = Join-Path $tempBase ("setsuna-sandbox-smoke-{0}" -f [Guid]::NewGuid().ToString('N'))
$privateWorkspaceParent = Join-Path $root 'private-workspace-parent'
$workspace = Join-Path $privateWorkspaceParent 'workspace'
$readOnlyWorkspace = Join-Path $root 'read-only-workspace'
$protected = Join-Path $workspace 'protected'
$externalWritable = Join-Path $root 'external-broad-write'
$externalReparseTarget = Join-Path $root 'external-reparse-target'
$workspaceJunction = Join-Path $workspace 'external-reparse-junction'
$commandTemp = Join-Path $root 'command-temp\work'
$requestPath = Join-Path $root 'request.json'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$sharedParentSddl = (Get-Acl -LiteralPath $tempBase).Sddl
$readOnlyToolchainRoot = (Resolve-Path -LiteralPath ([Environment]::SystemDirectory)).Path
$nodeBinary = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$nodeBinaryPath = (& $nodeBinary -p "require('node:fs').realpathSync(process.execPath)").Trim()
$nodeBinaryPath = (Resolve-Path -LiteralPath $nodeBinaryPath).Path
$preExistingReadableRoots = @($readOnlyToolchainRoot)
$managedReadableRoots = @($nodeBinaryPath)
foreach ($candidate in $AdditionalReadableRoots) {
  $preExistingReadableRoots += (Resolve-Path -LiteralPath $candidate).Path
}
$preExistingReadableRoots = @($preExistingReadableRoots | Sort-Object -Unique)
$preExistingReadableRootSddls = @{}
$temporaryPathSddls = @{}
$externalReparseTargetSddl = $null
foreach ($readableRoot in $preExistingReadableRoots) {
  $preExistingReadableRootSddls[$readableRoot] = (Get-Acl -LiteralPath $readableRoot).Sddl
}
$listeners = [System.Collections.Generic.List[System.Net.Sockets.TcpListener]]::new()

function Write-SandboxRequest([System.Collections.IDictionary]$Request) {
  $json = $Request | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($requestPath, $json, $utf8NoBom)
}

function New-SandboxRequest(
  [string]$ExecutionId,
  [string]$Command,
  [bool]$NetworkAccess,
  [System.Collections.IDictionary]$Environment
) {
  return [ordered]@{
    protocolVersion = 1
    executionId = $ExecutionId
    supervisorPids = @($PID)
    command = $Command
    cwd = $workspace
    workspaceRoot = $workspace
    permissionProfile = 'workspace-write'
    readableRoots = @($workspace, $commandTemp) + $preExistingReadableRoots + $managedReadableRoots
    writableRoots = @($workspace, $commandTemp)
    ephemeralWritableRoots = @($commandTemp)
    deniedRoots = @()
    deniedGlobRegExpSources = @()
    protectedWritableRoots = @($protected)
    networkAccess = $NetworkAccess
    environment = $Environment
  }
}

function New-SandboxEnvironment([System.Collections.IDictionary]$Additional = @{}) {
  $environment = [ordered]@{
    ComSpec = $env:ComSpec
    PATH = $env:PATH
    PATHEXT = $env:PATHEXT
    SystemRoot = $env:SystemRoot
    USERPROFILE = $env:USERPROFILE
    TEMP = $commandTemp
    TMP = $commandTemp
    NO_COLOR = '1'
    FORCE_COLOR = '0'
  }
  foreach ($entry in $Additional.GetEnumerator()) {
    $environment[$entry.Key] = $entry.Value
  }
  return $environment
}

function Assert-SharedParentUnchanged {
  $current = (Get-Acl -LiteralPath $tempBase).Sddl
  if ($current -ne $sharedParentSddl) {
    throw "Sandbox execution changed the shared parent ACL: $tempBase"
  }
}

function Assert-PreExistingReadableAclsUnchanged {
  foreach ($readableRoot in $preExistingReadableRoots) {
    $current = (Get-Acl -LiteralPath $readableRoot).Sddl
    if ($current -ne $preExistingReadableRootSddls[$readableRoot]) {
      throw "Sandbox execution changed an already-readable toolchain ACL: $readableRoot"
    }
  }
}

function Assert-TemporaryPathAclsUnchanged {
  foreach ($temporaryPath in $temporaryPathSddls.Keys) {
    $current = (Get-Acl -LiteralPath $temporaryPath).Sddl
    if ((Normalize-ManagedSddl $current) -ne (Normalize-ManagedSddl $temporaryPathSddls[$temporaryPath])) {
      throw "Sandbox execution did not restore a temporary ACL: $temporaryPath`nbefore: $($temporaryPathSddls[$temporaryPath])`nafter:  $current"
    }
  }
}

function Normalize-ManagedSddl([string]$Sddl) {
  # SetSecurityInfo can mark an unprotected inherited DACL as auto-inherited
  # while preserving the owner, group, protection state, and every ACE.
  return [regex]::Replace($Sddl, 'D:([A-Z]*)(?=\()', {
    param($Match)
    return 'D:' + $Match.Groups[1].Value.Replace('AI', '')
  })
}

function Assert-ReparseTargetAclUnchanged {
  if ($null -eq $externalReparseTargetSddl) { return }
  $current = (Get-Acl -LiteralPath $externalReparseTarget).Sddl
  if ($current -ne $externalReparseTargetSddl) {
    throw "Sandbox ACL materialization followed a workspace junction: $workspaceJunction"
  }
}

function Set-DirectoryDacl(
  [string]$Path,
  [System.Security.AccessControl.DirectorySecurity]$Acl
) {
  # Set-Acl can request SeSecurityPrivilege when a DirectorySecurity instance
  # is reused, even though this fixture only changes the DACL. The filesystem
  # APIs write only the requested directory access rules without touching SACLs.
  if ($PSVersionTable.PSEdition -eq 'Core') {
    [System.IO.FileSystemAclExtensions]::SetAccessControl(
      [System.IO.DirectoryInfo]::new($Path),
      $Acl
    )
    return
  }
  [System.IO.Directory]::SetAccessControl($Path, $Acl)
}

function Assert-NoLogonSidAce {
  $paths = @(Get-Item -LiteralPath $root) + @(Get-ChildItem -LiteralPath $root -Force -Recurse)
  foreach ($path in $paths) {
    $sddl = (Get-Acl -LiteralPath $path.FullName).Sddl
    if ($sddl -match 'S-1-5-5-[0-9]+-[0-9]+') {
      throw "Per-logon sandbox ACE remained on $($path.FullName)"
    }
  }
}

function Invoke-SandboxRequest(
  [System.Collections.IDictionary]$Request,
  [scriptblock]$WhileRunning = {},
  [string]$ExpectedErrorPattern = ''
) {
  Write-SandboxRequest $Request
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $binaryPath
  $startInfo.Arguments = "run --request `"$requestPath`""
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Sandbox process did not start: $($Request.executionId)"
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    while (-not $process.WaitForExit(20)) {
      & $WhileRunning
      Assert-SharedParentUnchanged
      Assert-PreExistingReadableAclsUnchanged
      Assert-ReparseTargetAclUnchanged
      if ($watch.Elapsed.TotalSeconds -ge 30) {
        throw "Sandbox request timed out: $($Request.executionId)"
      }
    }
    $process.WaitForExit()
    $exitCode = $process.ExitCode
    $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
    $stderr = $stderrTask.GetAwaiter().GetResult().Trim()
    & $WhileRunning
    Assert-SharedParentUnchanged
    Assert-PreExistingReadableAclsUnchanged
    Assert-ReparseTargetAclUnchanged
    Assert-TemporaryPathAclsUnchanged
    if ($ExpectedErrorPattern) {
      if ($exitCode -eq 0) {
        throw "Sandbox request unexpectedly accepted an unsafe policy: $($Request.executionId)"
      }
      $failureOutput = "$stdout`n$stderr"
      if ($failureOutput -notmatch $ExpectedErrorPattern) {
        throw "Sandbox request failed for the wrong reason: $($Request.executionId)`nstdout: $stdout`nstderr: $stderr"
      }
      if (Test-Path -LiteralPath $requestPath) {
        Remove-Item -LiteralPath $requestPath -Force
      }
      return
    }
    if ($exitCode -ne 0) {
      throw "Sandbox request failed with exit code ${exitCode}: $($Request.executionId)`nstdout: $stdout`nstderr: $stderr"
    }
    if (Test-Path -LiteralPath $requestPath) {
      throw "Sandbox request was not destroyed: $($Request.executionId)"
    }
  } finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(5000) | Out-Null
    }
    $process.Dispose()
  }
}

function Start-AllowedProxyListener {
  foreach ($port in 61080..61089) {
    $listener = [System.Net.Sockets.TcpListener]::new(
      [System.Net.IPAddress]::Loopback,
      $port
    )
    try {
      $listener.Start()
      $listeners.Add($listener)
      return $listener
    } catch {
      $listener.Stop()
    }
  }
  throw 'No reserved Windows sandbox proxy port is available'
}

function Start-BlockedLoopbackListener {
  while ($true) {
    $listener = [System.Net.Sockets.TcpListener]::new(
      [System.Net.IPAddress]::Loopback,
      0
    )
    $listener.Start()
    $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    if ($port -lt 61080 -or $port -gt 61089) {
      $listeners.Add($listener)
      return $listener
    }
    $listener.Stop()
  }
}

function Complete-ProxyRequest(
  [System.Threading.Tasks.Task[System.Net.Sockets.TcpClient]]$AcceptTask,
  [hashtable]$State
) {
  if ($State.Accepted -or -not $AcceptTask.IsCompleted) { return }
  $client = $AcceptTask.GetAwaiter().GetResult()
  try {
    $State.Accepted = $true
    $stream = $client.GetStream()
    $stream.ReadTimeout = 2000
    $buffer = [byte[]]::new(4096)
    $requestBytes = [System.Collections.Generic.List[byte]]::new()
    while ($requestBytes.Count -lt 16384) {
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -eq 0) { break }
      for ($index = 0; $index -lt $read; $index++) {
        $requestBytes.Add($buffer[$index])
      }
      $requestText = [System.Text.Encoding]::ASCII.GetString($requestBytes.ToArray())
      if ($requestText.Contains("`r`n`r`n")) { break }
    }
    $requestText = [System.Text.Encoding]::ASCII.GetString($requestBytes.ToArray())
    $expectedAuthorization = 'Proxy-Authorization: Basic c2FuZGJveDpzZWNyZXQ='
    $State.Authenticated = $requestText -match [regex]::Escape($expectedAuthorization)
    $status = if ($State.Authenticated) { '204 No Content' } else { '407 Proxy Authentication Required' }
    $response = [System.Text.Encoding]::ASCII.GetBytes(
      "HTTP/1.1 $status`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
    )
    $stream.Write($response, 0, $response.Length)
    $stream.Flush()
  } finally {
    $client.Dispose()
  }
}

try {
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null
  New-Item -ItemType Directory -Force -Path $readOnlyWorkspace | Out-Null
  $currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  # Reproduce workspaces below user-private folders such as Documents. The sandbox
  # account may traverse this parent, but Node realpath also needs metadata access.
  $privateWorkspaceParentAcl = [System.Security.AccessControl.DirectorySecurity]::new()
  $privateWorkspaceParentAcl.SetSecurityDescriptorSddlForm(
    "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;$currentUserSid)",
    [System.Security.AccessControl.AccessControlSections]::Access
  )
  Set-DirectoryDacl -Path $privateWorkspaceParent -Acl $privateWorkspaceParentAcl
  $readOnlyWorkspaceAcl = [System.Security.AccessControl.DirectorySecurity]::new()
  $readOnlyWorkspaceAcl.SetSecurityDescriptorSddlForm(
    "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;$currentUserSid)",
    [System.Security.AccessControl.AccessControlSections]::Access
  )
  Set-DirectoryDacl -Path $readOnlyWorkspace -Acl $readOnlyWorkspaceAcl
  # Preserve private traversal while making inherited child writes broad. The
  # read-only capability deny must outrank this inherited host allow.
  $readOnlyBroadAcl = [System.Security.AccessControl.DirectorySecurity]::new()
  $readOnlyBroadAcl.SetSecurityDescriptorSddlForm(
    "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;$currentUserSid)(A;OICI;GW;;;WD)",
    [System.Security.AccessControl.AccessControlSections]::Access
  )
  Set-DirectoryDacl -Path $readOnlyWorkspace -Acl $readOnlyBroadAcl
  $readOnlyNested = Join-Path $readOnlyWorkspace 'nested'
  New-Item -ItemType Directory -Force -Path $readOnlyNested | Out-Null
  $readOnlyExisting = Join-Path $readOnlyNested 'existing.txt'
  [System.IO.File]::WriteAllText($readOnlyExisting, 'read-only-existing', $utf8NoBom)
  [System.IO.File]::WriteAllText(
    (Join-Path $readOnlyWorkspace 'read-only-probe.cmd'),
    "@echo off`r`ntype nested\existing.txt >NUL || exit /b 40`r`necho changed>nested\existing.txt 2>NUL`r`nexit /b 0`r`n",
    $utf8NoBom
  )
  New-Item -ItemType Directory -Force -Path $protected | Out-Null
  New-Item -ItemType Directory -Force -Path $externalWritable | Out-Null
  New-Item -ItemType Directory -Force -Path $externalReparseTarget | Out-Null
  New-Item -ItemType Directory -Force -Path $commandTemp | Out-Null
  Set-DirectoryDacl -Path $externalWritable -Acl $readOnlyWorkspaceAcl
  Set-DirectoryDacl -Path $externalReparseTarget -Acl $readOnlyWorkspaceAcl
  [System.IO.File]::WriteAllText(
    (Join-Path $externalReparseTarget 'must-remain-private.txt'),
    'private',
    $utf8NoBom
  )
  $externalReparseTargetSddl = (Get-Acl -LiteralPath $externalReparseTarget).Sddl
  New-Item -ItemType Junction -Path $workspaceJunction -Target $externalReparseTarget | Out-Null

  Copy-Item -LiteralPath $probeBinaryPath -Destination (Join-Path $workspace 'windows-network-probe.exe')
  $outsideFile = Join-Path $protected 'forbidden.txt'
  $externalFile = Join-Path $externalWritable 'forbidden.txt'
  [System.IO.File]::WriteAllText((Join-Path $workspace 'existing.txt'), 'before', $utf8NoBom)
  [System.IO.File]::WriteAllText(
    (Join-Path $workspace 'curl-start-smoke.cmd'),
    "@echo off`r`ncurl.exe --version >curl-version.txt 2>&1`r`n>curl-exit.txt echo %ERRORLEVEL%`r`nexit /b 0`r`n",
    $utf8NoBom
  )
  [System.IO.File]::WriteAllText(
    (Join-Path $workspace 'node-workspace-realpath-probe.cjs'),
    "const fs = require('node:fs'); fs.realpathSync(__filename); fs.readdirSync('..'); fs.readdirSync('../..'); fs.writeFileSync('node-realpath-ok.txt', 'ok');`r`n",
    $utf8NoBom
  )
  [System.IO.File]::WriteAllText(
    (Join-Path $workspace 'runtime-junction-probe.cmd'),
    "@echo off`r`ncmd.exe /d /c mklink /J `"runtime-created-junction`" `"$externalReparseTarget`" >`"runtime-junction-debug.txt`" 2>&1`r`nif errorlevel 1 (`r`n  >`"runtime-junction-status.txt`" echo blocked`r`n  exit /b 0`r`n)`r`n>`"runtime-junction-status.txt`" echo created`r`n>`"runtime-created-junction\must-remain-private.txt`" echo compromised`r`nexit /b 0`r`n",
    $utf8NoBom
  )
  # Private ancestors and managed read roots receive reusable sandbox-group ACEs.
  # Only execution-scoped write/request grants belong in the restoration baseline.
  foreach ($temporaryPath in @(
    $externalWritable,
    $commandTemp
  )) {
    $temporaryPathSddls[$temporaryPath] = (Get-Acl -LiteralPath $temporaryPath).Sddl
  }

  # A link outside the approved root must fail closed without touching its
  # target. Removing it afterward lets the same policy repair any partial ACL
  # work and proves the completion marker is written only after reconciliation.
  $linkEscapeRequest = New-SandboxRequest `
    -ExecutionId 'windows_ci_external_link_rejected' `
    -Command 'exit /b 0' `
    -NetworkAccess $false `
    -Environment (New-SandboxEnvironment)
  Invoke-SandboxRequest `
    -Request $linkEscapeRequest `
    -ExpectedErrorPattern 'contains a link that escapes'
  Assert-ReparseTargetAclUnchanged
  Remove-Item -LiteralPath $workspaceJunction -Force

  $readOnlyRequest = New-SandboxRequest `
    -ExecutionId 'windows_ci_read_only' `
    -Command 'read-only-probe.cmd' `
    -NetworkAccess $false `
    -Environment (New-SandboxEnvironment)
  $readOnlyRequest.cwd = $readOnlyWorkspace
  $readOnlyRequest.workspaceRoot = $readOnlyWorkspace
  $readOnlyRequest.permissionProfile = 'read-only'
  $readOnlyRequest.readableRoots = @($readOnlyWorkspace) + $preExistingReadableRoots
  $readOnlyRequest.writableRoots = @()
  $readOnlyRequest.ephemeralWritableRoots = @()
  $readOnlyRequest.protectedWritableRoots = @()
  Invoke-SandboxRequest $readOnlyRequest
  $readOnlyContents = [System.IO.File]::ReadAllText($readOnlyExisting, $utf8NoBom)
  if ($readOnlyContents -ne 'read-only-existing') {
    $readOnlyRootSddl = (Get-Acl -LiteralPath $readOnlyWorkspace).Sddl
    $readOnlyNestedSddl = (Get-Acl -LiteralPath $readOnlyNested).Sddl
    $readOnlyFileSddl = (Get-Acl -LiteralPath $readOnlyExisting).Sddl
    throw "Read-only Windows sandbox modified an existing private workspace file (contents='$readOnlyContents').`nroot: $readOnlyRootSddl`nnested: $readOnlyNestedSddl`nfile: $readOnlyFileSddl"
  }

  $offlineListener = Start-BlockedLoopbackListener
  $offlinePort = ([System.Net.IPEndPoint]$offlineListener.LocalEndpoint).Port
  $offlineAccept = $offlineListener.AcceptTcpClientAsync()
  $offlineCommand = @(
    'whoami>identity-offline.txt'
    "(`"$nodeBinaryPath`" node-workspace-realpath-probe.cjs >node-realpath-debug.txt 2>&1 && echo ready>node-realpath-status.txt || echo failed>node-realpath-status.txt)"
    'echo workspace-ok>offline-write.txt'
    'echo existing-ok>existing.txt'
    'call curl-start-smoke.cmd'
    'call runtime-junction-probe.cmd'
    "echo forbidden>$outsideFile 2>NUL"
    "echo forbidden>$externalFile 2>NUL"
    "(windows-network-probe.exe tcp 127.0.0.1 $offlinePort 2000 >NUL 2>&1 && echo reached>offline-loopback.txt || echo blocked>offline-loopback.txt)"
    '(windows-network-probe.exe tcp example.com 80 2000 >NUL 2>&1 && echo reached>offline-public.txt || echo blocked>offline-public.txt)'
    'exit /b 0'
  ) -join ' & '
  $offlineRequest = New-SandboxRequest `
    -ExecutionId 'windows_ci_offline' `
    -Command $offlineCommand `
    -NetworkAccess $false `
    -Environment (New-SandboxEnvironment)
  Invoke-SandboxRequest $offlineRequest

  if ($offlineAccept.Wait(250)) {
    $offlineAccept.GetAwaiter().GetResult().Dispose()
    throw 'Offline Windows sandbox reached a blocked host loopback port'
  }
  if ((Get-Content -LiteralPath (Join-Path $workspace 'identity-offline.txt') -Raw).Trim() -notmatch '\\setsunasboffline$') {
    throw 'Offline command did not run as SetsunaSbOffline'
  }
  $curlExit = (Get-Content -LiteralPath (Join-Path $workspace 'curl-exit.txt') -Raw).Trim()
  if ($curlExit -ne '0') {
    $curlOutput = (@(Get-Content -LiteralPath (Join-Path $workspace 'curl-version.txt')) -join "`n").Trim()
    throw "Windows curl.exe did not start under the restricted token (exit $curlExit): $curlOutput"
  }
  $nodeRealpathStatus = (Get-Content -LiteralPath (Join-Path $workspace 'node-realpath-status.txt') -Raw).Trim()
  if (
    $nodeRealpathStatus -ne 'ready' -or
    -not (Test-Path -LiteralPath (Join-Path $workspace 'node-realpath-ok.txt')) -or
    (Get-Content -LiteralPath (Join-Path $workspace 'node-realpath-ok.txt') -Raw).Trim() -ne 'ok'
  ) {
    $nodeRealpathDebug = (@(Get-Content -LiteralPath (Join-Path $workspace 'node-realpath-debug.txt')) -join "`n").Trim()
    throw "Node could not resolve a workspace below a user-private ancestor: $nodeRealpathDebug"
  }
  if ((Get-Content -LiteralPath (Join-Path $workspace 'offline-write.txt') -Raw).Trim() -ne 'workspace-ok') {
    throw 'Offline sandbox could not write to its workspace'
  }
  if ((Get-Content -LiteralPath (Join-Path $workspace 'existing.txt') -Raw).Trim() -ne 'existing-ok') {
    throw 'Offline sandbox could not modify an existing workspace file'
  }
  $runtimeJunctionStatus = (Get-Content -LiteralPath (Join-Path $workspace 'runtime-junction-status.txt') -Raw).Trim()
  if ($runtimeJunctionStatus -ne 'blocked' -or (Test-Path -LiteralPath (Join-Path $workspace 'runtime-created-junction'))) {
    $runtimeJunctionDebug = (@(Get-Content -LiteralPath (Join-Path $workspace 'runtime-junction-debug.txt')) -join "`n").Trim()
    throw "Restricted process tree created a runtime junction (status=$runtimeJunctionStatus): $runtimeJunctionDebug"
  }
  if ((Get-Content -LiteralPath (Join-Path $externalReparseTarget 'must-remain-private.txt') -Raw).Trim() -ne 'private') {
    throw 'Restricted process tree escaped through a runtime-created junction'
  }
  Assert-ReparseTargetAclUnchanged
  if (Test-Path -LiteralPath $outsideFile) {
    throw 'Offline sandbox wrote inside a protected writable root'
  }
  if (Test-Path -LiteralPath $externalFile) {
    throw 'Offline sandbox wrote outside approved roots'
  }
  foreach ($resultName in @('offline-loopback.txt', 'offline-public.txt')) {
    if ((Get-Content -LiteralPath (Join-Path $workspace $resultName) -Raw).Trim() -ne 'blocked') {
      throw "Offline network probe unexpectedly succeeded: $resultName"
    }
  }
  Assert-NoLogonSidAce

  $proxyAccept = $null
  if ($ExistingProxyPort -ne 0) {
    $proxyPort = $ExistingProxyPort
  } else {
    $proxyListener = Start-AllowedProxyListener
    $proxyPort = ([System.Net.IPEndPoint]$proxyListener.LocalEndpoint).Port
    $proxyAccept = $proxyListener.AcceptTcpClientAsync()
  }
  $blockedListener = Start-BlockedLoopbackListener
  $blockedPort = ([System.Net.IPEndPoint]$blockedListener.LocalEndpoint).Port
  $blockedAccept = $blockedListener.AcceptTcpClientAsync()
  $proxyState = @{ Accepted = $false; Authenticated = $false }
  $onlineEnvironment = New-SandboxEnvironment @{
    HTTP_PROXY = "http://sandbox:secret@127.0.0.1:$proxyPort"
    HTTPS_PROXY = "http://sandbox:secret@127.0.0.1:$proxyPort"
    ALL_PROXY = "http://sandbox:secret@127.0.0.1:$proxyPort"
    NO_PROXY = ''
  }
  $proxyProbeCommand = if ($ExistingProxyPort -ne 0) {
    "windows-network-probe.exe tcp 127.0.0.1 $proxyPort 4000 >NUL 2>online-proxy-debug.txt"
  } else {
    'windows-network-probe.exe proxy http://example.com/ 4000 >NUL 2>online-proxy-debug.txt'
  }
  $onlineProbeScript = @(
    '@echo off'
    $proxyProbeCommand
    'set "probeExit=%ERRORLEVEL%"'
    'echo %probeExit%>online-proxy-exit.txt'
    'if "%probeExit%"=="0" (echo reached>online-proxy.txt) else (echo blocked>online-proxy.txt)'
    "windows-network-probe.exe tcp 127.0.0.1 $blockedPort 2000 >NUL 2>&1"
    'if errorlevel 1 (echo blocked>online-loopback.txt) else (echo reached>online-loopback.txt)'
    'windows-network-probe.exe tcp example.com 80 2000 >NUL 2>&1'
    'if errorlevel 1 (echo blocked>online-public.txt) else (echo reached>online-public.txt)'
    'exit /b 0'
  )
  [System.IO.File]::WriteAllLines(
    (Join-Path $workspace 'online-network-smoke.cmd'),
    $onlineProbeScript,
    $utf8NoBom
  )
  $onlineCommand = @(
    'whoami>identity-online.txt'
    'whoami /user /fo csv /nh>identity-online-sid.txt'
    'set HTTP_PROXY>online-proxy-environment.txt'
    'set NO_PROXY>>online-proxy-environment.txt'
    'call online-network-smoke.cmd'
    'exit /b 0'
  ) -join ' & '
  $onlineRequest = New-SandboxRequest `
    -ExecutionId 'windows_ci_online' `
    -Command $onlineCommand `
    -NetworkAccess $true `
    -Environment $onlineEnvironment
  Invoke-SandboxRequest $onlineRequest {
    if ($null -ne $proxyAccept) {
      Complete-ProxyRequest $proxyAccept $proxyState
    }
  }

  if ($null -ne $proxyAccept -and -not $proxyState.Accepted) {
    throw 'Online Windows sandbox did not use the reserved egress proxy'
  }
  if ($null -ne $proxyAccept -and -not $proxyState.Authenticated) {
    throw 'Online Windows sandbox did not authenticate to the reserved egress proxy'
  }
  if ($blockedAccept.Wait(250)) {
    $blockedAccept.GetAwaiter().GetResult().Dispose()
    throw 'Online Windows sandbox reached a non-proxy host loopback port'
  }
  if ((Get-Content -LiteralPath (Join-Path $workspace 'identity-online.txt') -Raw).Trim() -notmatch '\\setsunasbonline$') {
    throw 'Online command did not run as SetsunaSbOnline'
  }
  $onlineProxyResultPath = Join-Path $workspace 'online-proxy.txt'
  if (
    -not (Test-Path -LiteralPath $onlineProxyResultPath) -or
    (Get-Content -LiteralPath $onlineProxyResultPath -Raw).Trim() -ne 'reached'
  ) {
    $proxyEnvironment = (@(Get-Content -LiteralPath (Join-Path $workspace 'online-proxy-environment.txt')) -join "`n").Trim()
    $proxyDebugPath = Join-Path $workspace 'online-proxy-debug.txt'
    $proxyDebug = if (Test-Path -LiteralPath $proxyDebugPath) {
      (@(Get-Content -LiteralPath $proxyDebugPath) -join "`n").Trim()
    } else {
      '<no stderr file>'
    }
    $proxyExitPath = Join-Path $workspace 'online-proxy-exit.txt'
    $proxyExit = if (Test-Path -LiteralPath $proxyExitPath) {
      (Get-Content -LiteralPath $proxyExitPath -Raw).Trim()
    } else {
      '<no exit file>'
    }
    throw "Online proxy request failed with exit code $proxyExit.`nEnvironment:`n$proxyEnvironment`nProbe:`n$proxyDebug"
  }
  foreach ($resultName in @('online-loopback.txt', 'online-public.txt')) {
    if ((Get-Content -LiteralPath (Join-Path $workspace $resultName) -Raw).Trim() -ne 'blocked') {
      $onlineIdentitySid = (Get-Content -LiteralPath (Join-Path $workspace 'identity-online-sid.txt') -Raw).Trim()
      throw "Online direct network probe unexpectedly succeeded: $resultName (identity: $onlineIdentitySid)"
    }
  }
  Assert-NoLogonSidAce
  Assert-SharedParentUnchanged
  Assert-PreExistingReadableAclsUnchanged
} catch {
  $failedLine = $_.InvocationInfo.ScriptLineNumber
  $failedSource = if ($_.InvocationInfo.Line) { $_.InvocationInfo.Line.Trim() } else { '<unknown>' }
  throw "Windows sandbox smoke failed at line ${failedLine}: $failedSource`n$($_.Exception.Message)`n$($_.ScriptStackTrace)"
} finally {
  foreach ($listener in $listeners) {
    $listener.Stop()
  }
  if (-not $KeepArtifacts -and (Test-Path -LiteralPath $root)) {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  } elseif ($KeepArtifacts) {
    Write-Warning "Windows sandbox smoke artifacts retained at $root"
  }
}

Write-Output 'Windows sandbox smoke test passed.'
