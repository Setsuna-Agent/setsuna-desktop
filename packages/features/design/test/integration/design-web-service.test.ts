import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { createRuntimeServerTestHarness } from '../../../../desktop-runtime/test/support/runtime-server/harness.js';
import { readRequestText } from '../../../../desktop-runtime/test/support/runtime-server/shared.js';
import { createDesignClient } from '../../src/renderer/client.js';
import { emptyDesignLibraryResources } from '../../src/renderer/components/design-library-resources.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { runDesignSelectionTask } from '../../src/renderer/agent/design-selection-task.js';
import { defaultDesignCanvasSettings } from '../../src/renderer/context/design-canvas-settings.js';
import type { DesignSnapshot } from '../../src/contracts/index.js';

it('creates a working service from design chat and keeps the mounted URL serving after the turn', async () => {
  const harness = await createRuntimeServerTestHarness();
  const source = `const http = require('node:http');
const server = http.createServer((req, res) => {
  const qty = new URL(req.url, 'http://localhost').searchParams.get('qty');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<form><input name="qty"><button>Quote</button></form><output>' + Number(qty) * 12 + '</output>');
});
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));`;
  const generate = `
    await tools.write_file({file_path:'quote.cjs', content:${JSON.stringify(source)}});
    const started = await tools.exec_command({cmd:${JSON.stringify('"' + process.execPath + '" quote.cjs')}, persist:true, yield_time_ms:100});
    const processId = started.content.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
    let output = started.content;
    for (let attempt = 0; processId && !output.includes('http://127.0.0.1:') && attempt < 3; attempt++) {
      output = (await tools.read_shell_process({process_id:processId, wait_ms:5000})).content;
    }
    const url = output.match(/http:\\/\\/127\\.0\\.0\\.1:\\d+/)?.[0];
    if (!url) throw new Error('Service failed to start: ' + output);
    const {revision} = (await tools.design_inspect({ids:[],mode:'index'})).data;
    text((await tools.design_edit({action:'insert', revision, fields:{kind:'web',name:'quote.live',url,width:360,height:240}})).data);
  `;
  const provider = createServer(async (req, res) => {
    const { messages } = JSON.parse(await readRequestText(req));
    const done = messages.some((m: { role: string }) => m.role === 'tool');
    const delta = done ? { content: 'Done.' } : { tool_calls: [{ id: 'call_quote', index: 0, type: 'function',
      function: { name: 'run_code', arguments: JSON.stringify({ code: generate }) } }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: done ? 'stop' : 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n');
  });
  const lifetime = new AbortController();
  let exchange: Promise<void> | undefined;
  try {
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Missing provider address.');
    await harness.configureOpenAiProvider('design-web', 'http://127.0.0.1:' + address.port + '/v1');
    await harness.runtimeFetch('/v1/config', { method: 'PUT', body: JSON.stringify({ permissionProfile: 'danger-full-access', approvalPolicy: 'never' }) });
    const root = path.join(harness.runtimeDataDir, 'project');
    await mkdir(root);
    const post = (url: string, input: unknown, signal?: AbortSignal) => harness.runtimeFetch(url, { method: 'POST', body: JSON.stringify(input), signal });
    const project = await post('/v1/projects', { name: 'Quote', path: root });
    const base = '/v1/features/design';
    const entry = await post(base + '/documents', { projectId: project.id, name: 'quote.design.json', parentPath: '.' });
    const ref = { projectId: project.id as string, path: entry.path as string };
    const read = () => harness.runtimeFetch(base + '/documents?' + new URLSearchParams(ref)) as Promise<DesignSnapshot>;
    let draft = await read();
    await post(base + '/documents/edits', {
      ref, expectedRevision: draft.revision,
      edits: [{ kind: 'insert', nodeId: 'panel', parentId: null,
        node: { kind: 'frame', name: 'Quote', x: 0, y: 0, width: 480, height: 480, childIds: [] } }],
    });
    draft = await read();
    const { id: threadId } = await post(base + '/conversations', { ref, documentId: draft.document.documentId });
    const client = createDesignClient({ call: vi.fn() }, {
      search: vi.fn(), read: vi.fn(), readLinkedImage: vi.fn(), requestClipboardPaste: vi.fn(),
      output: {
        saveDesignHtml: vi.fn(), saveDesignSvg: vi.fn(), saveImageAs: vi.fn(), copyImageToClipboard: vi.fn(),
        copyDesignLayers: vi.fn(), readDesignLayers: vi.fn(), copyText: vi.fn(),
      },
    });
    const layoutEngine = await loadYoga();
    const ready = Promise.withResolvers<void>();
    exchange = runDesignSelectionTask({
      client: {
        bindInput: (input, signal) => post(base + '/tasks/bind-input', input, signal),
      watchCommand: (input, signal) => post(base + '/tasks/watch-command', input, signal),
      start: (input, signal) => post(base + '/tasks', input, signal),
        reply: (input, signal) => post(base + '/tasks/reply', input, signal),
        stop: (sessionId) => post(base + '/tasks/stop', { sessionId }),
      },
      ref, selection: ['panel'], threadId, onReady: ready.resolve, signal: lifetime.signal,
      synchronize: async () => draft = await read(), approve: async () => true,
      view: () => ({
        document: draft.document, projected: draft.document, layoutEngine, resources: emptyDesignLibraryResources,
        scene: resolveDesignScene(layoutEngine, draft.document, () => ({ width: 0, height: 0 })), preview: vi.fn(),
        editor: {
          ref, client, translate: (key) => key, scripts: new Map(), settings: defaultDesignCanvasSettings,
          canvas: () => null, select: vi.fn(), toggleSetting: vi.fn(), refreshFonts: vi.fn(), deliver: vi.fn(),
        },
      }),
    }).catch((error) => { if (!lifetime.signal.aborted || error?.name !== 'AbortError') throw error; });
    await Promise.race([ready.promise, exchange]);
    const turn = await post('/v1/threads/' + threadId + '/turns', { input: 'Build a working quote form and mount it on this frame.' });
    await harness.waitForCompletedTurn(threadId, turn.turnId);
    lifetime.abort();
    await exchange;

    const document = (await read()).document;
    const panel = document.nodes.panel;
    if (panel.kind !== 'frame') throw new Error('Missing test frame');
    const web = document.nodes[panel.childIds[0]];
    expect(web).toMatchObject({ kind: 'web', name: 'quote.live' });
    if (web.kind !== 'web' || !web.url) throw new Error('Missing service URL');
    const response = await fetch(new URL('?qty=7', web.url));
    expect(response.ok).toBe(true);
    expect(await response.text()).toContain('<output>84</output>');
  } finally {
    lifetime.abort();
    try { await exchange; }
    finally {
      await harness.close();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  }
});
