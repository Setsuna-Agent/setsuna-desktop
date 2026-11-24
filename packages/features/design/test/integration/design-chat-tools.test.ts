import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createRuntimeServerTestHarness } from '../../../../desktop-runtime/test/support/runtime-server/harness.js';
import { createMcpToolsServer } from '../../../../desktop-runtime/test/support/runtime-server/mcp.js';
import { readRequestText } from '../../../../desktop-runtime/test/support/runtime-server/shared.js';

it('uses the ordinary chat tool catalog in a live design chat and applies the MCP server tool filter', async () => {
  const harness = await createRuntimeServerTestHarness();
  const editor = new AbortController();
  const allowedName = 'mcp__search__search_web';
  const excludedName = 'mcp__search__summarize_page';
  const query = 'notebook layouts';
  const calls = [
    { name: 'search_tools', args: { query: 'search_web summarize_page' } },
    { name: allowedName, args: { query } },
    { name: excludedName, args: {} },
  ];
  const designCatalogs: string[][] = [];
  let ordinaryCatalog: string[] = [];
  let designTurn = false;
  let listening: Promise<unknown> | undefined;
  let mcp: Awaited<ReturnType<typeof createMcpToolsServer>> | undefined;
  const provider = createServer(async (request, response) => {
    const body = JSON.parse(await readRequestText(request)) as { tools?: { function: { name: string } }[] };
    const names = body.tools?.map((tool) => tool.function.name) ?? [];
    let call: typeof calls[number] | undefined;
    if (names.length) {
      if (designTurn) {
        call = calls[designCatalogs.length];
        designCatalogs.push(names);
      } else ordinaryCatalog = names;
    }
    const delta = call ? { tool_calls: [{ id: 'call_' + designCatalogs.length, index: 0, type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Done.' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  const post = (route: string, body: unknown, signal?: AbortSignal) =>
    harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body), signal });
  try {
    mcp = await createMcpToolsServer();
    await post('/v1/features/mcp/servers', { key: 'search', transport: 'streamableHttp', url: mcp.baseUrl, allowedTools: ['search_web'] });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address for the model fixture.');
    await harness.configureOpenAiProvider('design-tools', 'http://127.0.0.1:' + address.port + '/v1');
    const root = path.join(harness.runtimeDataDir, 'project');
    await mkdir(root);
    const { id: projectId } = await post('/v1/projects', { name: 'Design', path: root });
    const { id: ordinaryId } = await post('/v1/threads', { projectId, title: 'Project chat' });
    const baseline = await post('/v1/threads/' + ordinaryId + '/turns', { input: 'Check the project.' });
    await harness.waitForCompletedTurn(ordinaryId, baseline.turnId);
    expect(ordinaryCatalog).toContain('read_thread');

    const base = '/v1/features/design';
    const ref = { projectId: String(projectId), path: 'Research.design.json' };
    await post(base + '/documents', { ...ref, parentPath: '.', name: ref.path });
    const { document } = await harness.runtimeFetch(base + '/documents?' + new URLSearchParams(ref));
    const owner = { ref, documentId: document.documentId };
    const { id: threadId } = await post(base + '/conversations', owner);
    const sessionId = randomUUID();
    const ready = await post(base + '/tasks', { ...owner, sessionId, selection: [], threadId }, editor.signal);
    if (ready.kind !== 'ready') throw new Error('Expected an editor binding.');
    listening = post(base + '/tasks/reply', { sessionId, id: ready.id, result: { content: '' } }, editor.signal);
    void listening.catch(() => undefined);
    designTurn = true;
    const { turnId } = await post('/v1/threads/' + threadId + '/turns', { input: 'Use search MCP to find notebook layouts.' });
    const thread = await harness.waitForCompletedTurn(threadId, turnId);

    expect(designCatalogs[0]).toContain('design_inspect');
    expect(designCatalogs[0].filter((name) => !name.startsWith('design_')).sort())
      .toEqual(ordinaryCatalog.filter((name) => name !== 'chat_design').sort());
    expect(designCatalogs[1]).toContain(allowedName);
    expect(designCatalogs.flat()).not.toContain(excludedName);
    const runs = thread.messages.flatMap((message) => message.toolRuns ?? []);
    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: allowedName, status: 'success', resultPreview: expect.stringContaining(query) }),
      expect.objectContaining({ name: excludedName, status: 'error' }),
    ]));
    expect((await mcp.requests).filter(({ method }) => method === 'tools/call'))
      .toEqual([expect.objectContaining({ tool: 'search_web', query })]);
    await post(base + '/tasks/stop', { sessionId });
    await expect(listening).resolves.toMatchObject({ kind: 'done' });
  } finally {
    editor.abort();
    await listening?.catch(() => undefined);
    await harness.close();
    await mcp?.close();
    if (provider.listening) await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  }
});
