import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillMcpDependency,
  RuntimeSkillMcpDependencyInstallResult,
  RuntimeSkillPatch,
} from '@setsuna-desktop/contracts';

export type SkillInjection = {
  id: string;
  name: string;
  content: string;
  path?: string;
  mcpDependencies?: RuntimeSkillMcpDependency[];
  dependencyErrors?: string[];
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
  selectedSkillInjections(skillIds?: string[]): Promise<SkillInjection[]>;
  setExtraRoots(extraRoots: string[]): Promise<void>;
  subscribeChanges(listener: () => void): () => void;
};
