import type {
  RuntimeConfigState,
  RuntimeMessage,
  RuntimeModelRequestStepSnapshot,
  RuntimeThread,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { ProjectInstructionLoader } from '../ports/project-instruction-loader.js';
import type { ProjectWorkflow, ProjectWorkflowResolver } from '../ports/project-workflow-resolver.js';
import type { SkillRegistry } from '../ports/skill-registry.js';
import type { RuntimeToolExecutionContext, ToolExecutionEnvironment, ToolHost } from '../ports/tool-host.js';
import { escapeSkillAttribute, neutralizeInstructionTags, neutralizePersonalizationTags, neutralizeSkillTags } from './prompt-utils.js';
import type { RuntimePromptFragment } from './prompt-compiler.js';
import { RUNTIME_BASE_INSTRUCTIONS } from './runtime-base-instructions.js';
import { runtimeEnvironmentPrompt } from './runtime-environment-prompt.js';
import { runtimeProjectWorkflowPrompt } from './runtime-project-workflow-prompt.js';
import type { RuntimeMemoryCoordinator } from './runtime-memory-coordinator.js';
import { runtimePermissionsPrompt } from './runtime-permissions-prompt.js';
import type { RuntimeToolRouter } from './tool-router.js';

const DEFAULT_SKILL_PROMPT_MAX_BYTES = 48 * 1024;

type RuntimePromptContextAssemblerOptions = {
  memory: Pick<RuntimeMemoryCoordinator, 'contextMessages'>;
  projectInstructions?: ProjectInstructionLoader;
  projectWorkflow?: ProjectWorkflowResolver;
  skillRegistry?: Pick<SkillRegistry, 'selectedSkillInjections'>;
  toolHost?: ToolHost;
};

export type RuntimePromptContext = {
  fragments: RuntimePromptFragment[];
  selectedSkills: RuntimeModelRequestStepSnapshot['selectedSkills'];
};

/** Builds typed transient prompt fragments without owning sampling or compaction. */
export class RuntimePromptContextAssembler {
  constructor(private readonly options: RuntimePromptContextAssemblerOptions) {}

  async build({
    config,
    hookContextMessages,
    skillIds,
    thread,
    toolContext,
    toolRouter,
    tools,
  }: {
    config: RuntimeConfigState | null | undefined;
    hookContextMessages: RuntimeMessage[];
    skillIds: string[];
    thread: RuntimeThread;
    toolContext: RuntimeToolExecutionContext;
    toolRouter: RuntimeToolRouter | null;
    tools: RuntimeToolDefinition[];
  }): Promise<RuntimePromptContext> {
    const environment = toolContext.environment;
    const [skillContext, memoryMessages, projectInstructions, projectWorkflow, toolPrompt] = await Promise.all([
      this.skillContext(skillIds, config),
      this.options.memory.contextMessages(thread.projectId, config),
      this.options.projectInstructions?.load({
        environment,
        maxBytes: positiveSetting(config?.desktopSettings?.projectInstructionMaxBytes),
        fallbackFilenames: stringArraySetting(config?.desktopSettings?.projectInstructionFallbackFilenames),
      }).catch(() => []) ?? [],
      this.options.projectWorkflow?.resolve({ environment }).catch(() => null) ?? null,
      this.toolSystemPrompt(toolContext, toolRouter, tools),
    ]);

    return {
      fragments: [
        baseInstructionFragment(),
        ...(toolPrompt ? [toolPolicyFragment(toolPrompt)] : []),
        environmentFragment(environment),
        permissionsFragment(config, toolContext, tools),
        ...personalizationFragments(config),
        ...(projectWorkflow ? [projectWorkflowFragment(projectWorkflow)] : []),
        ...projectInstructions.map(projectInstructionFragment),
        ...memoryMessages.map(memoryFragment),
        ...skillContext.fragments,
        // Goal/mailbox-style turn context is closest to the current request and
        // therefore follows reusable user-context such as project rules or skills.
        ...runtimeContextFragments(hookContextMessages),
      ],
      selectedSkills: skillContext.selectedSkills,
    };
  }

  private async skillContext(skillIds: string[], config: RuntimeConfigState | null | undefined): Promise<RuntimePromptContext> {
    const injections = await this.options.skillRegistry?.selectedSkillInjections(skillIds);
    if (!injections?.length) return { fragments: [], selectedSkills: [] };
    const explicitSkillIds = new Set(skillIds);
    const orderedInjections = injections
      .map((skill, index) => ({ index, skill }))
      .sort((left, right) => Number(explicitSkillIds.has(right.skill.id)) - Number(explicitSkillIds.has(left.skill.id)) || left.index - right.index)
      .map(({ skill }) => skill);
    let remainingBytes = positiveSetting(config?.desktopSettings?.skillPromptMaxBytes) ?? DEFAULT_SKILL_PROMPT_MAX_BYTES;
    const fragments = orderedInjections.map((skill): RuntimePromptFragment => {
      const content = skill.content.trim();
      const contentBytes = Buffer.byteLength(content, 'utf8');
      const includeContent = contentBytes <= remainingBytes;
      if (includeContent) remainingBytes -= contentBytes;
      const pathAttribute = skill.path ? ` path="${escapeSkillAttribute(skill.path)}"` : '';
      return {
        id: `skill_${skill.id}`,
        role: 'user',
        source: 'skill',
        trust: 'user',
        lifecycle: 'turn',
        ...(skill.path ? { sourcePath: skill.path } : {}),
        content: [
          `<skill name="${escapeSkillAttribute(skill.name)}" id="${escapeSkillAttribute(skill.id)}"${pathAttribute}>`,
          includeContent
            ? neutralizeSkillTags(content)
            : skill.path
              ? `Skill content was omitted because the selected-skill budget was exhausted. Read ${JSON.stringify(skill.path)} before applying this skill.`
              : 'Skill content was omitted because the selected-skill budget was exhausted.',
          '</skill>',
        ].join('\n'),
      };
    });
    return {
      fragments,
      selectedSkills: orderedInjections.map((skill) => ({ id: skill.id, name: skill.name, ...(skill.path ? { path: skill.path } : {}) })),
    };
  }

  private async toolSystemPrompt(context: RuntimeToolExecutionContext, router: RuntimeToolRouter | null, tools: RuntimeToolDefinition[]): Promise<string> {
    if (!tools.length) return '';
    const prompt = router
      ? await router.systemPrompt()
      : await this.options.toolHost?.systemPrompt?.(context, { tools });
    return typeof prompt === 'string' ? prompt.trim() : '';
  }
}

function projectWorkflowFragment(workflow: ProjectWorkflow): RuntimePromptFragment {
  return {
    id: 'desktop_project_workflow',
    role: 'user',
    source: 'project_workflow',
    trust: 'external',
    lifecycle: 'workspace',
    content: runtimeProjectWorkflowPrompt(workflow),
  };
}

function baseInstructionFragment(): RuntimePromptFragment {
  return {
    id: 'desktop_runtime_base',
    role: 'system',
    source: 'product',
    trust: 'runtime',
    lifecycle: 'runtime',
    content: RUNTIME_BASE_INSTRUCTIONS,
  };
}

function toolPolicyFragment(content: string): RuntimePromptFragment {
  return {
    id: 'desktop_local_tool_rules',
    role: 'developer',
    source: 'tool_policy',
    trust: 'runtime',
    lifecycle: 'runtime',
    content,
  };
}

function environmentFragment(environment: ToolExecutionEnvironment): RuntimePromptFragment {
  return {
    id: 'desktop_runtime_environment',
    role: 'developer',
    source: 'environment',
    trust: 'runtime',
    lifecycle: 'turn',
    content: runtimeEnvironmentPrompt(environment),
  };
}

function permissionsFragment(
  config: RuntimeConfigState | null | undefined,
  context: RuntimeToolExecutionContext,
  tools: RuntimeToolDefinition[],
): RuntimePromptFragment {
  return {
    id: 'desktop_runtime_permissions',
    role: 'developer',
    source: 'permissions',
    trust: 'runtime',
    lifecycle: 'turn',
    content: runtimePermissionsPrompt({
      approvalPolicy: config?.approvalPolicy ?? 'on-request',
      context,
      tools,
    }),
  };
}

function runtimeContextFragments(messages: RuntimeMessage[]): RuntimePromptFragment[] {
  return messages
    .filter((message) => message.role !== 'tool' && message.content.trim())
    .map((message): RuntimePromptFragment => ({
      id: message.id,
      role: message.role === 'system' || message.role === 'tool' ? 'developer' : message.role,
      source: message.promptSource ?? 'runtime_context',
      trust: message.role === 'user' || message.role === 'assistant' ? 'user' : 'trusted_local',
      lifecycle: 'turn',
      content: message.content,
      ...(message.turnId ? { turnId: message.turnId } : {}),
    }));
}

function personalizationFragments(config: RuntimeConfigState | null | undefined): RuntimePromptFragment[] {
  if (!config) return [];
  const globalPrompt = config.globalPrompt.trim();
  const styleInstruction = config.setsunaStyle === 'daily'
    ? 'Setsuna style: use a more everyday, conversational tone. Be warm, lightweight, and practical; do not over-index on code unless the user asks for development work.'
    : 'Setsuna style: use a development-oriented tone. Prioritize concrete engineering judgment, repo evidence, implementation steps, and validation when code changes are involved.';
  return [{
    id: 'desktop_personalization',
    role: 'user',
    source: 'personalization',
    trust: 'user',
    lifecycle: 'runtime',
    content: [
      'Desktop personalization:',
      'These are user preferences, not runtime policy. Apply them only when they do not conflict with the current request, project instructions, or developer instructions.',
      styleInstruction,
      globalPrompt ? `User global prompt:\n${neutralizePersonalizationTags(globalPrompt)}` : '',
    ].filter(Boolean).join('\n'),
  }];
}

function projectInstructionFragment(source: Awaited<ReturnType<ProjectInstructionLoader['load']>>[number], index: number): RuntimePromptFragment {
  return {
    id: `project_instruction_${index}`,
    role: 'user',
    source: 'project_instruction',
    trust: 'user',
    lifecycle: 'workspace',
    sourcePath: source.path,
    content: [
      index === 0
        ? 'Project instruction files are ordered from the workspace root to the working directory. Later files have narrower scope and override conflicting earlier project instructions.'
        : '',
      `# ${escapeSkillAttribute(source.path.split(/[\\/]/).pop() || 'AGENTS.md')} instructions for ${escapeSkillAttribute(source.directory)}`,
      '<INSTRUCTIONS>',
      neutralizeInstructionTags(source.content),
      source.truncated ? '\n[Instruction file truncated to the configured project-instruction budget.]' : '',
      '</INSTRUCTIONS>',
    ].filter(Boolean).join('\n'),
  };
}

function memoryFragment(message: RuntimeMessage): RuntimePromptFragment {
  return {
    id: message.id,
    role: 'user',
    source: 'memory',
    trust: 'external',
    lifecycle: 'turn',
    content: message.content,
  };
}

function positiveSetting(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function stringArraySetting(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
