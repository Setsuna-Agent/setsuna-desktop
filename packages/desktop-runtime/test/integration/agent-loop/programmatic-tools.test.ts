import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { QuickJsToolProgramRuntime } from '../../../src/adapters/tool-program/quickjs-tool-program-runtime.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { InMemoryApprovalGate } from '../../../src/adapters/approval/in-memory-approval-gate.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { mkDataDir, TestConfigStore } from '../../support/agent-loop/shared.js';
import { createHost } from '../adapters/tool/pc-local-tool-host.support.js';

describe('programmatic tools in the agent loop', () => {
  it('audits nested calls while exposing only printed results to the next model request', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Tool program' });
    const requests: ModelRequest[] = [];
    const loop = new AgentLoop({ ids, threadStore, eventBus: new InMemoryEventBus(), clock: systemClock,
      toolProgramRuntime: new QuickJsToolProgramRuntime(),
      toolHost: { listTools: async () => [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
        runTool: async () => ({ content: JSON.stringify({ answer: 42, intermediate: 'RAW_SHOULD_NOT_ENTER_CONTEXT' }) }) },
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        requests.push(request);
        if (requests.length === 1) {
          yield { type: 'tool_calls', toolCalls: [{ id: 'program', name: 'run_code', arguments: JSON.stringify({ code: 'const r = await tools.read_file({}); print(JSON.parse(r.content).answer);' }) }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else { yield { type: 'text_delta', text: 'Answer: 42' }; yield { type: 'done', finishReason: 'stop' }; }
      } },
    });
    await loop.sendTurn(thread.id, { input: 'Compute an answer.' });
    expect(requests).toHaveLength(2);
    expect(requests[0].tools?.some(tool => tool.name === 'run_code')).toBe(true);
    expect(JSON.stringify(requests[1].messages)).not.toContain('RAW_SHOULD_NOT_ENTER_CONTEXT');
    expect(requests[1].messages).toContainEqual(expect.objectContaining({ role: 'tool', toolCallId: 'program', content: '42' }));
    const saved = await threadStore.getThread(thread.id);
    expect(saved?.messages).toContainEqual(expect.objectContaining({ toolName: 'read_file', visibility: 'transcript', content: expect.stringContaining('RAW_SHOULD_NOT_ENTER_CONTEXT') }));
    expect((await threadStore.listEvents(thread.id)).filter(event => event.type === 'tool.completed')).toHaveLength(2);
  });

  it('requires an observed result before overwriting, even when concurrent calls are serialized', async () => {
    const { host, fixtureRoot, projectDir, projectId } = await createHost();
    const target = path.join(projectDir, 'source.txt');
    const original = 'existing user changes\n';
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(path.join(fixtureRoot, 'loop-data'), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Program file integrity', projectId });
    const runtime = new QuickJsToolProgramRuntime();
    const requests: ModelRequest[] = [];
    const loop = new AgentLoop({ ids, threadStore, eventBus: new InMemoryEventBus(), clock: systemClock,
      toolHost: host, toolProgramRuntime: runtime,
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        requests.push(request);
        if (requests.length === 1) {
          yield { type: 'tool_calls', toolCalls: [{ id: 'program', name: 'run_code', arguments: JSON.stringify({ code: `
            const batch = await Promise.allSettled([
              tools.read_file({file_path: 'source.txt'}),
              tools.write_file({file_path: 'source.txt', content: 'blind overwrite'})
            ]);
            text(batch[1].status);
            const source = await tools.read_file({file_path: 'source.txt'});
            await tools.write_file({file_path: 'source.txt', content: source.content.slice(source.content.indexOf('\\n') + 1) + 'reviewed\\n'});
          ` }) }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else { yield { type: 'text_delta', text: 'Updated the observed source.' }; yield { type: 'done', finishReason: 'stop' }; }
      } },
    });
    try {
      await writeFile(target, original);
      await loop.sendTurn(thread.id, { input: 'Update source after inspecting it.' });
      expect(requests[1].messages).toContainEqual(expect.objectContaining({ toolCallId: 'program', status: 'complete', content: 'rejected' }));
      expect(await readFile(target, 'utf8')).toBe(`${original}reviewed\n`);
      const messages = (await threadStore.getThread(thread.id))!.messages;
      expect(messages.filter(message => message.toolName === 'write_file').map(message => message.status)).toEqual(['error', 'complete']);
    } finally {
      runtime.shutdown();
      await host.shutdown();
      await threadStore.close();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each(['native', 'program'] as const)('checks final rewritten inputs for %s parallel calls', async mode => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Final input approval' });
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const wait = vi.spyOn(approvalGate, 'waitForDecision').mockImplementation(async approvalId => {
      await approvalGate.answerApproval(approvalId, { decision: 'reject' });
      return { decision: 'reject' };
    });
    const runTool = vi.fn(async () => ({ content: 'protected data' }));
    let step = 0;
    const loop = new AgentLoop({ ids, threadStore, eventBus: new InMemoryEventBus(), clock: systemClock,
      approvalGate, configStore: new TestConfigStore(), toolProgramRuntime: new QuickJsToolProgramRuntime(),
      extensionManager: { dispatch: async event => event === 'tool.before' ? { input: { file_path: 'protected.txt' } } : {} },
      toolHost: { listTools: async () => [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
        toolRuntimeProfile: () => ({ supportsParallel: true }),
        approvalForTool: async (_name, args) => (args as { file_path: string }).file_path === 'protected.txt' ? { reason: 'Protected file' } : null,
        runTool },
      modelClient: { async *stream(): AsyncGenerator<ModelStreamEvent> {
        if (++step === 1) {
          const calls = ['one.txt', 'two.txt'].map(file => ({ id: file, name: 'read_file', arguments: JSON.stringify({ file_path: file }) }));
          yield { type: 'tool_calls', toolCalls: mode === 'native' ? calls : [{ id: 'program', name: 'run_code', arguments: JSON.stringify({
            code: `text(await Promise.allSettled(['one.txt', 'two.txt'].map(file_path => tools.read_file({file_path}))));`,
          }) }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else { yield { type: 'text_delta', text: 'Access rejected.' }; yield { type: 'done', finishReason: 'stop' }; }
      } },
    });
    await loop.sendTurn(thread.id, { input: 'Read both files.' });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(runTool).not.toHaveBeenCalled();
    const results = (await threadStore.getThread(thread.id))!.messages.filter(message => message.toolName === 'read_file');
    expect(results).toHaveLength(2);
    expect(results.every(message => message.status === 'error')).toBe(true);
  });
});
