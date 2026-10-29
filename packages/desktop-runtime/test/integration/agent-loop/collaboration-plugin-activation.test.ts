import { pluginMentionText, type ModelRequest, type ModelStreamEvent, type RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileSkillRegistry } from '../../../src/adapters/skill/file-skill-registry.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { bindTestCollaborationFeature, MultiAgentConfigStore } from '../../support/agent-loop/collaboration.js';
import { mkDataDir } from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';

describe('collaboration plugin activation', () => {
  it('keeps reported plugins out of parent sampling and resumed child handoffs while preserving real requests', async () => {
    const root = await mkDataDir();
    const plugin = await installDocumentSkill(root);
    const registry = new FileSkillRegistry(path.join(root, 'builtin'), root);
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(root, systemClock, ids);
    const parent = await store.createThread({ title: 'Inspect repository with a child' });
    const requests: ModelRequest[] = [];
    const report = `Found report.docx. Available plugin: ${pluginMentionText(plugin)}.`;
    const realRequest = 'Create a docx report.';
    const loop = new AgentLoop({
      threadStore: store, ids, clock: systemClock, eventBus: new InMemoryEventBus(),
      configStore: new MultiAgentConfigStore(), skillRegistry: registry,
      pluginStore: { listPlugins: async () => ({ plugins: [plugin] }) },
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        requests.push(request);
        if (request.messages.some((message) => message.inputKind === 'subagent_task')) {
          yield { type: 'text_delta', text: report };
        } else if (request.messages.some((message) => message.role === 'user' && message.content === realRequest)) {
          yield { type: 'text_delta', text: 'Document task completed.' };
        } else {
          const spawned = request.messages.find((message) => message.toolName === 'spawn_agent' && message.role === 'tool');
          if (!spawned) {
            yield { type: 'tool_calls', toolCalls: [{ id: 'spawn', name: 'spawn_agent', arguments: JSON.stringify({ prompt: 'Inspect files.', context_mode: 'snapshot' }) }] };
            yield { type: 'done', finishReason: 'tool_calls' };
            return;
          }
          const receivedReport = request.messages.some((message) => message.promptSource === 'collaboration' && message.content.includes('<collaboration_results>'));
          if (receivedReport && !request.messages.some((message) => message.toolName === 'resume_agent')) {
            const { childThreadId } = JSON.parse(spawned.content) as { childThreadId: string };
            yield { type: 'tool_calls', toolCalls: [{ id: 'resume', name: 'resume_agent', arguments: JSON.stringify({ thread_id: childThreadId, content: 'Now check git status.' }) }] };
            yield { type: 'done', finishReason: 'tool_calls' };
            return;
          }
          yield { type: 'text_delta', text: 'Repository inspected.' };
        }
        yield { type: 'done', finishReason: 'stop' };
      } },
    });
    bindTestCollaborationFeature(loop, store);
    try {
      await loop.sendTurn(parent.id, { input: 'Inspect the repository with a child.' });
      const children = await store.listThreads({ parentThreadId: parent.id });
      expect(children).toHaveLength(1);
      const child = (await store.getThread(children[0]!.id))!;
      const parentState = (await store.getThread(parent.id))!;
      expect(child.turns).toHaveLength(2);
      expect(parentState.messages.some((message) => message.promptSource === 'collaboration' && message.content.includes('report.docx'))).toBe(true);
      expect(requests.every((request) => request.messages.every((message) => !message.id.startsWith('skill_') && !message.id.startsWith('selected_plugin_')))).toBe(true);
      for (const thread of [parentState, child]) {
        const snapshots = thread.turns!.flatMap((turn) => turn.stepSnapshots ?? []);
        expect(snapshots.length).toBeGreaterThan(0);
        expect(snapshots.every((step) => step.snapshot.selectedSkills.length === 0)).toBe(true);
      }
      expect(child.messages.filter((message) => message.inputKind === 'subagent_task').every((message) => !message.skillIds?.length)).toBe(true);

      await loop.sendTurn(parent.id, { input: realRequest });
      const selected = (await store.getThread(parent.id))?.turns?.at(-1)?.stepSnapshots?.at(-1)?.snapshot.selectedSkills;
      expect(selected).toEqual([expect.objectContaining({ id: 'documents.documents', plugin: { id: 'documents', name: 'Documents' } })]);
    } finally {
      await loop.shutdown();
      await store.close();
    }
  });
});

async function installDocumentSkill(root: string): Promise<RuntimePluginSummary> {
  const installPath = path.join(root, 'plugins', 'documents');
  const skillPath = path.join(installPath, 'skills', 'documents');
  await mkdir(skillPath, { recursive: true });
  await writeFile(path.join(skillPath, 'SKILL.md'), '---\nname: Documents\nauto-activate:\n  - docx\n---\nCreate Word documents.');
  const plugin: RuntimePluginSummary = {
    id: 'documents', name: 'Documents', installedAt: '',
    skills: [{ id: 'documents.documents', name: 'Documents' }], mcpServers: [], hooks: [], hookCount: 0, resources: [],
  };
  await writeFile(path.join(root, 'plugins.json'), JSON.stringify({ version: 1, plugins: [{
    ...plugin, sourcePath: installPath, installPath, manifestPath: path.join(installPath, '.setsuna-plugin', 'plugin.json'),
    skillEntries: [{ id: 'documents.documents', relativePath: 'skills/documents' }], mcpServerInputs: [],
  }] }));
  return plugin;
}
