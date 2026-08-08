import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { pcLocalToolPrompt } from '../../../../src/adapters/tool/pc-local/pc-local-tool-prompt.js';

describe('pcLocalToolPrompt', () => {
  it('limits guidance to the capabilities advertised for the step', () => {
    const readOnly = pcLocalToolPrompt([tool('read_file')]);
    expect(readOnly).not.toContain('apply_patch');
    expect(readOnly).not.toContain('run_shell_command');

    const mutating = pcLocalToolPrompt([
      tool('apply_patch'),
      tool('run_shell_command'),
      tool('update_plan'),
    ]);
    expect(mutating).toContain('apply_patch');
    expect(mutating).toContain('run_shell_command');
    expect(mutating).toContain('exactly one step in progress');
  });

  it.each([
    [['search_text'], 'search_text', 'git_log'],
    [['git_log', 'git_show'], 'git_log/git_show', 'search_text'],
    [['exec_command'], 'exec_command', 'run_shell_command'],
    [['edit', 'write_file'], 'edit/write_file', 'apply_patch'],
  ])('isolates %s guidance from unrelated tool branches', (names, included, excluded) => {
    const prompt = pcLocalToolPrompt(names.map(tool));

    expect(prompt).toContain(included);
    expect(prompt).not.toContain(excluded);
  });

  it('adds managed dependency guidance only when that runtime is enabled', () => {
    const tools = [tool('run_shell_command')];
    expect(pcLocalToolPrompt(tools)).not.toContain('manages and prepends Node.js');
    expect(pcLocalToolPrompt(tools, { workspaceDependencies: { enabled: true } }))
      .toContain('manages and prepends Node.js');
  });
});

function tool(name: string): RuntimeToolDefinition {
  return { name, description: name, inputSchema: {} };
}
