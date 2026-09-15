import type { RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ToolOrchestrator } from '../../../src/loop/tools/tool-orchestrator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { CliPluginAttribution } from '../../../src/loop/tools/cli-plugin-attribution.js';

function cliPlugin(id: string, commands: string[]): RuntimePluginSummary {
  return {
    id, name: id, installedAt: '', skills: [], hooks: [], hookCount: 0, resources: [], mcpServers: [],
    connectors: commands.map((command, index) => ({
      id: `cli-${index}`, name: command, kind: 'cli', command, required: false,
      installUrl: 'https://example.com/install', setupCommands: [],
    })),
  };
}

describe('CLI plugin attribution', () => {
  it.each([
    ['gh pr list', 'git status'],
    ['git status', 'gh pr list'],
  ])('records plugin attribution from rewritten input: %s → %s', async (original, rewritten) => {
    const plugin = { id: 'github', name: 'GitHub' };
    const publishToolStarted = vi.fn(async () => undefined);
    const runTool = vi.fn(async () => ({ content: 'done' }));
    const dispatch = vi.fn(async (name: string) => name === 'tool.before' ? { input: { command: rewritten } } : {});
    const orchestrator = new ToolOrchestrator({
      toolHost: { listTools: async () => [], runTool },
      clock: systemClock, extensions: { dispatch },
      events: {
        publishToolStarted,
        publishToolCompleted: async () => {}, publishToolOutputDelta: async () => {},
        publishHookStarted: async () => {}, publishHookCompleted: async () => {},
        publishApprovalRequested: async () => {}, publishApprovalResolved: async () => {},
      },
    });
    await orchestrator.runToolCall(
      { id: 'call_cli', name: 'run_shell_command', arguments: JSON.stringify({ command: original }) },
      { command: original }, {
        threadId: 'thread_cli', turnId: 'turn_cli', signal: new AbortController().signal,
        permissionProfile: 'workspace-write', sandboxWorkspaceWrite: {},
        environment: { id: 'local', cwd: '/workspace', workspaceRoot: '/workspace', workspaceRoots: ['/workspace'] },
      }, 'full',
      { resolvePlugin: (_call, args) => (args as { command: string }).command.startsWith('gh ') ? plugin : undefined },
    );
    expect(publishToolStarted).toHaveBeenCalledWith(expect.anything(), { command: rewritten }, undefined,
      rewritten.startsWith('gh ') ? plugin : undefined);
    expect(runTool).toHaveBeenCalledWith('run_shell_command', { command: rewritten }, expect.anything());
    expect(dispatch).toHaveBeenLastCalledWith('tool.after', expect.objectContaining({
      payload: expect.objectContaining({ input: { command: rewritten }, ...(rewritten.startsWith('gh ') ? { plugin } : {}) }),
    }));
  });

  const github = cliPlugin('github', ['gh', 'gh']);
  const attribution = new CliPluginAttribution([github], 'darwin');

  it.each([
    'gh pr list',
    'which gh && gh auth status 2>&1 | head -20',
    'for n in 166 165; do echo "PR #$n"; gh pr view $n --json title,body | head -60; done',
    'if test -d .git; then gh pr list; fi',
    'GH_HOST=github.com command gh pr list',
    'env GH_HOST=github.com gh pr list',
    '"/opt/homebrew/bin/gh" pr list',
    'gh pr list \\\n      --json title',
    'echo "a; gh fake"; gh pr list # harmless | gh fake',
  ])('attributes an explicit executable in %s', (command) => {
    expect(attribution.resolve('run_shell_command', { command })).toEqual({ id: 'github', name: 'github' });
  });

  it.each([
    'echo "gh pr list"',
    'printf "%s" \'a; gh pr list\'',
    'which gh',
    'command -v gh',
    '# gh pr list\necho done',
    'echo hello # ignored; gh pr list',
    'echo hello > gh',
    'echo hello >& gh',
    'sh -c "gh pr list"',
    '$CLI gh pr list',
    'cat <<EOF\ngh pr list\nEOF',
    'echo "$(printf \'a; gh pr list\')"',
    'function show() { gh pr list; }',
    'echo "unfinished; gh pr list',
  ])('does not attribute text or opaque syntax in %s', (command) => {
    expect(attribution.resolve('run_shell_command', { command })).toBeUndefined();
  });

  it('keeps tool and plugin ownership boundaries instead of guessing', () => {
    expect(attribution.resolve('read_file', { command: 'gh pr list' })).toBeUndefined();
    expect(attribution.resolve('write_shell_process', { command: 'gh pr list' })).toBeUndefined();
    expect(attribution.resolve('run_shell_command', { command: 42 })).toBeUndefined();
    expect(new CliPluginAttribution([]).resolve('run_shell_command', { command: 'gh pr list' })).toBeUndefined();
    const ambiguous = new CliPluginAttribution([github, cliPlugin('another', ['gh'])], 'darwin');
    expect(ambiguous.resolve('run_shell_command', { command: 'gh pr list' })).toBeUndefined();
    const mixed = new CliPluginAttribution([github, cliPlugin('vercel', ['vercel'])], 'darwin');
    expect(mixed.resolve('run_shell_command', { command: 'gh pr list && vercel list' })).toBeUndefined();
  });

  it('handles Windows executable names and cmd quoting without applying POSIX separators', () => {
    const windows = new CliPluginAttribution([github], 'win32');
    expect(windows.resolve('exec_command', { cmd: '"C:\\Program Files\\GitHub CLI\\GH.EXE" pr list | more' }))
      .toEqual({ id: 'github', name: 'github' });
    expect(windows.resolve('exec_command', { cmd: 'call gh.cmd pr list' }))
      .toEqual({ id: 'github', name: 'github' });
    expect(windows.resolve('exec_command', { cmd: 'echo hello; gh pr list' })).toBeUndefined();
    expect(windows.resolve('exec_command', { cmd: 'echo "hello & gh pr list"' })).toBeUndefined();
    expect(windows.resolve('exec_command', { cmd: 'REM ignored & gh pr list' })).toBeUndefined();
  });
});
