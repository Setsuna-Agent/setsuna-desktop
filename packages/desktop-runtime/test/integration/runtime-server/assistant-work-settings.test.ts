import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Assistant, AssistantsSnapshot } from '@setsuna-desktop/feature-assistants/contracts';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { readRequestText } from '../../support/runtime-server/shared.js';

it('模型默认 medium 时，助理新建项目任务的真实模型请求仍使用已配置的 high', async () => {
  type Request = { model: string; reasoning_effort?: string; messages: { role: string; tool_call_id?: string }[]; tools?: { function: { name: string } }[] };
  const requests: Request[] = [];
  let projectId = '';
  const provider = createServer(async (request, response) => {
    const body = JSON.parse(await readRequestText(request)) as Request;
    requests.push(body);
    const assistant = body.tools?.some((tool) => tool.function.name === 'assistant_dispatch_task');
    const dispatch = assistant && !body.messages.some((message) => message.tool_call_id === 'dispatch_work');
    const delta = dispatch ? { tool_calls: [{ index: 0, id: 'dispatch_work', type: 'function', function: {
      name: 'assistant_dispatch_task', arguments: JSON.stringify({ project_id: projectId, title: '工作任务', instructions: '检查项目并总结' }),
    } }] } : { content: '已完成。' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    response.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: dispatch ? 'tool_calls' : 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'assistant-work-settings-'));
  let harness: RuntimeServerTestHarness | undefined;
  try {
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Expected provider TCP address.');
    harness = await createRuntimeServerTestHarness();
    await harness.configureOpenAiProvider('work-test', `http://127.0.0.1:${address.port}/v1`, {
      contextWindowTokens: 32_000, thinkingEnabled: true, thinkingEfforts: ['medium', 'high'], defaultThinkingEffort: 'medium',
    });
    const project = await harness.runtimeFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ path: workspace }) });
    projectId = project.id;
    const assistant = await harness.runtimeFetch('/v1/features/assistants', { method: 'POST', body: JSON.stringify({ draft: {
      name: '助理', personality: '', projectIds: [projectId],
      modelSelection: { providerId: 'work-test', modelId: 'work-test-model' }, thinkingEffort: 'high',
    } }) }) as Assistant;
    const { threadId } = await harness.runtimeFetch(`/v1/features/assistants/${assistant.id}/conversation`, { method: 'POST' });
    const { turnId } = await harness.runtimeFetch(`/v1/threads/${threadId}/turns`, { method: 'POST', body: JSON.stringify({ input: '检查项目' }) });
    await harness.waitForCompletedTurn(threadId, turnId);
    let snapshot: AssistantsSnapshot | undefined;
    await vi.waitFor(async () => {
      snapshot = await harness!.runtimeFetch('/v1/features/assistants') as AssistantsSnapshot;
      expect(snapshot.tasks[0]?.turnId).toBeTypeOf('string');
    });
    const task = snapshot!.tasks[0]!;
    await harness.waitForCompletedTurn(task.workThreadId, task.turnId!);
    const work = requests.find((request) => !request.tools?.some((tool) => tool.function.name === 'assistant_dispatch_task'));
    expect(work).toMatchObject({ model: 'work-test-model', reasoning_effort: 'high' });
    expect(task.execution).toEqual({ modelSelection: assistant.modelSelection, thinkingEffort: 'high' });
    const thread = await harness.runtimeFetch(`/v1/threads/${task.workThreadId}`) as RuntimeThread;
    expect(thread.origin).toEqual({ featureId: 'assistants', entityId: task.id });
    expect(thread.modelBinding?.modelId).toBe('work-test-model');
  } finally {
    await harness?.close();
    if (provider.listening) await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
});
