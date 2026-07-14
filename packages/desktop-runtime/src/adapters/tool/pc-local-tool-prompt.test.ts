import { describe, expect, it } from 'vitest';
import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { pcLocalToolPrompt } from './pc-local-tool-prompt.js';

describe('pcLocalToolPrompt', () => {
  it('does not describe mutation or shell capabilities in a read-only sampling step', () => {
    const prompt = pcLocalToolPrompt([tool('read_file'), tool('read_diff')]);

    expect(prompt).toContain('read-only tools');
    expect(prompt).not.toContain('apply_patch');
    expect(prompt).not.toContain('run_shell_command');
    expect(prompt).not.toContain('git_log');
    expect(prompt).not.toContain('git_show');
    expect(prompt).not.toContain('file deletion');
  });

  it('includes focused mutation and shell policy when those tools are advertised', () => {
    const prompt = pcLocalToolPrompt([tool('apply_patch'), tool('run_shell_command'), tool('update_plan')]);

    expect(prompt).toContain('Prefer apply_patch');
    expect(prompt).toContain('Use run_shell_command');
    expect(prompt).toContain('exactly one step in progress');
  });

  it('directs committed-history reads through workspace-scoped Git tools', () => {
    const prompt = pcLocalToolPrompt([tool('git_log'), tool('git_show'), tool('exec_command')]);

    expect(prompt).toContain('git_log/git_show inspect committed history');
    expect(prompt).toContain('Prefer git_log/git_show');
    expect(prompt).toContain('workspace-relative paths');
  });

  it('states the default search_text regex semantics', () => {
    const prompt = pcLocalToolPrompt([tool('search_text')]);

    expect(prompt).toContain('regular expression by default');
    expect(prompt).toContain('regex to false');
  });
});

function tool(name: string): RuntimeToolDefinition {
  return { name, description: name, inputSchema: {} };
}
