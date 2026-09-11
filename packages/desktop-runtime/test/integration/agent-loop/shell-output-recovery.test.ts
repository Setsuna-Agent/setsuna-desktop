import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileToolResultStore } from '../../../src/adapters/store/file-tool-result-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { shellSandboxCapability } from '../../../src/adapters/tool/pc-local/pc-local-tools.js';
import { estimateUtf8Tokens } from '../../../src/loop/tools/tool-output-budget.js';
import { RuntimeToolRouter } from '../../../src/loop/tools/tool-router.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { systemClock } from '../../../src/ports/clock.js';
import { FullApprovalConfigStore, TestConfigStore, waitForTurnCompleted } from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { createHost, execFileAsync, nodeCommand, restrictedShellExecutionUnavailable } from '../adapters/tool/pc-local-tool-host.support.js';

describe('shell output across the model and result store', () => {
  it.each(['native', 'linux'] as const)('keeps review Git inspection available with %s sandbox capability', async (capability) => {
    const { host, fixtureRoot, projectDir, projectId } = await createHost(capability === 'linux'
      ? { shellSandboxCapability: () => shellSandboxCapability('linux') } : {});
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(path.join(fixtureRoot, 'loop-data'), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Read-only review', projectId });
    await execFileAsync('git', ['init'], { cwd: projectDir });
    await writeFile(path.join(projectDir, 'tracked.txt'), 'before\n');
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: projectDir });
    await writeFile(path.join(projectDir, 'tracked.txt'), 'after\n');
    await writeFile(path.join(projectDir, 'review.cjs'), [
      "const fs = require('node:fs');",
      "try { fs.writeFileSync('tracked.txt', 'unauthorized'); } catch { console.log('write blocked'); }",
      "process.stdout.write(require('node:child_process').execFileSync('git', ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--', 'tracked.txt']));",
    ].join('\n'));
    const fallback = capability === 'linux' || restrictedShellExecutionUnavailable;
    const modelClient = new ShellModelClient(`${nodeCommand()} review.cjs`, fallback
      ? { name: 'git_inspect', input: { operation: 'diff', path: 'tracked.txt' } } : undefined);
    const config = await new FullApprovalConfigStore('danger-full-access').getConfig();
    const loop = new AgentLoop({
      threadStore, modelClient, toolHost: host, eventBus: new InMemoryEventBus(), clock: systemClock, ids,
      configStore: new TestConfigStore({
        ...config,
        sandboxWorkspaceWrite: { writableRoots: [projectDir], networkAccess: true },
      }),
    });
    try {
      const turn = await loop.startReviewTurn(thread.id, {
        displayText: 'Review changes', prompt: 'Inspect the diff.',
        developerInstructions: 'Review mode is read-only.', language: 'en-US',
      });
      await waitForTurnCompleted(threadStore, thread.id, turn.turnId);
      const tools = modelClient.requests[0].tools?.map((tool) => tool.name) ?? [];
      expect(tools).toContain(fallback ? 'git_inspect' : 'exec_command');
      expect(tools).not.toContain(fallback ? 'exec_command' : 'git_inspect');
      expect(tools).toContain('read_shell_process');
      expect(tools).not.toContain('write_file');
      expect(tools).not.toContain('write_stdin');
      const output = modelClient.requests[1]?.messages.find((item) => item.role === 'tool')?.content ?? '';
      if (!fallback) expect(output).toContain('write blocked');
      expect(output).toContain('+after');
      expect(await readFile(path.join(projectDir, 'tracked.txt'), 'utf8')).toBe('after\n');
    } finally {
      await host.shutdown();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([0, 7])('recovers complete large UTF-8 stdout and stderr after exit %i within the requested model budget', async (exitCode) => {
    const { host, fixtureRoot, projectDir, projectId } = await createHost();
    const ids = new RandomIdGenerator();
    const dataDir = path.join(fixtureRoot, 'loop-data');
    const threadStore = createTestThreadStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Large shell output', projectId });
    const expectedStdout = '开始\n' + '中🙂'.repeat(300_000) + '\n结束';
    const expectedStderr = '完整错误信息';
    await writeFile(path.join(projectDir, 'output.cjs'), [
      "process.stdout.write('开始\\n' + '中🙂'.repeat(300000) + '\\n结束');",
      "process.stderr.write('完整错误信息');",
      `process.exitCode = ${exitCode};`,
    ].join('\n'));
    const modelClient = new ShellModelClient(`${nodeCommand()} output.cjs`);
    const toolResultStore = new FileToolResultStore(dataDir);
    const loop = new AgentLoop({
      threadStore, modelClient, toolResultStore, toolHost: host,
      eventBus: new InMemoryEventBus(), clock: systemClock, ids,
      configStore: new FullApprovalConfigStore('danger-full-access'),
    });

    try {
      await loop.sendTurn(thread.id, { input: 'Inspect command output.' });
      const message = modelClient.requests[1]?.messages.find((item) => item.role === 'tool' && item.toolName === 'exec_command');
      expect(message).toBeDefined();
      expect(estimateUtf8Tokens(message!.content)).toBeLessThanOrEqual(256);
      expect(message!.toolResultRef?.visibleTokenLimit).toBe(256);
      expect(message!.toolResultRef?.locallyTruncated).not.toBe(true);
      const events = await threadStore.listEvents(thread.id, 0);
      const completed = events.find((event) => event.type === 'tool.completed');
      expect(completed?.payload.status).toBe(exitCode === 0 ? 'success' : 'error');
      // UI previews retain their own bounded text; data must contain no output copy.
      expect(Buffer.byteLength(JSON.stringify(completed))).toBeLessThan(256_000);
      expect(Buffer.byteLength(JSON.stringify(completed?.payload.data ?? {}))).toBeLessThan(1_000);
      if (exitCode === 0) expect(completed?.payload.data).toMatchObject({ running: false, exit_code: 0 });
      const saved = await threadStore.getThread(thread.id);
      const toolRuns = saved?.messages.flatMap((item) => item.toolRuns ?? []) ?? [];
      expect(toolRuns).toHaveLength(1);
      expect(Buffer.byteLength(JSON.stringify(toolRuns))).toBeLessThan(256_000);
      const resultId = message!.toolResultRef!.resultId;
      const router = await RuntimeToolRouter.create({
        toolHost: host, toolResultStore, orchestrator: null, approvalPolicy: 'full',
        context: {
          environment: await host.environmentForToolContext({ threadId: thread.id, projectId }),
          permissionProfile: 'danger-full-access', sandboxWorkspaceWrite: {},
          signal: new AbortController().signal, threadId: thread.id, turnId: 'recovery',
        },
      });
      let recovered = '';
      let offset = 0;
      for (;;) {
        const page = await router.runReadToolResult({ result_id: resultId, offset }, thread.id);
        recovered += page.slice(page.indexOf('\n\n') + 2);
        const next = page.match(/^next_offset: (\d+)$/mu)?.[1];
        if (!next) break;
        expect(Number(next)).toBeGreaterThan(offset);
        offset = Number(next);
      }
      expect(recovered).toContain(`Stdout:\n${expectedStdout}\nStderr:\n${expectedStderr}`);
      expect(recovered).not.toContain('\uFFFD');
      expect(modelClient.requests).toHaveLength(2);
    } finally {
      await host.shutdown();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

class ShellModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly command: string, private readonly call?: { name: string; input: Record<string, unknown> }) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'shell_call', name: this.call?.name ?? 'exec_command', arguments: JSON.stringify(this.call?.input ?? {
          cmd: this.command, yield_time_ms: 0, max_output_tokens: 256,
        }) }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', finishReason: 'stop' };
  }
}
