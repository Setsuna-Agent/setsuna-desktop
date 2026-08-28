import type { RuntimeSkillList } from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import { skillsFeature } from '../../src/contracts/index.js';
import type { SkillsRendererClient } from '../../src/renderer/client.js';
import { RendererSkillsService } from '../../src/renderer/index.js';

describe('RendererSkillsService', () => {
  it('does not let a slow refresh roll back a newer Skill mutation', async () => {
    const staleRefresh = deferred<RuntimeSkillList>();
    const client = {
      createSkill: vi.fn(async () => skillList('updated').skills[0]),
      listSkills: vi.fn(() => staleRefresh.promise),
    } as unknown as SkillsRendererClient;
    const scope = createFeatureScope({
      featureId: skillsFeature.id,
      process: 'renderer',
      scopeId: 'skills-renderer-service-test',
    });
    scope.activate();
    const service = new RendererSkillsService({ client, scope: scope.scope });
    const listener = vi.fn();
    service.subscribe(listener);

    const refresh = service.refresh();
    await service.createSkill({ content: '# Updated', name: 'updated' });
    staleRefresh.resolve(skillList('stale'));
    await refresh;

    expect(service.getSnapshot().skills.map((skill) => skill.id)).toEqual(['updated']);
    expect(listener).toHaveBeenCalledOnce();
    await scope.finishDispose();
  });

  it('normalizes extra roots and commits the returned catalog atomically', async () => {
    const setExtraRoots = vi.fn(async () => skillList('external'));
    const client = { setExtraRoots } as unknown as SkillsRendererClient;
    const scope = createFeatureScope({
      featureId: skillsFeature.id,
      process: 'renderer',
      scopeId: 'skills-renderer-extra-roots-test',
    });
    scope.activate();
    const service = new RendererSkillsService({ client, scope: scope.scope });

    await service.setExtraRoots([' /workspace/skills ', '', '/workspace/skills']);

    expect(setExtraRoots).toHaveBeenCalledWith(['/workspace/skills'], expect.anything());
    expect(service.getSnapshot()).toMatchObject({
      extraRoots: ['/workspace/skills'],
      skills: [{ id: 'external' }],
    });
    await scope.finishDispose();
  });
});

function skillList(id: string): RuntimeSkillList {
  return {
    skills: [{ enabled: true, id, kind: 'user', name: id }],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
