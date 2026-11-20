import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { createRuntimeServerTestHarness } from '../../../../desktop-runtime/test/support/runtime-server/harness.js';
import { readRequestText } from '../../../../desktop-runtime/test/support/runtime-server/shared.js';
import { designDocumentVersion, type DesignSnapshot } from '../../src/contracts/index.js';
import type { DesignTaskClient } from '../../src/contracts/design-task.js';
import { runDesignSelectionTask, type DesignTaskView } from '../../src/renderer/agent/design-selection-task.js';
import { emptyDesignLibraryResources } from '../../src/renderer/components/design-library-resources.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';

it('dispatches named designers with independent selections and recovers a concurrent edit without overwriting the other board', async () => {
  const harness = await createRuntimeServerTestHarness();
  const boards = [{ id: 'nav', name: '导航' }, { id: 'chart', name: '图表' }];
  const releaseWrites = Promise.withResolvers<void>();
  const bothRead = Promise.withResolvers<void>();
  const reading = new Set<string>();
  const focuses = new Map<string, { board: string | null; color: number }>();
  let conflicts = 0;
  let spawned = 0;
  let callId = 0;
  const provider = createServer(async (req, res) => {
    const body = JSON.parse(await readRequestText(req)) as {
      messages: { role: string; content: string }[]; tools?: { function: { name: string } }[];
    };
    const names = body.tools?.map((tool) => tool.function.name) ?? [];
    const child = boards.find(({ id }) => body.messages.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('work_on_' + id)));
    const tools = body.messages.filter((m) => m.role === 'tool');
    let call: { name: string; args: unknown } | undefined;
    if (child && names.includes('design_edit')) {
      const last = tools.at(-1)?.content;
      if (!last) call = { name: 'design_view', args: { action: 'select', ids: [child.id] } };
      else if (tools.length === 1) call = { name: 'design_inspect', args: {} };
      else if (last.includes('REVISION_CONFLICT')) {
        conflicts++;
        call = { name: 'design_inspect', args: {} };
      } else if (last.includes('"layers"')) {
        const { revision } = JSON.parse(last);
        reading.add(child.id);
        if (reading.size === boards.length) bothRead.resolve();
        await releaseWrites.promise;
        call = { name: 'design_edit', args: { action: 'update', revision, fields: { name: child.name } } };
      }
    } else if (!child && names.includes('spawn_agent') && spawned < boards.length) {
      const { name, id } = boards[spawned++];
      call = { name: 'spawn_agent', args: { name, prompt: 'work_on_' + id } };
    }
    const delta = call ? { tool_calls: [{ id: 'call_' + ++callId, index: 0, type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Done.' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  const live = new AbortController();
  let exchange: Promise<void> | undefined;
  try {
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port.');
    await harness.configureOpenAiProvider('designer', 'http://127.0.0.1:' + address.port + '/v1');
    const root = path.join(harness.runtimeDataDir, 'project');
    await mkdir(root);
    const post = (url: string, body: unknown, signal?: AbortSignal) => harness.runtimeFetch(url, { method: 'POST', body: JSON.stringify(body), signal });
    const project = await post('/v1/projects', { name: 'Design', path: root });
    const ref = { projectId: project.id as string, path: 'team.design.json' };
    const frame = { kind: 'frame', y: 0, width: 100, height: 100, childIds: [] };
    await writeFile(path.join(root, ref.path), JSON.stringify({ schemaVersion: designDocumentVersion, documentId: 'team',
      rootIds: boards.map((b) => b.id), nodes: { nav: { ...frame, x: 0 }, chart: { ...frame, x: 200 } } }));
    const base = '/v1/features/design';
    const owner = { ref, documentId: 'team' };
    const { id: threadId } = await post(base + '/conversations', owner);
    const client: DesignTaskClient = { bindInput: (input, signal) => post(base + '/tasks/bind-input', input, signal),
      watchCommand: (input, signal) => post(base + '/tasks/watch-command', input, signal),
      start: (input, signal) => post(base + '/tasks', input, signal),
      reply: (input, signal) => post(base + '/tasks/reply', input, signal), stop: (sessionId) => post(base + '/tasks/stop', { sessionId }) };
    const read = () => harness.runtimeFetch(base + '/documents?' + new URLSearchParams(ref)) as Promise<DesignSnapshot>;
    let snapshot = await read();
    const layoutEngine = await loadYoga();
    const ready = Promise.withResolvers<void>();
    exchange = runDesignSelectionTask({ client, ref, selection: ['nav'], threadId, signal: live.signal, onReady: ready.resolve,
      approve: async () => true, synchronize: async () => snapshot = await read(), view(): DesignTaskView {
        const { document } = snapshot;
        return { document, projected: document, layoutEngine, resources: emptyDesignLibraryResources,
          scene: resolveDesignScene(layoutEngine, document, () => ({ width: 0, height: 0 })),
          preview: async () => { throw new Error('Unexpected preview.'); },
          showFocus(targets, _deleted, agent) {
            if (!agent) return;
            if (targets?.length) focuses.set(agent.name, { board: targets[0].boardId, color: agent.colorIndex });
            else focuses.delete(agent.name);
          },
        };
      } }).catch((error) => { if (!live.signal.aborted) throw error; });
    await Promise.race([ready.promise, exchange]);
    const turn = await post('/v1/threads/' + threadId + '/turns', { input: 'Divide the canvas work.' });
    const completed = harness.waitForCompletedTurn(threadId, turn.turnId);
    await Promise.race([bothRead.promise, completed]);
    expect(focuses.get('导航')?.board).toBe('nav');
    expect(focuses.get('图表')?.board).toBe('chart');
    expect(focuses.get('导航')?.color).not.toBe(focuses.get('图表')?.color);
    releaseWrites.resolve();
    await completed;
    expect(conflicts).toBe(1);
    expect((await read()).document.nodes).toMatchObject({ nav: { name: '导航' }, chart: { name: '图表' } });
    await expect.poll(() => focuses.size).toBe(0);
    expect(await post(base + '/conversations/list', owner)).toEqual([expect.objectContaining({ id: threadId })]);
  } finally {
    releaseWrites.resolve();
    live.abort();
    await exchange;
    await harness.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
