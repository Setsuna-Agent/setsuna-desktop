import { Buffer } from 'node:buffer';

const MAC_TERMINAL_SCRIPT = [
  'on run argv',
  'tell application "Terminal"',
  'activate',
  'do script (item 1 of argv)',
  'end tell',
  'end run',
].join('\n');

export function macTerminalFileLaunchSpec(workspaceRoot: string, filePath: string, line?: number) {
  const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
  const command = `cd -- ${quote(workspaceRoot)} && vim ${vimFileArgs(filePath, line).map(quote).join(' ')}`;
  // Keep the AppleScript fixed; the shell command is passed as data in argv.
  return { program: '/usr/bin/osascript', args: ['-e', MAC_TERMINAL_SCRIPT, '--', command] };
}

export function windowsTerminalFileLaunchSpec(workspaceRoot: string, filePath: string, {
  line, terminalPath, editorPath,
}: { line?: number; terminalPath: string | null; editorPath: string | null }) {
  if (!editorPath) throw new Error('未找到 Vim，请安装 Vim 并加入 PATH 后再用终端打开文件。');
  const editCommand = [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath ${quotePowerShell(workspaceRoot)}`,
    `& ${quotePowerShell(editorPath)} ${vimFileArgs(filePath, line).map(quotePowerShell).join(' ')}`,
  ].join('; ');
  const shellArgs = `-NoLogo -NoExit -EncodedCommand ${encodePowerShell(editCommand)}`;
  const program = terminalPath ?? 'powershell.exe';
  const args = terminalPath ? `-p "Windows PowerShell" powershell.exe ${shellArgs}` : shellArgs;
  // Start a visible terminal from a hidden launcher. Encoded scripts keep paths
  // out of cmd.exe expansion and Windows Terminal's semicolon command parser.
  const launchCommand = `Start-Process -ErrorAction Stop -FilePath ${quotePowerShell(program)} -ArgumentList ${quotePowerShell(args)}`;
  return {
    program: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(launchCommand)],
  };
}

function vimFileArgs(filePath: string, line?: number): string[] {
  const location = typeof line === 'number' && Number.isSafeInteger(line) && line > 0 ? [`+${line}`] : [];
  return [...location, '--', filePath];
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function encodePowerShell(command: string): string {
  return Buffer.from(command, 'utf16le').toString('base64');
}
