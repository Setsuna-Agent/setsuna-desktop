import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { projectShellProcessOutputs } from '../../../../../src/features/chat/tool-runs/runtimeShellProcessOutputs.js';
import { isDisplayableRuntimeToolRun, isShellOutputRead } from '../../../../../src/features/chat/tool-runs/runtimeToolRunVisibility.js';
import { shellDiagnosticText, shellOutputSegments } from '../../../../../src/features/chat/tool-runs/RuntimeShellToolRun.js';

function observation(id: string, name: string, processId: string, stdout: string, options: {
  running?: boolean;
  stderr?: string;
  exitCode?: number;
} = {}): RuntimeToolRun {
  const running = options.running ?? false;
  return {
    id,
    name,
    status: options.exitCode ? 'error' : 'success',
    argumentsPreview: JSON.stringify(name === 'exec_command' ? { cmd: 'pnpm test' } : { process_id: processId }),
    data: { ok: !options.exitCode, process_id: processId, running, exit_code: options.exitCode ?? null },
    resultPreview: [
      `Process Id: ${processId}`,
      'Command: pnpm test',
      `Status: ${running ? 'running' : 'completed'}`,
      `Exit Code: ${options.exitCode ?? (running ? '(none)' : 0)}`,
      `Stdout:\n${stdout || '(no new output)'}`,
      `Stderr:\n${options.stderr || '(no new output)'}`,
      ...(running ? ['', `Process is still running. Use read_shell_process with process_id ${processId}.`] : []),
    ].join('\n'),
  };
}

function message(id: string, runs: RuntimeToolRun[], turnId = 'turn'): RuntimeMessage {
  return { id, role: 'assistant', content: '', createdAt: '2026-11-04T00:00:00Z', status: 'complete', turnId, toolRuns: runs };
}

describe('shell process output projection', () => {
  it('retains output from every poll and the final exit result across assistant segments', () => {
    const command = observation('command', 'exec_command', 'process', 'starting', { running: true });
    const intermediate = observation('poll-1', 'read_shell_process', 'process', 'progress', { running: true });
    const completed = observation('poll-2', 'write_stdin', 'process', 'finished', { stderr: 'test failed', exitCode: 2 });
    completed.argumentsPreview = '{"session_id":"process","chars":""}';
    const messages = [message('first', [command]), message('second', [intermediate, completed])];
    const original = structuredClone(messages);

    const projected = projectShellProcessOutputs(messages);
    const result = projected[0].toolRuns![0];

    expect(result).toMatchObject({ id: 'command', name: 'exec_command', status: 'error', data: completed.data });
    expect(shellDiagnosticText(result)).toBe('退出码 2');
    expect(shellOutputSegments(result.resultPreview)).toEqual([
      { kind: 'stdout', text: 'starting' },
      { kind: 'stdout', text: 'progress' },
      { kind: 'stdout', text: 'finished' },
      { kind: 'stderr', text: 'test failed' },
    ]);
    expect(projected.flatMap((item) => item.toolRuns ?? []).filter(isDisplayableRuntimeToolRun).map((run) => run.id))
      .toEqual(['command']);
    expect(messages).toEqual(original);
  });

  it('isolates processes and turns and preserves earlier output when a later poll has no new output', () => {
    const first = observation('first', 'exec_command', 'one', 'first output', { running: true });
    const second = observation('second', 'exec_command', 'two', 'second output', { running: true });
    const unrelated = observation('unrelated', 'read_shell_process', 'missing', 'unrelated output');
    const messages = [
      message('commands', [first, second]),
      message('polls', [observation('done', 'read_shell_process', 'one', ''), unrelated]),
      message('next-turn', [observation('other-turn', 'read_shell_process', 'two', 'later output')], 'next'),
    ];

    const projected = projectShellProcessOutputs(messages);

    expect(shellOutputSegments(projected[0].toolRuns![0].resultPreview)).toEqual([{ kind: 'stdout', text: 'first output' }]);
    expect(projected[0].toolRuns![0].resultPreview).toContain('Status: completed');
    expect(projected[0].toolRuns![1]).toBe(second);
    expect(projected.flatMap((item) => item.toolRuns ?? []).filter(isDisplayableRuntimeToolRun).map((run) => run.id))
      .toEqual(['first', 'second', 'unrelated', 'other-turn']);
    expect(projected[2]).toBe(messages[2]);
  });

  it('folds active polls only when their command is loaded and retains approval and stdin actions', () => {
    const command = observation('command', 'exec_command', 'process', 'starting', { running: true });
    const poll: RuntimeToolRun = {
      id: 'poll', name: 'write_stdin', status: 'running',
      argumentsPreview: '{"session_id":"process","chars":""}',
    };
    const approval: RuntimeToolRun = { ...poll, id: 'approval', status: 'pending_approval', approvalId: 'approval' };
    const stdin = { ...poll, id: 'stdin', argumentsPreview: '{"session_id":"process","chars":"yes\\n"}' };
    const unrelated = { ...poll, id: 'unrelated', argumentsPreview: '{"session_id":"missing"}' };
    const projected = projectShellProcessOutputs([message('commands', [command]), message('polls', [poll, approval, stdin, unrelated])]);

    expect(projected[0].toolRuns![0]).toBe(command);
    expect(projected.flatMap((item) => item.toolRuns ?? []).filter(isDisplayableRuntimeToolRun).map((run) => run.id))
      .toEqual(['command', 'approval', 'stdin', 'unrelated']);
  });

  it('treats omitted or empty stdin as polling while retaining whitespace and control characters as input', () => {
    for (const input of [undefined, '', ' ', '\n', '\u0003']) {
      const run = observation('stdin', 'write_stdin', 'process', '');
      run.argumentsPreview = JSON.stringify({ session_id: 'process', chars: input });
      expect(isShellOutputRead(run)).toBe(input === undefined || input === '');
    }
  });
});
