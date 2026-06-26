import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModelRequest } from '@setsuna-desktop/contracts';
import { InMemoryEventBus } from '../event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../id/random-id-generator.js';
import { JsonThreadStore } from '../store/json-thread-store.js';
import { AgentLoop } from '../../loop/agent-loop.js';
import { systemClock } from '../../ports/clock.js';
import type { ModelClient } from '../../ports/model-client.js';
import { FileSkillRegistry } from './file-skill-registry.js';

describe('file skill registry', () => {
  it('lists built-in skills and persists selected state', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);

    const list = await registry.listSkills();
    expect(list.skills).toHaveLength(1);
    expect(list.skills[0]).toMatchObject({
      id: 'presentation-mcp',
      name: 'presentation-mcp',
      enabled: true,
      selected: false,
    });

    const updated = await registry.updateSkill('presentation-mcp', { selected: true });
    expect(updated.selected).toBe(true);
    expect(await registry.selectedSkillInjections()).toMatchObject([
      {
        id: 'presentation-mcp',
        name: 'presentation-mcp',
      },
    ]);
  });

  it('creates, updates, injects, and deletes local user skills', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);

    const created = await registry.createSkill({
      name: 'Workspace Helper',
      description: 'Helps with local workspace tasks',
      content: '# Workspace Helper\n\nUse only local files.',
      selected: true,
    });

    expect(created).toMatchObject({
      id: 'workspace-helper',
      kind: 'user',
      enabled: true,
      selected: true,
      name: 'Workspace Helper',
    });
    expect((await registry.listSkills()).skills.map((skill) => skill.id)).toContain('workspace-helper');
    expect(await registry.selectedSkillInjections()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace-helper',
          content: expect.stringContaining('Use only local files.'),
        }),
      ]),
    );

    const updated = await registry.updateSkill('workspace-helper', {
      name: 'Workspace Guide',
      content: '# Workspace Guide\n\nStay local.',
      selected: false,
    });

    expect(updated).toMatchObject({
      id: 'workspace-helper',
      kind: 'user',
      name: 'Workspace Guide',
      selected: false,
    });
    expect(updated.content).toContain('Stay local.');

    await registry.deleteSkill('workspace-helper');
    expect(await registry.getSkill('workspace-helper')).toBeNull();
  });

  it('keeps built-in skill content read-only', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);

    await expect(registry.updateSkill('presentation-mcp', { content: 'changed' })).rejects.toThrow('Built-in skill is read-only');
    await expect(registry.deleteSkill('presentation-mcp')).rejects.toThrow('Built-in skill is read-only');
  });

  it('injects selected skills into agent loop model messages', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);
    await registry.updateSkill('presentation-mcp', { selected: true });
    const threadStore = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await threadStore.createThread({ title: 'Skill injection' });
    const modelClient = new CapturingModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids: new RandomIdGenerator(),
      skillRegistry: registry,
    });

    await loop.sendTurn(thread.id, { input: 'make a deck' });

    expect(modelClient.messages[0]?.content).toContain('<skill name="presentation-mcp" id="presentation-mcp">');
    expect(modelClient.messages[0]?.content).toContain('Use the local presentation tool.');
  });

  it('injects per-turn skills without persisting selected state', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);
    const threadStore = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await threadStore.createThread({ title: 'Per-turn skill injection' });
    const modelClient = new CapturingModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids: new RandomIdGenerator(),
      skillRegistry: registry,
    });

    await loop.sendTurn(thread.id, { input: 'make a deck', skillIds: ['presentation-mcp'] });

    expect(modelClient.messages[0]?.content).toContain('<skill name="presentation-mcp" id="presentation-mcp">');
    expect((await registry.listSkills()).skills[0]).toMatchObject({ id: 'presentation-mcp', selected: false });
  });
});

class CapturingModelClient implements ModelClient {
  messages: Array<{ content: string }> = [];

  async *stream(request: ModelRequest) {
    this.messages = request.messages;
    yield { type: 'text_delta' as const, text: 'ok' };
    yield { type: 'done' as const, finishReason: 'stop' };
  }
}

async function createSkillFixture(): Promise<{ builtinDir: string; dataDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-skill-test-'));
  const builtinDir = path.join(root, 'skills');
  const dataDir = path.join(root, 'data');
  const skillDir = path.join(builtinDir, 'presentation-mcp');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: presentation-mcp',
      'description: Generate decks locally',
      '---',
      '',
      '# Presentation MCP',
      '',
      'Use the local presentation tool.',
    ].join('\n'),
  );
  return { builtinDir, dataDir };
}
