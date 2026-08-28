export { skillsFeature } from './definition.js';
export {
  skillsControlCapability,
  skillsRendererServiceCapability,
  skillsRuntimeHostCapability,
} from './capabilities.js';
export type {
  PluginSkillRegistry,
  SkillActivationContext,
  SkillInjection,
  SkillMcpDependencyManager,
  SkillPromptContextSnapshot,
  SkillRegistry,
  SkillsControl,
  SkillsOperationOptions,
  SkillsRendererListener,
  SkillsRendererService,
  SkillsRendererSnapshot,
  SkillsRuntimeHost,
} from './capabilities.js';
export {
  authenticateSkillMcpDependency,
  createSkill,
  deleteSkill,
  installSkillMcpDependencies,
  readSkill,
  readSkills,
  setSkillExtraRoots,
  updateSkill,
} from './operations.js';
export type {
  SkillDependencyTarget,
  SkillExtraRootsInput,
  SkillTarget,
  SkillUpdateInput,
} from './operations.js';
