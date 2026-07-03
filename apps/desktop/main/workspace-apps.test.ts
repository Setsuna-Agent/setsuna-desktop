import { describe, expect, it } from 'vitest';
import { findCommandInPathVar, windowsTerminalLaunchSpec, workspaceAppSpawnSpec } from './workspace-apps.js';

const WINDOWS_WORKSPACE = 'C:\\Projects\\sample-app';
const WINDOWS_FILE_TARGET = `${WINDOWS_WORKSPACE}\\src\\index.ts:12`;
const WINDOWS_TERMINAL = 'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
const VSCODE_CMD = 'C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd';

describe('desktop workspace app spawning', () => {
  it('wraps Windows command shims before spawning', () => {
    const args = ['-g', WINDOWS_FILE_TARGET];

    expect(workspaceAppSpawnSpec({ program: VSCODE_CMD, args }, 'win32')).toEqual({
      program: 'cmd.exe',
      args: ['/d', '/c', `call "${VSCODE_CMD}" "${args[0]}" "${args[1]}"`],
      windowsVerbatimArguments: true,
    });
  });

  it('keeps Windows executables on the direct spawn path', () => {
    const spec = { program: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', args: [WINDOWS_WORKSPACE] };

    expect(workspaceAppSpawnSpec(spec, 'win32')).toBe(spec);
  });

  it('keeps visible-window launch specs visible', () => {
    const spec = { program: 'wt.exe', args: ['-d', WINDOWS_WORKSPACE], windowsHide: false };

    expect(workspaceAppSpawnSpec(spec, 'win32')).toBe(spec);
  });

  it('launches Windows Terminal with the Windows PowerShell profile', () => {
    expect(windowsTerminalLaunchSpec(WINDOWS_WORKSPACE, WINDOWS_TERMINAL)).toEqual({
      program: 'cmd.exe',
      args: [
        '/d',
        '/c',
        `start "" "${WINDOWS_TERMINAL}" -p "Windows PowerShell" -d "${WINDOWS_WORKSPACE}"`,
      ],
      windowsHide: false,
      windowsVerbatimArguments: true,
    });
  });

  it('falls back to PowerShell when Windows Terminal is unavailable', () => {
    expect(windowsTerminalLaunchSpec(WINDOWS_WORKSPACE, null)).toEqual({
      program: 'cmd.exe',
      args: [
        '/d',
        '/c',
        `start "" powershell.exe -NoExit -Command "Set-Location -LiteralPath '${WINDOWS_WORKSPACE}'"`,
      ],
      windowsHide: false,
      windowsVerbatimArguments: true,
    });
  });

  it('does not wrap non-Windows launch specs', () => {
    const spec = { program: '/usr/local/bin/code.cmd', args: ['/work/sample-app'] };

    expect(workspaceAppSpawnSpec(spec, 'linux')).toBe(spec);
  });

  it('prefers Windows launchable command extensions over extensionless shims', () => {
    const pathValue = 'C:\\Tools\\VS Code\\bin';

    expect(
      findCommandInPathVar(
        'code',
        pathValue,
        (candidate) => ['C:\\Tools\\VS Code\\bin\\code', 'C:\\Tools\\VS Code\\bin\\code.cmd'].includes(candidate),
        'win32',
      ),
    ).toBe('C:\\Tools\\VS Code\\bin\\code.cmd');
  });
});
