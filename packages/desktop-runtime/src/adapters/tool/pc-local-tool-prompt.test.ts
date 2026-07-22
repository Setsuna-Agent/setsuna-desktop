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
    expect(prompt).toContain('execute them in parallel');
    expect(prompt).toContain('Keep dependent calls sequential');
  });

  it('includes focused mutation and shell policy when those tools are advertised', () => {
    const prompt = pcLocalToolPrompt([tool('apply_patch'), tool('write_file'), tool('run_shell_command'), tool('update_plan')]);

    expect(prompt).toContain('Prefer apply_patch');
    expect(prompt).toContain('Use run_shell_command');
    expect(prompt).toContain('exactly one step in progress');
    expect(prompt).toContain('use the injected project workflow');
    expect(prompt).toContain('Never use npm, npx');
    expect(prompt).toContain('preserve its package manager');
    expect(prompt).toContain('command -v uv only when availability is genuinely unknown');
    expect(prompt).toContain('never install into the system Python');
    expect(prompt).toContain('Reserve write_file for new files or genuine full-file rewrites');
    expect(prompt).toContain('delay visible progress');
  });

  it('tells the model to use runtime-managed Python directly with the configured index', () => {
    const prompt = pcLocalToolPrompt(
      [tool('run_shell_command')],
      { workspaceDependencies: { enabled: true } },
    );

    expect(prompt).toContain('manages and prepends Node.js, Python 3, pip, and uv');
    expect(prompt).toContain('Use python3 or uv directly');
    expect(prompt).toContain('do not run which, command -v, or version probes first');
    expect(prompt).toContain('configured npm registry is already applied');
    expect(prompt).toContain('configured Python package index is already applied');
    expect(prompt).toContain('Do not run a bare pip install');
    expect(prompt).toContain('uv run --with <package>');
    expect(prompt).not.toContain('availability is genuinely unknown');
  });

  it('applies repository command selection rules to the compatibility shell surface', () => {
    const prompt = pcLocalToolPrompt([tool('read_file'), tool('exec_command')]);

    expect(prompt).toContain('nearest relevant manifest');
    expect(prompt).toContain('Prefer declared scripts');
    expect(prompt).toContain('sandbox_permissions set to require_escalated');
    expect(prompt).toContain('request unsandboxed execution');
    expect(prompt).not.toContain('Use run_shell_command');
  });

  it('directs committed-history reads through workspace-scoped Git tools', () => {
    const prompt = pcLocalToolPrompt([tool('git_log'), tool('git_show'), tool('exec_command')]);

    expect(prompt).toContain('git_log/git_show inspect committed history');
    expect(prompt).toContain('Prefer git_log/git_show');
    expect(prompt).toContain('workspace-relative paths');
  });

  it('states the search_text regex and parallel batching semantics', () => {
    const prompt = pcLocalToolPrompt([tool('search_text')]);

    expect(prompt).toContain('regular expression by default');
    expect(prompt).toContain('regex to false');
    expect(prompt).toContain('runtime-managed ripgrep path');
    expect(prompt).toContain('instead of shell grep/find');
    expect(prompt).toContain('issue all of them together in the same response');
    expect(prompt).toContain('runtime executes the calls in parallel');
    expect(prompt).toContain('otherwise keep them as separate search_text calls');
  });
});

function tool(name: string): RuntimeToolDefinition {
  return { name, description: name, inputSchema: {} };
}
