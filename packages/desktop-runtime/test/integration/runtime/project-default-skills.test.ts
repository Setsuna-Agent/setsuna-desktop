import { applyRuntimeEventToThread, type ModelRequest, type RuntimeMessage } from '@setsuna-desktop/contracts';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileSkillRegistry } from '../../../src/adapters/skill/file-skill-registry.js';
import { FileWorkspaceProjectStore } from '../../../src/adapters/workspace/file-workspace-project-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import type { RuntimeContainer } from '../../../src/runtime/runtime-factory.js';
import { createRuntimeThread } from '../../../src/runtime/use-cases/thread-create.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { createTestTempDirectory } from '../../support/test-temp-directory.js';

it('captures followed project skills and keeps them active across turns and restart without changing user input', async () => {
  const root = await createTestTempDirectory('setsuna-project-skills-');
  const builtinDir = path.join(root, 'builtin-skills');
  const dataDir = path.join(root, 'data');
  await mkdir(builtinDir);
  const skillRegistry = new FileSkillRegistry(builtinDir, dataDir);
  const original = await skillRegistry.createSkill({ name: 'Project Review', content: 'Follow the project review rules.' });
  const replacement = await skillRegistry.createSkill({ name: 'New Rules', content: 'Use the new rules.' });
  const workspaceProjects = new FileWorkspaceProjectStore(dataDir, systemClock);
  const source = await workspaceProjects.addProject({ name: 'Source', conversationDefaults: { skillIds: [original.id] } });
  const project = await workspaceProjects.addProject({ name: 'Following', conversationDefaults: { sourceProjectId: source.id } });
  const ids = new RandomIdGenerator();
  let threadStore = createTestThreadStore(dataDir, systemClock, ids);
  const modelClient = new CapturingModelClient();
  const createLoop = () => new AgentLoop({ threadStore, modelClient, skillRegistry,
    clock: systemClock, ids, eventBus: new InMemoryEventBus() });
  let agentLoop = createLoop();
  onTestFinished(async () => { await agentLoop.shutdown(); });
  const runtime = () => ({ threadStore, agentLoop, workspaceProjects } as unknown as RuntimeContainer);
  const thread = await createRuntimeThread(runtime(), { projectId: project.id });
  expect(thread.defaultSkillIds).toEqual([original.id]);
  const [created] = await threadStore.listEvents(thread.id, 0, { types: ['thread.created'] });
  expect(applyRuntimeEventToThread({ ...thread, defaultSkillIds: undefined, lastSeq: 0 }, created!).defaultSkillIds)
    .toEqual([original.id]);

  await agentLoop.sendTurn(thread.id, { input: 'First question', skillIds: [original.id] });
  expect(modelClient.messages.filter((message) => message.id === `skill_${original.id}`)).toHaveLength(1);
  await workspaceProjects.updateProject(source.id, { conversationDefaults: { skillIds: [replacement.id] } });
  await agentLoop.shutdown();
  await threadStore.close();
  threadStore = createTestThreadStore(dataDir, systemClock, ids);
  agentLoop = createLoop();

  await agentLoop.sendTurn(thread.id, { input: 'Follow-up question', skillIds: [replacement.id] });
  expect(modelClient.messages.find((message) => message.id === `skill_${original.id}`)?.content).toContain(original.content);
  expect(modelClient.messages.find((message) => message.id === `skill_${replacement.id}`)?.content).toContain(replacement.content);
  const restored = await threadStore.getThread(thread.id);
  expect(restored?.messages.filter((message) => message.role === 'user').map((message) => message.content))
    .toEqual(['First question', 'Follow-up question']);
  expect((await createRuntimeThread(runtime(), { projectId: project.id })).defaultSkillIds).toEqual([replacement.id]);

  await skillRegistry.updateSkill(original.id, { enabled: false });
  await agentLoop.sendTurn(thread.id, { input: 'Another question' });
  expect(modelClient.messages.some((message) => message.id === `skill_${original.id}`)).toBe(false);
  expect(modelClient.messages.some((message) => message.id === `skill_${replacement.id}`)).toBe(false);
});

class CapturingModelClient implements ModelClient {
  messages: RuntimeMessage[] = [];
  async *stream(request: ModelRequest) {
    this.messages = request.messages;
    yield { type: 'text_delta' as const, text: 'ok' };
    yield { type: 'done' as const, finishReason: 'stop' };
  }
}
