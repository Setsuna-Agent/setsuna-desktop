import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillPatch,
} from '@setsuna-desktop/contracts';
import { provideHostCapability, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeatureHost,
  runtimeRouteRegistrarCapability,
  type RuntimeRouteRegistrar,
} from '@setsuna-desktop/feature-core/runtime';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createSkill,
  inspectSkillDirectories,
  readSkill,
  setSkillExtraRoots,
  skillsControlCapability,
  skillsRuntimeHostCapability,
  type SkillsControl,
} from '../../src/contracts/index.js';
import { skillsRuntimeFeature } from '../../src/runtime/index.js';

describe('skillsRuntimeFeature', () => {
  it('owns typed routes, change notifications, capability publication, and cleanup', async () => {
    let changeListener: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const publishChanged = vi.fn();
    const control = memorySkillsControl((listener) => {
      changeListener = listener;
      return unsubscribe;
    });
    const setExtraRoots = vi.spyOn(control, 'setExtraRoots');
    const routeHandlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const routes: RuntimeRouteRegistrar = {
      register(scope, operation, handler) {
        const invoke = async (input: unknown) => operation.output.parse(await handler(
          operation.input.parse(input),
          { signal: new AbortController().signal },
        ));
        routeHandlers.set(operation.id, invoke);
        const contribution = Object.freeze({
          dispose: () => {
            routeHandlers.delete(operation.id);
          },
        });
        scope.add(contribution.dispose);
        return contribution;
      },
    };
    const composition = await defineRuntimeFeatureHost({
      required: [skillsRuntimeFeature],
      optional: [],
    }).activate({
      hostCapabilities: [
        provideHostCapability(runtimeRouteRegistrarCapability, routes),
        provideHostCapability(skillsRuntimeHostCapability, { control, publishChanged }),
      ],
    });

    const dependencies = composition.resolveHostDependencies(defineRuntimeDependencies({
      skills: requiredCapability(skillsControlCapability),
    }));
    expect(dependencies.skills).toBe(control);
    await expect(routeHandlers.get(createSkill.id)?.({
      content: '# Local Helper',
      name: 'Local Helper',
    })).resolves.toMatchObject({ id: 'local-helper', name: 'Local Helper' });
    await expect(routeHandlers.get(readSkill.id)?.({ skillId: 'missing' })).rejects.toMatchObject({
      code: 'SKILL_NOT_FOUND',
    });
    const missingSkillRoot = path.join(process.cwd(), '.missing-skill-root');
    await expect(routeHandlers.get(inspectSkillDirectories.id)?.({
      paths: [missingSkillRoot],
    })).resolves.toEqual({
      directories: [{ path: missingSkillRoot, skillCount: 0 }],
    });
    const unnormalizedRoot = `${process.cwd()}${path.sep}skills${path.sep}..${path.sep}shared`;
    await expect(routeHandlers.get(setSkillExtraRoots.id)?.({
      extraRoots: [unnormalizedRoot],
    })).resolves.toMatchObject({ skills: [{ id: 'local-helper' }] });
    expect(setExtraRoots).toHaveBeenCalledWith([path.resolve(unnormalizedRoot)]);
    await expect(routeHandlers.get(setSkillExtraRoots.id)?.({
      extraRoots: ['../skills'],
    })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'extraRoots[0] must be an absolute path.',
    });

    changeListener?.();
    expect(publishChanged).toHaveBeenCalledOnce();

    await composition.dispose();
    await composition.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(routeHandlers).toEqual(new Map());
  });
});

function memorySkillsControl(
  subscribeChanges: SkillsControl['subscribeChanges'],
): SkillsControl {
  const skills = new Map<string, RuntimeSkillDetail>();
  return {
    authenticateMcpDependency: async (skillId) => requiredSkill(skills, skillId),
    createSkill: async (input) => {
      const skill = detail(input);
      skills.set(skill.id, skill);
      return skill;
    },
    deleteSkill: async (skillId) => {
      if (!skills.delete(skillId)) throw new Error(`Skill not found: ${skillId}`);
    },
    getSkill: async (skillId) => skills.get(skillId) ?? null,
    installMcpDependencies: async (skillId) => ({
      enabled: [],
      installed: [],
      skill: requiredSkill(skills, skillId),
    }),
    listSkills: async () => ({ skills: [...skills.values()] }),
    resolvePromptContext: async () => ({ availableSkills: [], selectedInjections: [] }),
    selectedSkillInjections: async () => [],
    setExtraRoots: async () => undefined,
    subscribeChanges,
    updateSkill: async (skillId, patch) => {
      const current = requiredSkill(skills, skillId);
      const updated = applySkillPatch(current, patch);
      skills.set(skillId, updated);
      return updated;
    },
  };
}

function detail(input: RuntimeSkillInput): RuntimeSkillDetail {
  return {
    content: input.content,
    enabled: input.enabled ?? true,
    id: input.id ?? input.name.trim().toLowerCase().replace(/\s+/gu, '-'),
    kind: 'user',
    name: input.name,
    references: [],
  };
}

function requiredSkill(
  skills: ReadonlyMap<string, RuntimeSkillDetail>,
  skillId: string,
): RuntimeSkillDetail {
  const skill = skills.get(skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  return skill;
}

function applySkillPatch(
  current: RuntimeSkillDetail,
  patch: RuntimeSkillPatch,
): RuntimeSkillDetail {
  return {
    ...current,
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.description === undefined ? {} : { description: patch.description }),
    ...(patch.content === undefined ? {} : { content: patch.content }),
    ...(patch.mcpDependencies === undefined
      ? {}
      : {
          mcpDependencies: patch.mcpDependencies.map((dependency) => ({
            ...dependency,
            status: 'unchecked' as const,
          })),
        }),
  };
}
