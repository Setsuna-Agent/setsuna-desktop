import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import path from 'node:path';
import {
  authenticateSkillMcpDependency,
  createSkill,
  deleteSkill,
  installSkillMcpDependencies,
  readSkill,
  readSkills,
  setSkillExtraRoots,
  skillsControlCapability,
  skillsFeature,
  skillsRuntimeHostCapability,
  updateSkill,
} from '../contracts/index.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(skillsRuntimeHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});

const controlProvider = declareCapabilityProvider(skillsControlCapability);

export const skillsRuntimeFeature = defineRuntimeFeature({
  definition: skillsFeature,
  dependencies,
  provides: [controlProvider],
  setup(context) {
    const { control, publishChanged } = context.dependencies.host;
    const { routes } = context.dependencies;

    routes.register(context.scope, readSkills, () => preserveSkillOperation(() => control.listSkills()));
    routes.register(context.scope, createSkill, (input) => (
      preserveSkillOperation(() => control.createSkill(input))
    ));
    routes.register(context.scope, readSkill, async ({ skillId }) => {
      const skill = await preserveSkillOperation(() => control.getSkill(skillId));
      if (!skill) throw skillNotFound(skillId);
      return skill;
    });
    routes.register(context.scope, updateSkill, ({ patch, skillId }) => (
      preserveSkillOperation(() => control.updateSkill(skillId, patch))
    ));
    routes.register(context.scope, deleteSkill, async ({ skillId }) => {
      await preserveSkillOperation(() => control.deleteSkill(skillId));
      return Object.freeze({ ok: true as const });
    });
    routes.register(context.scope, installSkillMcpDependencies, ({ skillId }) => (
      preserveSkillOperation(() => control.installMcpDependencies(skillId))
    ));
    routes.register(context.scope, authenticateSkillMcpDependency, ({ serverKey, skillId }) => (
      preserveSkillOperation(() => control.authenticateMcpDependency(skillId, serverKey))
    ));
    routes.register(context.scope, setSkillExtraRoots, async ({ extraRoots }) => {
      const normalizedRoots = normalizeRuntimeSkillExtraRoots(extraRoots);
      await preserveSkillOperation(() => control.setExtraRoots(normalizedRoots));
      return preserveSkillOperation(() => control.listSkills());
    });

    context.scope.add(control.subscribeChanges(publishChanged));
    context.provide(controlProvider, control);
  },
});

async function preserveSkillOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FeatureOperationFailure) throw error;
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : 'Skill operation failed.';
    if (message.startsWith('Skill not found:')) {
      throw new FeatureOperationFailure({
        code: 'SKILL_NOT_FOUND',
        message,
        retryable: false,
      });
    }
    throw new FeatureOperationFailure({
      code: 'SKILL_OPERATION_FAILED',
      message,
      retryable: false,
    });
  }
}

function skillNotFound(skillId: string): FeatureOperationFailure<'SKILL_NOT_FOUND'> {
  return new FeatureOperationFailure({
    code: 'SKILL_NOT_FOUND',
    message: `Skill not found: ${skillId}`,
    retryable: false,
  });
}

function normalizeRuntimeSkillExtraRoots(extraRoots: readonly string[]): string[] {
  return extraRoots.map((root, index) => {
    if (!path.isAbsolute(root)) {
      throw new FeatureOperationFailure({
        code: 'INVALID_INPUT',
        message: `extraRoots[${index}] must be an absolute path.`,
        retryable: false,
      });
    }
    return path.resolve(root);
  });
}
