import { createServer } from 'node:http';
import { loadYoga } from 'yoga-layout/load';
import { expect, it, vi } from 'vitest';
import { createRuntimeServerTestHarness } from '../../../../desktop-runtime/test/support/runtime-server/harness.js';
import { ONE_PIXEL_PNG_BASE64 } from '../../../../desktop-runtime/test/support/runtime-server/rest-capabilities.js';
import { readRequestText } from '../../../../desktop-runtime/test/support/runtime-server/shared.js';
import { chatDesignResult, designMentionText, type DesignSnapshot } from '../../src/contracts/index.js';
import type { DesignTaskClient } from '../../src/contracts/design-task.js';
import { createDesignClient } from '../../src/renderer/client.js';
import { defaultDesignCanvasSettings } from '../../src/renderer/context/design-canvas-settings.js';
import type { DesignAgentFocus } from '../../src/renderer/agent/design-agent-focus.js';
import { runDesignSelectionTask } from '../../src/renderer/agent/design-selection-task.js';
import { emptyDesignLibraryResources } from '../../src/renderer/components/design-library-resources.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';

it('waits for the main chat canvas, edits and inspects real layers, and rejects commands after the draft changes project', async () => {
  const harness = await createRuntimeServerTestHarness();
  const live = new AbortController();
  const inspected = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const catalogs: string[][] = [];
  const focus: DesignAgentFocus[] = [];
  let exchange: Promise<void> | undefined;
  let savedRevision = '';
  let resourcePaths: string[] = [];
  let images: string[] = [];
  let privateImage = '';
  let ownImage = '';
  let reference = '';
  let board = '';
  const provider = createServer(async (request, response) => {
    const body = JSON.parse(await readRequestText(request));
    let call: { name: string; args: unknown } | undefined;
    if (body.tools?.length) {
      catalogs.push(body.tools.map((tool: { function: { name: string } }) => tool.function.name));
      const result = () => JSON.parse(body.messages.findLast((message: { role: string }) => message.role === 'tool').content);
      switch (catalogs.length) {
        case 1: call = { name: 'chat_design', args: { action: 'open', reference } }; break;
        case 2: call = { name: 'design_edit', args: { revision: result().revision, action: 'insert', ids: [],
          fields: { kind: 'frame', name: 'Screen', width: 400, height: 600, children: [{ kind: 'text', name: 'Title', text: 'Hello' }] } } }; break;
        case 3: {
          const raw = body.messages.findLast((message: { role: string }) => message.role === 'tool').content;
          if (!raw.startsWith('{') || !JSON.parse(raw).ids?.length) {
            inspected.reject(new Error('Native edit failed: ' + raw));
            break;
          }
          const edit = result();
          savedRevision = edit.revision;
          board = edit.ids[0];
          call = { name: 'design_inspect', args: { scope: 'document', name: 'Title' } }; break;
        }
        case 4: call = { name: 'design_resources', args: { kind: 'documents' } }; break;
        case 5:
          resourcePaths = result().items;
          call = { name: 'design_edit', args: { action: 'linkLibrary', fields: { path: 'Other.design.json' }, revision: savedRevision } }; break;
        case 6:
          call = { name: 'design_edit', args: { action: 'linkLibrary', fields: { path: 'Shared.design.json' }, revision: savedRevision } }; break;
        case 7:
          savedRevision = result().revision;
          call = { name: 'design_resources', args: { kind: 'images' } }; break;
        case 8:
          images = result().items;
          call = { name: 'design_edit', args: { action: 'insert', ids: [board], revision: savedRevision, fields: { kind: 'image', assetPath: privateImage } } }; break;
        case 9:
          call = { name: 'design_edit', args: { action: 'insert', ids: [board], revision: savedRevision, fields: { kind: 'image', assetPath: ownImage } } }; break;
        case 10:
          savedRevision = result().revision;
          inspected.resolve();
          await resume.promise;
          call = { name: 'design_edit', args: { revision: savedRevision, action: 'delete', ids: [board] } }; break;
        case 11: call = { name: 'chat_design', args: { action: 'finish' } }; break;
      }
    }
    const delta = call ? { tool_calls: [{ index: 0, id: 'canvas_' + catalogs.length, type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Done.' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  const post = (path: string, input: unknown, signal?: AbortSignal) =>
    harness.runtimeFetch(path, { method: 'POST', body: JSON.stringify(input), signal });
  try {
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Expected a provider port.');
    await harness.configureOpenAiProvider('canvas', 'http://127.0.0.1:' + address.port + '/v1');
    const project = await post('/v1/projects', { name: 'Chat' });
    const other = await post('/v1/projects', { name: 'Other' });
    const base = '/v1/features/design';
    for (const [name, projectId] of [['Main.design.json', project.id], ['Shared.design.json', project.id], ['Other.design.json', other.id]]) {
      const ref = { storageId: 'local', path: name };
      await post(base + '/documents', { ...ref, parentPath: '.', name });
      const library = await harness.runtimeFetch(base + '/documents?' + new URLSearchParams(ref));
      await post(base + '/storage/project', { ref, documentId: library.document.documentId, projectId });
      if (name === 'Main.design.json') {
        reference = designMentionText({ ref, documentId: library.document.documentId });
        ownImage = await post(base + '/images', { ref, name: 'own.png', base64: ONE_PIXEL_PNG_BASE64 });
      }
      if (projectId === other.id) privateImage = await post(base + '/images', { ref, name: 'private.png', base64: ONE_PIXEL_PNG_BASE64 });
    }
    // The unplaced image must survive the importer's session and remain private to its draft.
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const { id: threadId } = await post('/v1/threads', { projectId: project.id, title: 'Design' });
    const { turnId } = await post('/v1/threads/' + threadId + '/turns', { input: 'Design a screen on the canvas' });
    const thread = await harness.waitForThread(threadId, (thread) => thread.messages.some((message) =>
      message.toolRuns?.some((run) => run.name === 'design_edit' && run.status === 'running')));
    const receipt = thread.messages.flatMap((m) => m.toolRuns ?? []).find((run) => run.name === 'chat_design');
    const draft = chatDesignResult(receipt?.data)!;
    const read = (): Promise<DesignSnapshot> => harness.runtimeFetch(base + '/documents?' + new URLSearchParams({ storageId: 'local', path: draft.ref.path }));
    let snapshot = await read();
    expect(snapshot.document.rootIds).toEqual([]);
    expect(catalogs[1]).toContain('design_edit');
    expect(catalogs[1]).not.toContain('exec_command');
    const client: DesignTaskClient = { start: (input, signal) => post(base + '/tasks', input, signal),
      reply: (input, signal) => post(base + '/tasks/reply', input, signal), stop: (sessionId) => post(base + '/tasks/stop', { sessionId }),
      bindInput: (input, signal) => post(base + '/tasks/bind-input', input, signal),
      watchCommand: (input, signal) => post(base + '/tasks/watch-command', input, signal) };
    const editorClient = createDesignClient({ call: vi.fn() }, { search: vi.fn(), read: vi.fn(), readLinkedImage: vi.fn(), requestClipboardPaste: vi.fn(),
      output: { saveDesignHtml: vi.fn(), saveDesignSvg: vi.fn(), saveImageAs: vi.fn(), copyImageToClipboard: vi.fn(),
        copyDesignLayers: vi.fn(), readDesignLayers: vi.fn(), copyText: vi.fn() } });
    const layoutEngine = await loadYoga();
    exchange = runDesignSelectionTask({ client, canvasRequestId: draft.canvasRequestId, ref: draft.ref, selection: [], threadId,
      signal: live.signal, onReady() {}, synchronize: async () => snapshot = await read(), approve: async () => false,
      view() { const { document } = snapshot;
        return { document, projected: document, layoutEngine, scene: resolveDesignScene(layoutEngine, document, () => ({ width: 40, height: 18 })),
          editor: { client: editorClient, ref: draft.ref, translate: (key) => key, scripts: new Map(), settings: defaultDesignCanvasSettings,
            canvas: () => null, select: vi.fn(), toggleSetting: vi.fn(), refreshFonts: vi.fn(), deliver: vi.fn() },
          resources: emptyDesignLibraryResources, showFocus: (value) => { if (value) focus.push(value); },
          preview: async () => { throw new Error('Unexpected preview'); } }; },
    }).catch((error: unknown) => { if (!live.signal.aborted) throw error; });
    await Promise.race([inspected.promise, exchange.then(() => { throw new Error('Editor disconnected before inspection.'); })]);
    const title = Object.entries(snapshot.document.nodes).find(([, node]) => node.name === 'Title')?.[0];
    expect(focus.flat()).toEqual(expect.arrayContaining([expect.objectContaining({ boardId: board, ids: [title] })]));
    await post(base + '/storage/project', { ref: draft.ref, documentId: draft.documentId, projectId: other.id });
    resume.resolve();
    const done = await harness.waitForCompletedTurn(threadId, turnId);
    expect(resourcePaths.sort()).toEqual(['Main.design.json', 'Shared.design.json']);
    const toolRuns = done.messages.flatMap((message) => message.toolRuns ?? []);
    expect(toolRuns.find((run) => run.id === 'canvas_5')?.status).toBe('error');
    expect(images).toEqual([ownImage]);
    expect(toolRuns.find((run) => run.id === 'canvas_8')).toMatchObject({ status: 'error', resultPreview: expect.stringContaining('Import this asset') });
    expect(toolRuns.find((run) => run.id === 'canvas_10')?.status).toBe('error');
    expect(Object.values((await read()).document.libraries ?? {})).toEqual(['Shared.design.json']);
    expect(catalogs.at(-1)).toContain('exec_command');
    expect(await read()).toMatchObject({ revision: savedRevision, document: { rootIds: [board] }, canUndo: true });
    await exchange;
  } finally {
    resume.resolve();
    live.abort();
    await exchange?.catch(() => undefined);
    await harness.close();
    if (provider.listening) await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  }
});
