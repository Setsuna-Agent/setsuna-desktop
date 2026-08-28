import type {
  RuntimePluginReference,
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillList,
  RuntimeSkillMcpDependency,
  RuntimeSkillMcpDependencyInstallResult,
  RuntimeSkillPatch,
  RuntimeSkillSummary,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export type SkillInjection = {
  id: string;
  name: string;
  contentVersion?: string;
  content: string;
  path?: string;
  plugin?: RuntimePluginReference;
  mcpDependencies?: RuntimeSkillMcpDependency[];
  dependencyErrors?: string[];
};

export type SkillActivationContext = {
  /** Current user text used only for declarative Plugin Skill activation. */
  text: string;
};

export type SkillPromptContextSnapshot = {
  availableSkills: RuntimeSkillSummary[];
  selectedInjections: SkillInjection[];
};

export interface SkillRegistry {
  listSkills(): Promise<RuntimeSkillList>;
  createSkill(input: RuntimeSkillInput): Promise<RuntimeSkillDetail>;
  getSkill(skillId: string): Promise<RuntimeSkillDetail | null>;
  updateSkill(skillId: string, patch: RuntimeSkillPatch): Promise<RuntimeSkillDetail>;
  deleteSkill(skillId: string): Promise<void>;
  resolvePromptContext(
    skillIds?: string[],
    activation?: SkillActivationContext,
  ): Promise<SkillPromptContextSnapshot>;
  selectedSkillInjections(
    skillIds?: string[],
    activation?: SkillActivationContext,
  ): Promise<SkillInjection[]>;
  setExtraRoots(extraRoots: string[]): Promise<void>;
  subscribeChanges(listener: () => void): () => void;
}

export interface SkillMcpDependencyManager {
  installMcpDependencies(skillId: string): Promise<RuntimeSkillMcpDependencyInstallResult>;
  authenticateMcpDependency(skillId: string, serverKey: string): Promise<RuntimeSkillDetail>;
}

export type SkillsControl = SkillRegistry & SkillMcpDependencyManager;

/**
 * Narrow lifecycle used by Plugin installation. Windows bundle mutations must
 * temporarily release descendant Skill watchers before renaming the bundle root.
 */
export type PluginSkillRegistry = Pick<SkillRegistry, 'listSkills'> & {
  beginPluginDirectoryMutation(pluginRoot: string): () => Promise<void>;
};

export interface SkillsRuntimeHost {
  readonly control: SkillsControl;
  publishChanged(): void;
}

export const skillsRuntimeHostCapability: CapabilityToken<SkillsRuntimeHost> = defineCapability({
  id: 'skills.runtime-host',
  description: 'Skill persistence, prompt resolution, MCP dependency, and compatibility notification host',
});

export const skillsControlCapability: CapabilityToken<SkillsControl> = defineCapability({
  id: 'skills.control',
  description: 'Skill catalog, prompt resolution, dependency, and management operations',
});

export type SkillsRendererSnapshot = Readonly<{
  extraRoots: readonly string[];
  skills: readonly RuntimeSkillSummary[];
}>;

export type SkillsRendererListener = () => void;
export type SkillsOperationOptions = Readonly<{ signal?: AbortSignal }>;

export interface SkillsRendererService {
  getSnapshot(): SkillsRendererSnapshot;
  subscribe(listener: SkillsRendererListener): () => void;
  refresh(options?: SkillsOperationOptions): Promise<RuntimeSkillList>;
  createSkill(input: RuntimeSkillInput, options?: SkillsOperationOptions): Promise<RuntimeSkillDetail>;
  getSkill(skillId: string, options?: SkillsOperationOptions): Promise<RuntimeSkillDetail>;
  updateSkill(
    skillId: string,
    patch: RuntimeSkillPatch,
    options?: SkillsOperationOptions,
  ): Promise<RuntimeSkillDetail>;
  deleteSkill(skillId: string, options?: SkillsOperationOptions): Promise<void>;
  installMcpDependencies(
    skillId: string,
    options?: SkillsOperationOptions,
  ): Promise<RuntimeSkillMcpDependencyInstallResult>;
  authenticateMcpDependency(
    skillId: string,
    serverKey: string,
    options?: SkillsOperationOptions,
  ): Promise<RuntimeSkillDetail>;
  setExtraRoots(extraRoots: string[], options?: SkillsOperationOptions): Promise<RuntimeSkillList>;
}

export const skillsRendererServiceCapability: CapabilityToken<SkillsRendererService> = defineCapability({
  id: 'skills.renderer-service',
  description: 'Renderer snapshot and commands for Skill catalog management',
});
