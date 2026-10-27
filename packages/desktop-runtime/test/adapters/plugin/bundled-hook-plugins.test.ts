import { spawnSync } from 'node:child_process';
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
    expect(runHook('guard-dangerous-shell', {
      tool_input: { command: String.raw`powershell -Command "Remove-Item C:\ -Force -Recurse"` },
    }).status).toBe(2);
    expect(runHook('guard-dangerous-shell', {
      tool_input: { command: 'Remove-Item C:\\repo\\old.txt; Get-ChildItem C:\\' },
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

  it('stops prompts that contain a likely secret', () => {
    const result = runHook('prompt-secret-detector', {
      prompt: `token: sk-${'a'.repeat(24)}`,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ continue: false });
  });
});

function runHook(pluginId: string, payload: Record<string, unknown>) {
  const script = path.resolve(process.cwd(), 'plugins', pluginId, 'hooks', `${pluginId}.mjs`);
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
  });
}
