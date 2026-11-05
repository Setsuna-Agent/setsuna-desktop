import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { translate } from '../../../../../src/shared/i18n/I18nProvider.js';
import {
  shellCommand,
  shellDiagnosticText,
  shellOutputSegments
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
  it('recovers rejected command previews without losing JSON escapes or mistaking other fields for commands', () => {
    const run: RuntimeToolRun = { id: 'truncated', name: 'exec_command', status: 'rejected' };
    const command = 'cd "my project"\ncat > /tmp/sim.sh <<\'SCRIPT\'\n' + 'echo "你好"\n'.repeat(200);
    for (const key of ['command', 'cmd']) {
      const argumentsPreview = JSON.stringify({ directory: '.', [key]: command }).slice(0, 1200);
      const recovered = shellCommand({ ...run, argumentsPreview });
      expect(recovered.endsWith('…')).toBe(true);
      expect(recovered.length).toBeGreaterThan(100);
      expect(command.startsWith(recovered.slice(0, -1))).toBe(true);
      expect(shellCommand({ ...run, argumentsPreview, resultPreview: 'Command: echo actual\nExit Code: 0' }))
        .toBe('echo actual');
    }
    for (const tail of ['\\', '\\u', '\\u4', '\\u4f', '\\u4f6']) {
      expect(shellCommand({ ...run, argumentsPreview: '{"cmd":"echo ' + tail })).toBe('echo…');
    }
    expect(shellCommand({ ...run, argumentsPreview: '{"cmd":"echo \\u4f60\\u597d", "other":' })).toBe('echo 你好');
    expect(shellCommand({ ...run, argumentsPreview: '{"nested":{"cmd":"echo nested"},"cmd":"echo actual' })).toBe('echo actual…');
    for (const argumentsPreview of [
      '{"session_id":"process-123", "chars":"echo input',
      JSON.stringify({ description: '"cmd":"echo fake"', nested: { cmd: 'echo nested' } }).slice(0, -1),
    ]) {
      expect(shellCommand({ ...run, argumentsPreview })).toBe('');
    }
  });

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
    }
    expect(shellOutputSegments('(no new output)')).toEqual([{ kind: 'message', text: '(no new output)' }]);
  });

  it('keeps metadata-looking command output and preserves nonzero exit diagnostics', () => {
    expect(shellOutputSegments('Status: application ready')).toEqual([
      { kind: 'message', text: 'Status: application ready' },
    ]);

    const failedRun: RuntimeToolRun = {
      id: 'shell-failed-result',
      name: 'exec_command',
      status: 'success',
      resultPreview: currentShellResult.replace('Exit Code: 0', 'Exit Code: 2'),
    };
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
