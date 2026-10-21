import { access, readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { prepareTerminalCommand } from '../../src/main/command.js';

it('preserves multiline Windows scripts in a disposable batch file instead of flattening shell syntax', async () => {
  const command = 'if exist "package.json" (\n  echo 开始\n  call pnpm install\n)\npnpm dev';
  const launch = await prepareTerminalCommand('cmd.exe', command, 'win32');
  const file = launch.env!.SETSUNA_TERMINAL_ACTION_FILE!;
  try {
    expect(launch.args).toBe('/D /Q /S /K ""%SETSUNA_TERMINAL_ACTION_FILE%""');
    expect(await readFile(file, 'utf8')).toBe(`@echo off\r\nchcp 65001 >nul\r\n${command.replaceAll('\n', '\r\n')}\r\n`);
  } finally { await launch.dispose(); }
  await expect(access(file)).rejects.toThrow();
});
