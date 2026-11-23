import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { chatDesignResult, chatDesignTool, designMentionText } from '@setsuna-desktop/feature-design/contracts';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { readRequestText } from '../../support/runtime-server/shared.js';

it('discovers linked drafts and isolates project and personal canvas requests without a live editor', async () => {
  const harness = await createRuntimeServerTestHarness();
  let next: { id: string; input: unknown } | undefined;
  let tools: string[] = [];
  const provider = createServer(async (request, response) => {
    const body = JSON.parse(await readRequestText(request));
    const call = body.tools?.length ? next : undefined;
    if (call) next = undefined;
    if (call) tools = body.tools?.map((item: { function: { name: string } }) => item.function.name) ?? [];
    const delta = call ? { tool_calls: [{ index: 0, id: call.id, type: 'function', function: {
      name: chatDesignTool, arguments: JSON.stringify(call.input),
    } }] } : { content: 'Done.' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] }) + '\n\n');
    response.end('data: [DONE]\n\n');
  });
  const post = (url: string, input: unknown) => harness.runtimeFetch(url, { method: 'POST', body: JSON.stringify(input) });
  async function call(threadId: string, id: string, input: unknown, message: string) {
    next = { id, input };
    const { turnId } = await post('/v1/threads/' + threadId + '/turns', { input: message });
    const thread = await harness.waitForCompletedTurn(threadId, turnId);
    const run = thread.messages.flatMap((item) => item.toolRuns ?? []).find((item) => item.id === id);
    expect(run, 'Missing tool receipt for ' + id).toBeDefined();
    return run!;
  }
  try {
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Expected a local provider port.');
    await harness.configureOpenAiProvider('canvas', 'http://127.0.0.1:' + address.port + '/v1');
    const a = await post('/v1/projects', { name: 'A' });
    const b = await post('/v1/projects', { name: 'B' });
    const chat = await post('/v1/threads', { projectId: a.id, title: 'Canvas' });
    const run = await call(chat.id, 'create_idea', { action: 'create', name: '交互 (A)' }, 'Design a screen');
    expect(tools).toContain(chatDesignTool);
    expect(run.status, run.resultPreview).toBe('success');
    const created = chatDesignResult(run.data)!;
    expect(created.ref).toEqual({ storageId: 'local', path: '交互 (A).design.json' });
    const list = (id: string) => harness.runtimeFetch('/v1/features/design/project-documents?projectId=' + id);
    const owner = { documentId: created.documentId, ref: created.ref };
    expect(await list(a.id)).toEqual([owner]);
    expect(await list(b.id)).toEqual([]);
    const reference = designMentionText(owner);
    const discovered = await call(chat.id, 'find_designs', { action: 'list' }, 'Which designs are linked to my project?');
    expect(discovered.status).toBe('success');
    expect(discovered.resultPreview).toContain(reference);
    const opened = await call(chat.id, 'open_draft', { action: 'open', reference }, 'Open the canvas');
    expect(chatDesignResult(opened.data)?.canvasRequestId).toBeTruthy();

    await post('/v1/features/design/storage/project', { ...owner, projectId: b.id });
    expect(await list(a.id)).toEqual([]);
    expect(await list(b.id)).toEqual([owner]);
    expect((await call(chat.id, 'open_old', { action: 'open', reference }, 'Open the previous canvas')).status).toBe('error');

    const personal = await post('/v1/threads', { title: 'Personal' });
    const other = await post('/v1/threads', { title: 'Other' });
    const privateRun = await call(personal.id, 'create_private', { action: 'create', name: 'Private' }, 'Create a personal draft');
    const personalRef = designMentionText(chatDesignResult(privateRun.data)!);
    expect((await call(personal.id, 'open_mine', { action: 'open', reference: personalRef }, personalRef)).status).toBe('success');
    expect((await call(other.id, 'open_other', { action: 'open', reference: personalRef }, personalRef)).status).toBe('error');
  } finally {
    await harness.close();
    if (provider.listening) await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  }
});
