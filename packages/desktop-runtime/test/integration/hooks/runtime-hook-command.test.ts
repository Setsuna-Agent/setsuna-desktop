import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeToolHookRunner } from '../../../src/hooks/runtime-hooks.js';
import { hookContext, hookEventCapture } from '../../support/agent-loop/hook-lifecycle.js';
import { HooksConfigStore } from '../../support/agent-loop/shared.js';
import { createTestTempDirectory } from '../../support/test-temp-directory.js';

afterEach(() => vi.unstubAllEnvs());

describe('hook bundled Node execution', () => {
  it('runs the bundled prompt-secret detector without a system Node on PATH', async () => {
    const root = await createTestTempDirectory('setsuna hook bundled-');
    withoutHostNode();
    const script = path.resolve('plugins/prompt-secret-detector/hooks/prompt-secret-detector.mjs');
    const config = await hookConfig(root, `node ${quotePath(script)}`);
    const events = hookEventCapture();

    const outcome = await createRuntimeToolHookRunner(config)?.runUserPromptSubmit({
      ...hookInput(root, events),
      prompt: `token: sk-${'a'.repeat(24)}`,
    });

    expect(outcome).toMatchObject({
      shouldStop: true,
      stopReason: '这条消息看起来包含密钥或私钥片段。请先脱敏，再重新发送。',
    });
    expect(events.completed).toMatchObject([{ eventName: 'UserPromptSubmit', status: 'stopped' }]);
    expect(events.completed[0].stderrPreview).toBeUndefined();
  });

  it('uses the app Node ahead of a conflicting host Node for concurrent hooks', async () => {
    const root = await createTestTempDirectory('setsuna hook preferred-');
    const hostBin = path.join(root, 'host-bin');
    await mkdir(hostBin);
    const fakeNode = process.platform === 'win32'
      ? '@echo off\r\necho unexpected host Node 1>&2\r\nexit /b 42\r\n'
      : '#!/bin/sh\nprintf "unexpected host Node\\n" >&2\nexit 42\n';
    await writeFile(path.join(hostBin, process.platform === 'win32' ? 'node.cmd' : 'node'), fakeNode, { mode: 0o700 });
    withoutHostNode(hostBin);
    const script = path.join(root, 'inspect runtime.cjs');
    await writeFile(script, [
      "let input = ''; process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => input += chunk);",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  if (payload.prompt !== '中文消息') process.exit(3);",
      "  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: process.execPath } }));",
      '});',
    ].join('\n'));
    const command = `node ${quotePath(script)}`;
    const config = await hookConfig(root, command);
    config.hooks!.UserPromptSubmit![0].hooks.push({ type: 'command', command, timeoutSec: 5 });
    const events = hookEventCapture();

    const outcome = await createRuntimeToolHookRunner(config)?.runUserPromptSubmit({
      ...hookInput(root, events),
      prompt: '中文消息',
    });

    expect(outcome).toEqual({ shouldStop: false, additionalContexts: [process.execPath, process.execPath] });
    expect(events.completed).toHaveLength(2);
    expect(events.completed.every((run) => run.status === 'completed')).toBe(true);
    expect(process.env.PATH?.split(path.delimiter)[0]).toBe(hostBin);
  });

  it('reports environment preparation failures as hook failures and allows a later retry', async () => {
    const root = await createTestTempDirectory('setsuna-hook-prepare-failure-');
    const dataPath = path.join(root, 'data');
    await writeFile(dataPath, 'not a directory');
    const script = path.join(root, 'hook.cjs');
    await writeFile(script, 'process.stdout.write(JSON.stringify({ systemMessage: "准备成功" }));');
    const config = await hookConfig(dataPath, `node ${quotePath(script)}`);
    const runner = createRuntimeToolHookRunner(config);
    const events = hookEventCapture();

    await expect(runner?.runUserPromptSubmit(hookInput(root, events))).resolves.toEqual({
      shouldStop: false,
      additionalContexts: [],
    });
    expect(events.completed[0]).toMatchObject({ status: 'failed' });
    expect(events.completed[0].message).toMatch(/ENOTDIR|EEXIST/);

    await rm(dataPath);
    await runner?.runUserPromptSubmit(hookInput(root, events));

    expect(events.completed[1]).toMatchObject({
      status: 'completed',
      entries: [{ kind: 'warning', text: '准备成功' }],
    });
  });

  it('does not prepare a Node entrypoint during discovery or after cancellation', async () => {
    const root = await createTestTempDirectory('setsuna-hook-lazy-');
    const config = await hookConfig(root, 'node hook.cjs');
    const runner = createRuntimeToolHookRunner(config);
    const entrypointDirectory = path.join(root, 'hook-tools');
    expect(runner).not.toBeNull();
    await expect(stat(entrypointDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    const events = hookEventCapture();
    const controller = new AbortController();
    controller.abort();
    const input = hookInput(root, events);
    input.context.signal = controller.signal;

    await runner?.runUserPromptSubmit(input);

    expect(events.completed).toMatchObject([{ status: 'failed', message: 'hook aborted' }]);
    await expect(stat(entrypointDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function hookConfig(dataPath: string, command: string): Promise<RuntimeConfigState> {
  const config = await new HooksConfigStore({
    UserPromptSubmit: [{ hooks: [{ type: 'command', command, timeoutSec: 5 }] }],
  }).getConfig();
  return { ...config, dataPath, configPath: path.join(dataPath, 'config.json') };
}

function hookInput(cwd: string, events: ReturnType<typeof hookEventCapture>) {
  return {
    approvalPolicy: 'on-request' as const,
    context: hookContext(),
    environment: { id: 'local', cwd, workspaceRoot: cwd, workspaceRoots: [cwd] },
    events,
    prompt: 'hello',
  };
}

function withoutHostNode(hostBin = ''): void {
  const systemPaths = process.platform === 'win32'
    ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0'), path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')]
    : [];
  vi.stubEnv('PATH', [hostBin, ...systemPaths].filter(Boolean).join(path.delimiter));
  if (process.platform === 'win32') {
    vi.stubEnv('SHELL', '');
    vi.stubEnv('SETSUNA_WINDOWS_SHELL', '');
  }
}

function quotePath(value: string): string {
  return process.platform === 'win32'
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;
}
