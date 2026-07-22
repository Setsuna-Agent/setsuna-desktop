import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('bundled Hook plugins', () => {
  it('blocks destructive Shell commands but allows safe commands', () => {
    expect(runHook('guard-dangerous-shell', {
      tool_input: { command: 'rm -rf /' },
    }).status).toBe(2);
    expect(runHook('guard-dangerous-shell', {
      tool_input: { command: 'git status --short' },
    }).status).toBe(0);
  });

  it('protects sensitive files and generated directories', () => {
    expect(runHook('protect-secret-paths', {
      tool_input: { path: '/workspace/.env' },
    }).status).toBe(2);
    expect(runHook('protect-generated-folders', {
      tool_input: { path: '/workspace/dist/index.js' },
    }).status).toBe(2);
  });

  it('emits a review message after file changes', () => {
    const result = runHook('audit-file-mutations', { tool_name: 'apply_patch' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      systemMessage: expect.stringContaining('apply_patch'),
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: expect.stringContaining('审查/Review'),
      },
    });
  });

  it('injects discovered project guidance at session start', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'setsuna-hook-guidance-'));
    await writeFile(path.join(cwd, 'AGENTS.md'), '# Instructions\n');

    const result = runHook('session-start-project-guidance', { cwd, source: 'startup' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: expect.stringContaining('AGENTS.md'),
      },
    });
  });

  it('stops prompts that contain a likely secret', () => {
    const result = runHook('prompt-secret-detector', {
      prompt: `token: sk-${'a'.repeat(24)}`,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ continue: false });
  });

  it('reports the compaction trigger', () => {
    const result = runHook('compact-warning', { trigger: 'auto' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      systemMessage: '即将执行 auto context compaction。',
    });
  });

  it('continues when an unfinished TODO remains in the final response', () => {
    const result = runHook('stop-todo-continuation', {
      last_assistant_message: 'TODO: finish validation',
      stop_hook_active: false,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ decision: 'block' });
  });
});

function runHook(pluginId: string, payload: Record<string, unknown>) {
  const script = path.resolve(process.cwd(), 'plugins', pluginId, 'hooks', `${pluginId}.mjs`);
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
  });
}
