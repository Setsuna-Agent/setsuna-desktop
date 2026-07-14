import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModelRequest, RuntimeMessage } from '@setsuna-desktop/contracts';
import { InMemoryEventBus } from '../event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../id/random-id-generator.js';
import { JsonThreadStore } from '../store/json-thread-store.js';
import { AgentLoop } from '../../loop/agent-loop.js';
import { systemClock } from '../../ports/clock.js';
import type { ModelClient } from '../../ports/model-client.js';
import { FileSkillRegistry } from './file-skill-registry.js';

describe('file skill registry', () => {
  it('serializes concurrent skill state writes', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);

    await Promise.all([
      registry.createSkill({ name: 'Alpha Skill', content: 'alpha', selected: true }),
      registry.createSkill({ name: 'Beta Skill', content: 'beta', enabled: false }),
    ]);

    await expect(registry.listSkills()).resolves.toMatchObject({
      skills: expect.arrayContaining([
        expect.objectContaining({ id: 'alpha-skill', selected: true }),
        expect.objectContaining({ id: 'beta-skill', enabled: false }),
      ]),
    });
  });

  it('lists built-in skills and persists selected state', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);

    const list = await registry.listSkills();
    expect(list.skills).toHaveLength(1);
    expect(list.skills[0]).toMatchObject({
      id: 'builtin-demo',
      name: 'builtin-demo',
      enabled: true,
      selected: false,
    });

    const updated = await registry.updateSkill('builtin-demo', { selected: true });
    expect(updated.selected).toBe(true);
    expect(await registry.selectedSkillInjections()).toMatchObject([
      {
        id: 'builtin-demo',
        name: 'builtin-demo',
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

  it('loads runtime extra roots without persisting them', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const extraRoot = path.join(dataDir, 'extra-skills');
    const registry = new FileSkillRegistry(builtinDir, dataDir);

    await registry.setExtraRoots([path.join(dataDir, 'missing-extra-root')]);
    expect((await registry.listSkills()).skills.map((skill) => skill.id)).not.toContain('extra-helper');

    await mkdir(path.join(extraRoot, 'extra-helper'), { recursive: true });
    await writeFile(
      path.join(extraRoot, 'extra-helper', 'SKILL.md'),
      [
        '---',
        'name: Extra Helper',
        'description: Comes from a runtime extra root',
        '---',
        '',
        '# Extra Helper',
        '',
        'Use the extra root.',
      ].join('\n'),
    );
    await registry.setExtraRoots([extraRoot]);

    expect(await registry.listSkills()).toMatchObject({
      skills: expect.arrayContaining([
        expect.objectContaining({
          id: 'extra-helper',
          kind: 'user',
          name: 'Extra Helper',
          enabled: true,
        }),
      ]),
    });
    await expect(registry.selectedSkillInjections(['extra-helper'])).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'extra-helper',
          content: expect.stringContaining('Use the extra root.'),
        }),
      ]),
    );
  });

  it('notifies subscribers when watched skill files change', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);
    const changes = skillChangeQueue(registry);

    try {
      await registry.setExtraRoots([]);
      await expect(changes.next()).resolves.toBe(true);

      await writeFile(
        path.join(builtinDir, 'builtin-demo', 'SKILL.md'),
        [
          '---',
          'name: builtin-demo',
          'description: Updated externally',
          '---',
          '',
          '# Built-in Demo',
          '',
          'Changed outside the registry API.',
        ].join('\n'),
      );

      await expect(changes.next()).resolves.toBe(true);
    } finally {
      changes.close();
    }
  });

  it('keeps built-in skill content read-only', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);

    await expect(registry.updateSkill('builtin-demo', { content: 'changed' })).rejects.toThrow('Built-in skill is read-only');
    await expect(registry.deleteSkill('builtin-demo')).rejects.toThrow('Built-in skill is read-only');
  });

  it('injects selected skills into agent loop model messages', async () => {
    const { builtinDir, dataDir } = await createSkillFixture();
    const registry = new FileSkillRegistry(builtinDir, dataDir);
    await registry.updateSkill('builtin-demo', { selected: true });
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

    await loop.sendTurn(thread.id, { input: 'run the built-in workflow' });

    const skillMessage = modelClient.messages.find((message) => message.id === 'skill_builtin-demo');
    expect(skillMessage?.content).toContain('<skill name="builtin-demo" id="builtin-demo" path="');
    expect(skillMessage?.content).toContain('Use the built-in demo workflow.');
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

    await loop.sendTurn(thread.id, { input: 'run the built-in workflow', skillIds: ['builtin-demo'] });

    expect(modelClient.messages.find((message) => message.id === 'skill_builtin-demo')?.content)
      .toContain('<skill name="builtin-demo" id="builtin-demo" path="');
    expect((await registry.listSkills()).skills[0]).toMatchObject({ id: 'builtin-demo', selected: false });
  });
});

function skillChangeQueue(registry: FileSkillRegistry): { next(): Promise<boolean>; close(): void } {
  const waiters: Array<(value: boolean) => void> = [];
  let pending = 0;
  const unsubscribe = registry.subscribeChanges(() => {
    const resolve = waiters.shift();
    if (resolve) resolve(true);
    else pending += 1;
  });
  return {
    next() {
      if (pending > 0) {
        pending -= 1;
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          const index = waiters.indexOf(resolve);
          if (index !== -1) waiters.splice(index, 1);
          resolve(false);
        }, 2000);
        waiters.push((value) => {
          clearTimeout(timeout);
          resolve(value);
        });
      });
    },
    close() {
      unsubscribe();
      for (const resolve of waiters.splice(0)) resolve(false);
    },
  };
}

class CapturingModelClient implements ModelClient {
  messages: RuntimeMessage[] = [];

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
  const skillDir = path.join(builtinDir, 'builtin-demo');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: builtin-demo',
      'description: Exercise built-in skill behavior',
      '---',
      '',
      '# Built-in Demo',
      '',
      'Use the built-in demo workflow.',
    ].join('\n'),
  );
  return { builtinDir, dataDir };
}
