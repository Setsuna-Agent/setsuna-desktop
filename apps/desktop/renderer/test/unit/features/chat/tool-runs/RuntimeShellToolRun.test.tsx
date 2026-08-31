import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ShellTerminalResult,
  shellDiagnosticText,
  shellOutputSegments,
  shellRuntimeDetailLines,
  shellStatusLabel,
} from '../../../../../src/features/chat/tool-runs/RuntimeShellToolRun.js';

const currentShellResult = [
  'Process Id: process-1',
  'Command: pnpm typecheck',
  'Directory: .',
  'Status: completed',
  'Sandbox: macos-seatbelt',
  'Persisted: no',
  'Elapsed Ms: 2344',
  'Exit Code: 0',
  'Signal: (none)',
  'Stdout:',
  'typecheck passed',
  'Stderr:',
  '(empty)',
].join('\n');

describe('RuntimeShellToolRun', () => {
  it('keeps runtime metadata behind a compact details trigger', () => {
    const run: RuntimeToolRun = {
      id: 'shell-current-result',
      name: 'exec_command',
      status: 'success',
      argumentsPreview: '{"cmd":"pnpm typecheck"}',
      resultPreview: currentShellResult,
    };

    expect(shellOutputSegments(currentShellResult)).toEqual([
      { kind: 'stdout', text: 'typecheck passed' },
    ]);
    expect(shellRuntimeDetailLines(currentShellResult)).toEqual([
      'Process Id: process-1',
      'Command: pnpm typecheck',
      'Directory: .',
      'Status: completed',
      'Sandbox: macos-seatbelt',
      'Persisted: no',
      'Elapsed Ms: 2344',
      'Exit Code: 0',
      'Signal: (none)',
    ]);

    const html = renderToStaticMarkup(createElement(ShellTerminalResult, { run }));
    const output = /<div class="chat-mcp-terminal__output">([\s\S]*?)<\/div>/u
      .exec(html)?.[1] ?? '';
    expect(html).toContain('class="chat-mcp-terminal__metadata"');
    expect(html).toContain('aria-label="运行详情"');
    expect(output).toContain('typecheck passed');
    expect(output).not.toContain('Process Id');
    expect(output).not.toContain('Sandbox');
  });

  it('keeps metadata-looking command output and surfaces only failure diagnostics', () => {
    expect(shellOutputSegments('Status: application ready')).toEqual([
      { kind: 'message', text: 'Status: application ready' },
    ]);

    const failedRun: RuntimeToolRun = {
      id: 'shell-failed-result',
      name: 'exec_command',
      status: 'success',
      resultPreview: currentShellResult.replace('Exit Code: 0', 'Exit Code: 2'),
    };
    expect(shellStatusLabel(failedRun)).toBe('失败');
    expect(shellDiagnosticText(failedRun)).toBe('exit 2');
  });
});
