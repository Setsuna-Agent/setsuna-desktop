import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { macTerminalFileLaunchSpec, windowsTerminalFileLaunchSpec } from '../../src/main/terminal-file-launch.js';

const execFileAsync = promisify(execFile);

it.runIf(process.platform === 'darwin')('passes the file and line literally through the macOS terminal shell', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'setsuna-terminal-file-'));
  try {
    const directory = path.join(temporary, "project's $HOME");
    await mkdir(directory);
    const workspace = await realpath(directory);
    const file = path.join(workspace, '-$(touch injected); "quoted".ts');
    await writeFile(file, 'export {};');
    const launch = macTerminalFileLaunchSpec(workspace, file, 27);
    expect(launch.program).toBe('/usr/bin/osascript');
    // Substitute only Vim with an argv recorder; execute the actual shell command.
    const { stdout } = await execFileAsync('/bin/sh', ['-c',
      `vim() { printf '%s\\0' "$PWD" "$@"; }; ${launch.args.at(-1)}`,
    ]);
    expect(stdout.split('\0')).toEqual([workspace, '+27', '--', file, '']);
    expect(existsSync(path.join(workspace, 'injected'))).toBe(false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

it.each(["C:\\Tools' %APPDATA%\\wt.exe", null])('preserves file arguments in a Windows terminal launch (%s)', (terminalPath) => {
  const workspace = "C:\\project's %TEMP% & data";
  const file = `${workspace}\\$(whoami); 'quoted'.ts`;
  const launch = windowsTerminalFileLaunchSpec(workspace, file, { terminalPath, editorPath: 'C:\\Vim\\vim.exe', line: 49 });
  expect(launch.program).toBe('powershell.exe');
  const launcher = Buffer.from(launch.args.at(-1)!, 'base64').toString('utf16le');
  const encodedEdit = launcher.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/u)![1];
  expect(launcher).toBe(terminalPath
    ? `Start-Process -ErrorAction Stop -FilePath 'C:\\Tools'' %APPDATA%\\wt.exe' -ArgumentList '-p "Windows PowerShell" powershell.exe -NoLogo -NoExit -EncodedCommand ${encodedEdit}'`
    : `Start-Process -ErrorAction Stop -FilePath 'powershell.exe' -ArgumentList '-NoLogo -NoExit -EncodedCommand ${encodedEdit}'`);
  expect(Buffer.from(encodedEdit, 'base64').toString('utf16le')).toBe([
    "$ErrorActionPreference = 'Stop'",
    "Set-Location -LiteralPath 'C:\\project''s %TEMP% & data'",
    "& 'C:\\Vim\\vim.exe' '+49' '--' 'C:\\project''s %TEMP% & data\\$(whoami); ''quoted''.ts'",
  ].join('; '));
});

it('rejects a file open without a terminal editor instead of silently opening the directory', () => {
  expect(() => windowsTerminalFileLaunchSpec('C:\\repo', 'C:\\repo\\index.ts', {
    terminalPath: null, editorPath: null,
  })).toThrow('未找到 Vim');
});

it('does not turn an invalid line into a Vim startup command', () => {
  const launch = macTerminalFileLaunchSpec('/repo', '/repo/index.ts', Number.NaN);
  expect(launch.args.at(-1)).toBe("cd -- '/repo' && vim '--' '/repo/index.ts'");
});
