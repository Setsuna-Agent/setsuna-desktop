import type { RuntimeApprovalRequest } from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { loadYoga } from 'yoga-layout/load';
import { expect, it } from 'vitest';
import { createRuntimeServerTestHarness } from '../../../../desktop-runtime/test/support/runtime-server/harness.js';
import { ONE_PIXEL_PNG_BASE64 } from '../../../../desktop-runtime/test/support/runtime-server/rest-capabilities.js';
import { readRequestText } from '../../../../desktop-runtime/test/support/runtime-server/shared.js';
import { designDocumentVersion, type DesignSnapshot } from '../../src/contracts/index.js';
import { designSelectionMentionText } from '../../src/contracts/design-selection-mention.js';
import type { DesignTaskClient } from '../../src/contracts/design-task.js';
import { emptyDesignLibraryResources } from '../../src/renderer/components/design-library-resources.js';
import { projectDesignComponents } from '../../src/renderer/components/design-components.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { runDesignSelectionTask } from '../../src/renderer/agent/design-selection-task.js';

it('runs a scoped canvas turn through the tool harness, returns pixels to the model and preserves undo after a second adjustment', async () => {
  const harness = await createRuntimeServerTestHarness();
  type ProviderRequest = { tools?: { function: { name: string } }[]; messages: { role: string; content?: string | { text?: string }[] | null }[] };
  const observed: ProviderRequest[] = [];
  const finishFirst = Promise.withResolvers<void>();
  let ordinaryRequest: ProviderRequest | undefined;
  const hasSkillBody = (request: ProviderRequest, body: string) => request.messages.some(({ content }) =>
    typeof content === 'string' ? content.includes(body) : content?.some((part) => part.text?.includes(body)));
  let mode: 'layout' | 'delete' | 'resume' = 'layout';
  let disk: DesignSnapshot;
  let group: string | undefined;
  const png = 'data:image/png;base64,' + ONE_PIXEL_PNG_BASE64;
  const provider = createServer(async (req, res) => {
    const body = JSON.parse(await readRequestText(req));
    const tool = (name: string, args: unknown) => ({ tool_calls: [{ id: 'call_' + observed.length, index: 0, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] });
    let delta: { content: string } | ReturnType<typeof tool> = { content: 'Done.' };
    if (body.tools?.some((entry: { function: { name: string } }) => entry.function.name === 'design_edit')) {
      observed.push(body);
      const latestTool = () => JSON.parse(body.messages.findLast((entry: { role: string }) => entry.role === 'tool').content);
      if (mode === 'resume') {
        if (body.messages.at(-1)?.role === 'user') delta = tool('design_inspect', {});
      } else if (mode === 'delete') {
        if (observed.length === 1) delta = tool('design_edit', { action: 'delete', ids: ['a'], revision: disk.revision });
      } else if (body.messages.at(-1)?.role === 'user' && JSON.stringify(body.messages.at(-1)).includes('Use this reference.')) {
        delta = tool('design_inspect', {});
      } else if (observed.length === 1) delta = tool('run_code', { code: 'text((await tools.design_inspect({})).content)' });
      else if (observed.length === 2) {
        const first = { action: 'layout', fields: { direction: 'horizontal', gap: 30 }, revision: latestTool().revision };
        delta = tool('run_code', { code: `
          const group = (await tools.design_edit(${JSON.stringify(first)})).data;
          const adjusted = await tools.design_edit({ action: "layout", ids: group.ids, revision: group.revision, fields: {gap: 24} });
          text(JSON.parse(adjusted.content));
        ` });
      }
      else if (observed.length === 3) delta = tool('design_preview', {});
      else if (observed.length === 4 && JSON.stringify(body.messages).includes(ONE_PIXEL_PNG_BASE64)) {
        const preview = latestTool();
        delta = tool('design_edit', { ids: preview.ids, action: 'layout', fields: { gap: preview.bounds.width > 200 ? 12 : 24 }, revision: preview.revision });
      }
      else if (observed.length === 5) await finishFirst.promise;
    } else if (body.tools?.length) ordinaryRequest = body;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: 'tool_calls' in delta ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  const session = new AbortController();
  try {
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port.');
    await harness.configureOpenAiProvider('designer', 'http://127.0.0.1:' + address.port + '/v1', { supportsImages: true });
    const root = path.join(harness.runtimeDataDir, 'project');
    await mkdir(root);
    const post = (url: string, body: unknown, signal?: AbortSignal) => harness.runtimeFetch(url, { method: 'POST', body: JSON.stringify(body), signal });
    const project = await post('/v1/projects', { name: 'Design', path: root });
    const ref = { projectId: project.id as string, path: 'cards.design.json' };
    const box = { kind: 'frame', width: 50, height: 50, x: 0, y: 0, childIds: [] };
    await writeFile(path.join(root, ref.path), JSON.stringify({ schemaVersion: designDocumentVersion, documentId: 'cards', rootIds: ['master', 'a', 'b', 'c'],
      nodes: { master: { ...box, component: true }, a: { ...box, instanceOf: 'master' }, b: { ...box, instanceOf: 'master', y: 60 },
        c: { ...box, instanceOf: 'master', y: 120 } } }));
    const base = '/v1/features/design';
    const read = async () => disk = await harness.runtimeFetch(base + '/documents?' + new URLSearchParams(ref)) as DesignSnapshot;
    const client: DesignTaskClient = { bindInput: (input, signal) => post(base + '/tasks/bind-input', input, signal),
      watchCommand: (input, signal) => post(base + '/tasks/watch-command', input, signal),
      start: (input, signal) => post(base + '/tasks', input, signal),
      reply: (input, signal) => post(base + '/tasks/reply', input, signal), stop: (sessionId) => post(base + '/tasks/stop', { sessionId }) };
    await read();
    const yoga = await loadYoga();
    const view = () => {
      const document = disk.document;
      const projected = projectDesignComponents(document);
      const scene = resolveDesignScene(yoga, projected, () => ({ width: 0, height: 0 }));
      return { document, projected, scene, layoutEngine: yoga, resources: emptyDesignLibraryResources, preview: async (ids: readonly string[]) => {
        group = ids[0];
        expect(projected.nodes[group]).toMatchObject({ layout: { gap: 24 } });
        return { image: png, bounds: scene[group].paintBounds };
      } };
    };
    const owner = { ref, documentId: 'cards' };
    const skillPath = '/v1/features/skills/design-canvas';
    const skill = await harness.runtimeFetch(skillPath);
    // The same project and design vocabulary can occur in an ordinary chat without an editor binding.
    const ordinary = await post('/v1/threads', { projectId: ref.projectId, title: 'About cards' });
    const turn = await post('/v1/threads/' + ordinary.id + '/turns', { input: 'Explain card layout.' });
    await harness.waitForCompletedTurn(ordinary.id, turn.turnId);
    expect(ordinaryRequest).toBeDefined();
    expect(hasSkillBody(ordinaryRequest!, skill.content)).toBe(false);
    const { id: threadId } = await post(base + '/conversations', owner);
    const postTurn = (input: string, attachments: unknown[] = []) => post('/v1/threads/' + threadId + '/turns', { input, attachments });
    const live = new AbortController();
    const ready = Promise.withResolvers<void>();
    const sessionId = randomUUID();
    const exchange = runDesignSelectionTask({ sessionId, client, ref, selection: ['a', 'b', 'c'], threadId,
      onReady: ready.resolve, signal: live.signal, view, synchronize: read, approve: async () => true });
    const released = exchange.catch((error) => { if (!live.signal.aborted) throw error; });
    await ready.promise;
    const prompt = 'Arrange the selected cards, preview and refine.';
    const first = await postTurn(prompt);
    await expect.poll(() => observed.length, { timeout: 10_000 }).toBe(5);
    expect(hasSkillBody(observed[0], skill.content)).toBe(true);
    await harness.runtimeFetch(skillPath, { method: 'PATCH', body: JSON.stringify({ patch: { enabled: false } }) });
    await client.bindInput({ sessionId, clientId: 'second-design-input', selection: ['b'] }, live.signal);
    const second = await post('/v1/threads/' + threadId + '/queued-turn-inputs', {
      clientId: 'second-design-input', input: 'Use this reference.', attachments: [{ id: 'reference', name: 'reference.png', type: 'image/png',
      size: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64').length, url: png }] });
    expect(second.disposition).toBe('queued');
    finishFirst.resolve();
    const secondInput = (await harness.waitForThread(threadId, (thread) =>
      thread.messages.some((message) => message.clientId === 'second-design-input'))).messages.find((message) => message.clientId === 'second-design-input')!;
    expect(secondInput.turnId).not.toBe(first.turnId);
    const restored = await harness.waitForCompletedTurn(threadId, secondInput.turnId!);
    expect(hasSkillBody(observed.at(-1)!, skill.content)).toBe(false);
    const inspection = observed.at(-1)!.messages.findLast((message) => message.role === 'tool');
    expect(JSON.parse(String(inspection?.content))).toMatchObject({ selection: ['b'] });
    live.abort();
    await released;
    expect(restored.messages.filter((message) => message.role === 'user')).toMatchObject([
      { content: prompt }, { content: 'Use this reference.', attachments: [{ name: 'reference.png' }] },
    ]);
    expect(JSON.stringify(observed.at(-1)?.messages)).toContain(prompt);
    const other = { ...ref, path: 'copy.design.json' };
    await writeFile(path.join(root, other.path), JSON.stringify(disk.document));
    expect(await post(base + '/conversations/list', { ...owner, ref: other })).toEqual([]);
    await expect(client.start({ sessionId: randomUUID(), ...owner, ref: other, selection: [], threadId }, session.signal)).rejects.toThrow();
    const tools = observed[0]?.tools?.map((item) => item.function.name);
    expect(tools).not.toContain('design_document');
    expect(JSON.stringify(observed[1]?.messages)).toContain('instanceOf');
    expect(JSON.stringify(observed[3]?.messages)).toContain(ONE_PIXEL_PNG_BASE64);
    expect(disk.document.nodes[group!]).toMatchObject({ childIds: ['a', 'b', 'c'], layout: { gap: 12 } });
    const undo = () => post(base + '/documents/history', { ref, expectedRevision: disk.revision, direction: 'undo' });
    disk = await undo();
    expect(disk.document.nodes[group!]).toMatchObject({ layout: { gap: 24 } });
    disk = await undo();
    expect(disk.document.nodes[group!]).toMatchObject({ layout: { gap: 30 } });
    disk = await undo();
    expect(disk.document.rootIds).toEqual(['master', 'a', 'b', 'c']);
    expect(disk.document.nodes.b).toMatchObject({ instanceOf: 'master', y: 60 });

    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const reopened = await harness.runtimeFetch('/v1/threads/' + threadId);
    expect(reopened.messages.filter((message: { role: string }) => message.role === 'user')).toMatchObject([
      { content: prompt }, { attachments: [{ name: 'reference.png' }] },
    ]);
    expect(await post(base + '/conversations/list', owner)).toEqual([expect.objectContaining({ id: threadId })]);

    mode = 'delete';
    await harness.runtimeFetch('/v1/config', { method: 'PUT', body: JSON.stringify({ approvalPolicy: 'strict', approvalReviewer: 'user' }) });
    async function requestDelete(approve: boolean) {
      observed.length = 0;
      const key = randomUUID();
      const ready = await client.start({ sessionId: key, ...owner, selection: ['a'], threadId }, session.signal);
      if (ready.kind !== 'ready') throw new Error('Expected a bound editor.');
      const step = client.reply({ sessionId: key, id: ready.id, result: { content: '' } }, session.signal);
      const turn = await postTurn('Delete A.');
      const pendingApproval = async () => {
        const { approvals } = await harness.runtimeFetch('/v1/approvals');
        return (approvals as RuntimeApprovalRequest[]).find((item) => item.turnId === turn.turnId && item.status === 'pending' && item.reviewer !== 'automatic');
      };
      await expect.poll(pendingApproval).toBeDefined();
      await post('/v1/approvals/' + (await pendingApproval())!.id, { decision: approve ? 'approve' : 'reject' });
      return { key, step, turn };
    }
    const denied = await requestDelete(false);
    await harness.waitForCompletedTurn(threadId, denied.turn.turnId);
    await client.stop(denied.key);
    expect((await denied.step).kind).toBe('done');
    expect((await read()).document.nodes.a).toBeDefined();

    async function pendingDelete() {
      const { key, step: pending, turn } = await requestDelete(true);
      const step = await pending;
      if (step.kind !== 'tool' || step.name !== 'design_edit') throw new Error('Expected a pending edit.');
      const revision = disk.revision;
      return { key, turnId: turn.turnId, submit: (nodeId: string) => client.reply({
        sessionId: key, id: step.id, result: { content: '', plan: { revision, edits: [{ kind: 'remove', nodeId }] } },
      }, session.signal) };
    }

    const outside = await pendingDelete();
    const refused = outside.submit('b');
    await harness.waitForCompletedTurn(threadId, outside.turnId);
    await client.stop(outside.key);
    await refused;
    expect(JSON.stringify(observed.at(-1)?.messages)).toContain('outside the bound selection');
    expect((await read()).document.nodes.b).toBeDefined();

    const conflict = await pendingDelete();
    await post(base + '/documents/edits', { ref, expectedRevision: disk.revision,
      edits: [{ kind: 'update', nodeId: 'a', node: { ...disk.document.nodes.a, name: 'Human edit' } }] });
    const outdated = conflict.submit('a');
    await harness.waitForCompletedTurn(threadId, conflict.turnId);
    await client.stop(conflict.key);
    await outdated;
    expect(JSON.stringify(observed.at(-1)?.messages)).toContain('changed on disk');
    expect((await read()).document.nodes.a.name).toBe('Human edit');

    const stopped = await pendingDelete();
    const clientId = 'resume-layer-b';
    await client.bindInput({ sessionId: stopped.key, clientId, selection: ['b'] }, session.signal);
    const queueUrl = '/v1/threads/' + threadId + '/queued-turn-inputs';
    const selected = designSelectionMentionText({ ref, documentId: 'cards', boards: [], ids: ['b'], label: 'Original B' });
    const queued = await post(queueUrl, { clientId, input: 'Inspect ' + selected });
    expect(queued.disposition).toBe('queued');
    // Old clients only stored mentions in the text; some stored no target at all.
    const mention = designSelectionMentionText({ documentId: 'cards', boards: [], ids: ['c'], label: 'Card C' });
    const referenced = await post(queueUrl, { input: 'Inspect ' + mention });
    const copyPick = designSelectionMentionText({ ref: other, documentId: 'cards', boards: [], ids: ['c'], label: 'Copy of C' });
    const copied = await post(queueUrl, { input: 'Modify ' + copyPick });
    const unscoped = await post(queueUrl, { input: 'Modify the selected layer.' });
    await client.stop(stopped.key);
    await expect(stopped.submit('a')).rejects.toThrow();
    expect((await read()).document.rootIds).toEqual(['master', 'a', 'b', 'c']);
    const sendNow = () => post(queueUrl + '/' + queued.queuedInputId + '/send-now', {});
    await expect(sendNow()).rejects.toThrow('editor is unavailable');
    await harness.runtimeFetch('/v1/projects/' + ref.projectId + '/entries?' + new URLSearchParams({ path: ref.path }), {
      method: 'PATCH', body: JSON.stringify({ name: 'renamed.design.json' }),
    });
    ref.path = 'renamed.design.json';
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const paused = await harness.runtimeFetch('/v1/threads/' + threadId);
    expect(paused.queuedTurnInputs).toMatchObject([
      { clientId, editorSelection: { documentId: 'cards', ids: ['b'] } }, { id: referenced.queuedInputId }, { id: copied.queuedInputId }, { id: unscoped.queuedInputId },
    ]);

    // A fresh editor may be showing C when the user resumes the saved input for B.
    mode = 'resume';
    await harness.runtimeFetch('/v1/config', { method: 'PUT', body: JSON.stringify({ approvalPolicy: 'never' }) });
    const reopenedEditor = new AbortController();
    const bound = Promise.withResolvers<void>();
    const running = runDesignSelectionTask({ client, ref, threadId, selection: ['c'], signal: reopenedEditor.signal,
      onReady: bound.resolve, view, synchronize: read, approve: async () => true }).catch((error) => {
      if (!reopenedEditor.signal.aborted) throw error;
    });
    try {
      await Promise.race([bound.promise, running]);
      const resumed = await sendNow();
      await harness.waitForCompletedTurn(threadId, resumed.turnId);
      const dispatched = await harness.waitForThread(threadId, (thread) => thread.messages.some((message) => message.clientId === referenced.queuedInputId));
      const legacyTurn = dispatched.messages.find((message) => message.clientId === referenced.queuedInputId)!;
      await harness.waitForCompletedTurn(threadId, legacyTurn.turnId!);
      const inspections = observed.filter((request) => request.messages.at(-1)?.role === 'tool')
        .slice(-2).map((request) => JSON.parse(String(request.messages.at(-1)?.content)).selection);
      expect(inspections).toEqual([['b'], ['c']]);
      const copyUrl = queueUrl + '/' + copied.queuedInputId;
      await expect(post(copyUrl + '/send-now', {})).rejects.toThrow('another design');
      expect(await post(copyUrl + '/retrieve', {})).toMatchObject({ id: copied.queuedInputId });
      const unscopedUrl = queueUrl + '/' + unscoped.queuedInputId;
      expect(await post(unscopedUrl + '/send-now', {})).toMatchObject({ disposition: 'queued', turnId: null });
      expect(await post(unscopedUrl + '/retrieve', {})).toMatchObject({ id: unscoped.queuedInputId, input: 'Modify the selected layer.' });
    } finally { reopenedEditor.abort(); await running; }
  } finally {
    finishFirst.resolve();
    session.abort();
    await harness.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
