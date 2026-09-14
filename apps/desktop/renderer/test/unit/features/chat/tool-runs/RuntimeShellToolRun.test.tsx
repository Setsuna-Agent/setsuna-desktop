import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, translate } from '../../../../../src/shared/i18n/I18nProvider.js';
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
  it('hides empty runtime streams while preserving real command output and stderr', () => {
    const cases = [
      { stdout: '(no new output)', stderr: '(no new output)', segments: [] },
      { stdout: 'commit abc123', stderr: '(no new output)', segments: [{ kind: 'stdout', text: 'commit abc123' }] },
      { stdout: '(no new output)', stderr: 'fatal: not a git repository', segments: [{ kind: 'stderr', text: 'fatal: not a git repository' }] },
      { stdout: 'literal text: (no new output)', stderr: '(no new output)', segments: [{ kind: 'stdout', text: 'literal text: (no new output)' }] },
    ];
    for (const { stdout, stderr, segments } of cases) {
      const resultPreview = currentShellResult.replace('typecheck passed', stdout).replace('(empty)', stderr);
      expect(shellOutputSegments(resultPreview)).toEqual(segments);
      const run: RuntimeToolRun = {
        id: 'empty-streams', name: 'exec_command', status: stderr.startsWith('fatal:') ? 'error' : 'success',
        argumentsPreview: '{"cmd":"git status --short"}', resultPreview,
      };
      const html = renderToStaticMarkup(createElement(ShellTerminalResult, { run }));
      if (stderr === '(no new output)') expect(html).not.toContain('chat-mcp-terminal__stream--stderr');
      else expect(html).toContain('fatal: not a git repository');
      expect(html).toContain('git status --short');
    }
    expect(shellOutputSegments('(no new output)')).toEqual([{ kind: 'message', text: '(no new output)' }]);
  });

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
      '进程 ID：process-1',
      '命令：pnpm typecheck',
      '工作目录：.',
      '状态：已完成',
      '沙箱：macos-seatbelt',
      '跨轮次保留：否',
      '耗时（毫秒）：2344',
      '退出码：0',
      '信号：无',
    ]);

    const html = renderToStaticMarkup(createElement(ShellTerminalResult, { run }));
    const output = /<div class="chat-mcp-terminal__output">([\s\S]*?)<\/div>/u
      .exec(html)?.[1] ?? '';
    expect(html).toContain('aria-label="运行详情"');
    expect(html).toContain('命令终端');
    expect(output).toContain('typecheck passed');
    expect(output).not.toContain('Process Id');
    expect(output).not.toContain('Sandbox');
    const englishHtml = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: 'en-US' },
      createElement(ShellTerminalResult, { run })));
    expect(englishHtml).toContain('>Shell</div>');
    expect(englishHtml).toContain('Signal: (none)');
    expect(englishHtml).toContain('typecheck passed');
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
    expect(shellDiagnosticText(failedRun)).toBe('退出码 2');
    expect(shellDiagnosticText(failedRun, (key, params) => translate('en-US', key, params))).toBe('exit 2');
  });

  it('translates persisted runtime notices but keeps identical text in command output unchanged', () => {
    const rawOutput = 'No matches found.\nStatus: completed\nSignal: SIGTERM';
    for (const notice of ['No matches found.', '未找到匹配结果。']) {
      const result = `${notice}\n${currentShellResult.replace('typecheck passed', rawOutput)}`;
      expect(shellOutputSegments(result)).toEqual([
        { kind: 'message', text: '未找到匹配结果。' },
        { kind: 'stdout', text: rawOutput },
      ]);
      expect(shellOutputSegments(result, (key, params) => translate('en-US', key, params))[0].text)
        .toBe('No matches found.');
    }
    expect(shellOutputSegments('No matches found.')).toEqual([{ kind: 'message', text: 'No matches found.' }]);
    expect(shellOutputSegments(`${currentShellResult}\n\n进程仍在运行。使用 read_shell_process 读取输出。`))
      .toEqual([{ kind: 'stdout', text: 'typecheck passed' }]);
  });
});
