import { describe, expect, it } from 'vitest';
import { ShellOutputBuffer } from '../../../../src/adapters/tool/pc-local/pc-local-tool-shell-output.js';
import { requestedToolOutputTokenLimit } from '../../../../src/loop/tools/tool-output-budget.js';

describe('shell output delivery', () => {
  it('preserves both streams beyond the diagnostic buffer and consumes them once', () => {
    const output = new ShellOutputBuffer();
    const stdout = '中🙂'.repeat(60_000);
    output.append('stdout', stdout);
    output.append('stderr', 'diagnostic\n');
    expect(output.take()).toEqual({ stdout, stderr: 'diagnostic\n', omittedBytes: 0 });
    output.append('stdout', 'next\n');
    expect(output.take()).toEqual({ stdout: 'next\n', stderr: '', omittedBytes: 0 });
    expect(output.take()).toEqual({ stdout: '', stderr: '', omittedBytes: 0 });
  });

  it('shares the byte cap across streams, aligns UTF-8, and resets omission counts after delivery', () => {
    const output = new ShellOutputBuffer(12);
    output.append('stdout', '开始🙂'); // 10 bytes
    output.append('stderr', '错误'); // 6 bytes; drop two complete Chinese characters
    expect(output.take()).toEqual({ stdout: '🙂', stderr: '错误', omittedBytes: 6 });
    output.append('stderr', '新');
    expect(output.take()).toEqual({ stdout: '', stderr: '新', omittedBytes: 0 });
  });

  it('bounds shell requests by policy without treating unrelated tool arguments as budgets', () => {
    expect(requestedToolOutputTokenLimit('exec_command', { max_output_tokens: 1_000 }, 8_000)).toBe(1_000);
    expect(requestedToolOutputTokenLimit('write_stdin', { max_output_tokens: 20_000 }, 8_000)).toBe(8_000);
    expect(requestedToolOutputTokenLimit('read_shell_process', { max_output_tokens: 1 }, 8_000)).toBe(256);
    expect(requestedToolOutputTokenLimit('exec_command', { max_output_tokens: NaN }, 8_000)).toBe(8_000);
    expect(requestedToolOutputTokenLimit('exec_command', { max_output_tokens: -1 }, 8_000)).toBe(8_000);
    expect(requestedToolOutputTokenLimit('read_file', { max_output_tokens: 1_000 }, 10_000)).toBe(10_000);
  });
});
