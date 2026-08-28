import type {
  RuntimeSkillInput,
  RuntimeSkillPatch,
} from '@setsuna-desktop/contracts';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  authenticateSkillMcpDependency,
  createSkill,
  deleteSkill,
  installSkillMcpDependencies,
  readSkill,
  readSkills,
  setSkillExtraRoots,
  updateSkill,
} from '../contracts/index.js';

type OperationOptions = Readonly<{ signal?: AbortSignal }>;

export function createSkillsRendererClient(transport: FeatureOperationTransport) {
  return Object.freeze({
    authenticateMcpDependency: (
      skillId: string,
      serverKey: string,
      options?: OperationOptions,
    ) => transport.call(authenticateSkillMcpDependency, { serverKey, skillId }, options),
    createSkill: (input: RuntimeSkillInput, options?: OperationOptions) => (
      transport.call(createSkill, input, options)
    ),
    deleteSkill: (skillId: string, options?: OperationOptions) => (
      transport.call(deleteSkill, { skillId }, options)
    ),
    getSkill: (skillId: string, options?: OperationOptions) => (
      transport.call(readSkill, { skillId }, options)
    ),
    installMcpDependencies: (skillId: string, options?: OperationOptions) => (
      transport.call(installSkillMcpDependencies, { skillId }, options)
    ),
    listSkills: (options?: OperationOptions) => transport.call(readSkills, undefined, options),
    setExtraRoots: (extraRoots: string[], options?: OperationOptions) => (
      transport.call(setSkillExtraRoots, { extraRoots }, options)
    ),
    updateSkill: (skillId: string, patch: RuntimeSkillPatch, options?: OperationOptions) => (
      transport.call(updateSkill, { patch, skillId }, options)
    ),
  });
}

export type SkillsRendererClient = ReturnType<typeof createSkillsRendererClient>;
