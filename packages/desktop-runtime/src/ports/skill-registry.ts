import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillMcpDependency,
  RuntimeSkillMcpDependencyInstallResult,
  RuntimeSkillPatch,
  RuntimePluginReference,
} from '@setsuna-desktop/contracts';

export type SkillInjection = {
  id: string;
  name: string;
  content: string;
  path?: string;
  plugin?: RuntimePluginReference;
  mcpDependencies?: RuntimeSkillMcpDependency[];
  dependencyErrors?: string[];
};

export type SkillActivationContext = {
  /** 当前轮次用户文本及附件名称和类型，用于声明式插件 Skill 路由。 */
  text: string;
};

export type SkillMcpDependencyManager = {
  installMcpDependencies(skillId: string): Promise<RuntimeSkillMcpDependencyInstallResult>;
  authenticateMcpDependency(skillId: string, serverKey: string): Promise<RuntimeSkillDetail>;
};

export type SkillRegistry = {
  listSkills(): Promise<RuntimeSkillList>;
  createSkill(input: RuntimeSkillInput): Promise<RuntimeSkillDetail>;
  getSkill(skillId: string): Promise<RuntimeSkillDetail | null>;
  updateSkill(skillId: string, patch: RuntimeSkillPatch): Promise<RuntimeSkillDetail>;
  deleteSkill(skillId: string): Promise<void>;
  selectedSkillInjections(skillIds?: string[], activation?: SkillActivationContext): Promise<SkillInjection[]>;
  setExtraRoots(extraRoots: string[]): Promise<void>;
  subscribeChanges(listener: () => void): () => void;
};

/**
 * Narrow lifecycle used by the plugin store. Installed plugin directories are
 * watched for Skill changes, so Windows mutations must temporarily release the
 * descendant directory handles before renaming the bundle root.
 */
export type PluginSkillRegistry = Pick<SkillRegistry, 'listSkills'> & {
  beginPluginDirectoryMutation(pluginRoot: string): () => Promise<void>;
};
