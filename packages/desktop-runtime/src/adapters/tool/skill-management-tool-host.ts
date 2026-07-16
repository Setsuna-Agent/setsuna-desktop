import type { RuntimeSkillDetail, RuntimeSkillInput, RuntimeSkillMcpDependencyInput, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { SkillMcpDependencyManager, SkillRegistry } from '../../ports/skill-registry.js';
import type { ToolExecutionContext, ToolExecutionPreview, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';

const configureSkillToolName = 'configure_skill';
const installSkillMcpDependenciesToolName = 'install_skill_mcp_dependencies';
const authenticateSkillMcpDependencyToolName = 'authenticate_skill_mcp_dependency';

const configureSkillTool: RuntimeToolDefinition = {
  name: configureSkillToolName,
  description: 'Create or update a local desktop Skill. Use this for chat-driven Skill creation instead of writing runtime files directly.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Optional stable skill id. If omitted, the id is generated from the name.',
      },
      name: {
        type: 'string',
        description: 'Display name for the Skill.',
      },
      description: {
        type: 'string',
        description: 'One-sentence description of when to use this Skill.',
      },
      content: {
        type: 'string',
        description: 'SKILL.md body content without YAML frontmatter.',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether the Skill is enabled. Defaults to true.',
      },
      selected: {
        type: 'boolean',
        description: 'Whether the Skill should be globally selected for future turns. Defaults to false.',
      },
      mcp_dependencies: {
        type: 'array',
        description: 'Optional MCP dependencies stored in agents/openai.yaml. Do not include tokens or plaintext secrets.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['mcp'] },
            value: { type: 'string', description: 'Stable MCP server key.' },
            transport: { type: 'string', enum: ['stdio', 'streamable_http'] },
            label: { type: 'string' },
            description: { type: 'string' },
            url: { type: 'string' },
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            oauth_client_id: { type: 'string' },
            oauth_resource: { type: 'string' },
          },
          required: ['type', 'value', 'transport'],
          additionalProperties: false,
        },
      },
    },
    required: ['name', 'content'],
  },
};

const installSkillMcpDependenciesTool: RuntimeToolDefinition = {
  name: installSkillMcpDependenciesToolName,
  description: 'Install or enable the MCP servers declared by a local Skill agents/openai.yaml manifest.',
  inputSchema: {
    type: 'object',
    properties: {
      skill_id: { type: 'string', description: 'Skill id declaring the MCP dependencies.' },
    },
    required: ['skill_id'],
    additionalProperties: false,
  },
};

const authenticateSkillMcpDependencyTool: RuntimeToolDefinition = {
  name: authenticateSkillMcpDependencyToolName,
  description: 'Start OAuth login for one installed MCP server declared by a Skill.',
  inputSchema: {
    type: 'object',
    properties: {
      skill_id: { type: 'string', description: 'Skill id declaring the MCP dependency.' },
      server_key: { type: 'string', description: 'Declared MCP server key requiring authentication.' },
    },
    required: ['skill_id', 'server_key'],
    additionalProperties: false,
  },
};

export class SkillManagementToolHost implements ToolHost {
  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly dependencyManager?: SkillMcpDependencyManager,
  ) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      configureSkillTool,
      ...(this.dependencyManager && context.features?.skill_mcp_dependency_install !== false
        ? [installSkillMcpDependenciesTool, authenticateSkillMcpDependencyTool]
        : []),
    ];
  }

  toolRuntimeProfile() {
    return { exposure: 'deferred' as const };
  }

  systemPrompt(): string {
    return [
      'When the user asks to create, update, or save a Setsuna Desktop Skill from chat, use configure_skill.',
      'Do not write directly into runtime user-skills directories.',
      'Pass SKILL.md body content without YAML frontmatter; the runtime stores name and description metadata separately.',
      'Pass optional mcp_dependencies for non-secret MCP configuration that should be written to agents/openai.yaml.',
      'A selected Skill can declare MCP dependencies in agents/openai.yaml. If its injected dependency status is missing or disabled, use install_skill_mcp_dependencies; if it is authRequired, use authenticate_skill_mcp_dependency.',
      'Both dependency actions require explicit user approval. Do not edit MCP config files directly.',
    ].join('\n');
  }

  async approvalForTool(name: string, input: unknown, _context?: ToolExecutionContext): Promise<{ reason: string; argumentsPreview?: string } | null> {
    if (name === installSkillMcpDependenciesToolName) {
      const skillId = dependencyToolInput(input).skillId;
      return {
        reason: `安装或启用 Skill「${skillId}」声明的 MCP 依赖`,
        argumentsPreview: JSON.stringify({ skillId }),
      };
    }
    if (name === authenticateSkillMcpDependencyToolName) {
      const { skillId, serverKey } = requiredDependencyToolInput(input);
      return {
        reason: `登录 Skill「${skillId}」依赖的 MCP：${serverKey}`,
        argumentsPreview: JSON.stringify({ skillId, serverKey }),
      };
    }
    if (name !== configureSkillToolName) return null;
    const preview = await this.skillPreview(input);
    return {
      reason: `${preview.action === 'update' ? '更新' : '创建'}本地 Skill：${preview.name || preview.id}`,
      argumentsPreview: JSON.stringify(preview).slice(0, 1200),
    };
  }

  async previewToolCall(name: string, input: unknown, _context?: ToolExecutionContext): Promise<ToolExecutionPreview | null> {
    if (name === installSkillMcpDependenciesToolName || name === authenticateSkillMcpDependencyToolName) {
      const preview = name === authenticateSkillMcpDependencyToolName
        ? requiredDependencyToolInput(input)
        : dependencyToolInput(input);
      return { resultPreview: JSON.stringify(preview) };
    }
    if (name !== configureSkillToolName) return null;
    return {
      resultPreview: JSON.stringify(await this.skillPreview(input)),
    };
  }

  async runTool(name: string, input: unknown, _context?: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (name === installSkillMcpDependenciesToolName) {
      if (!this.dependencyManager) throw new Error('Skill MCP dependency installation is unavailable.');
      const { skillId } = dependencyToolInput(input);
      const result = await this.dependencyManager.installMcpDependencies(skillId);
      return {
        content: [
          `Skill MCP dependencies resolved: ${result.skill.name}`,
          result.installed.length ? `Installed: ${result.installed.join(', ')}` : '',
          result.enabled.length ? `Enabled: ${result.enabled.join(', ')}` : '',
          `Statuses: ${(result.skill.mcpDependencies ?? []).map((item) => `${item.value}=${item.status}`).join(', ')}`,
        ].filter(Boolean).join('\n'),
        preview: JSON.stringify({ skillId, installed: result.installed, enabled: result.enabled }),
        data: result,
      };
    }
    if (name === authenticateSkillMcpDependencyToolName) {
      if (!this.dependencyManager) throw new Error('Skill MCP dependency authentication is unavailable.');
      const { skillId, serverKey } = requiredDependencyToolInput(input);
      const skill = await this.dependencyManager.authenticateMcpDependency(skillId, serverKey);
      return {
        content: `MCP dependency authenticated: ${serverKey}`,
        preview: JSON.stringify({ skillId, serverKey, status: skill.mcpDependencies?.find((item) => item.value === serverKey)?.status }),
        data: skill,
      };
    }
    if (name !== configureSkillToolName) throw new Error(`Unknown tool: ${name}`);
    const normalized = normalizeSkillInput(input);
    const existing = normalized.id ? await this.skillRegistry.getSkill(normalized.id) : null;
    if (existing?.kind === 'builtin') throw new Error(`Built-in skill is read-only: ${existing.id}`);
    if (existing?.kind === 'plugin') throw new Error(`Plugin skill is read-only: ${existing.id}`);

    const saved = existing
      ? await this.skillRegistry.updateSkill(existing.id, normalized)
      : await this.skillRegistry.createSkill(normalized);

    return {
      content: [
        `Skill configured: ${saved.name}`,
        `ID: ${saved.id}`,
        saved.path ? `Path: ${saved.path}` : '',
        saved.enabled ? 'Enabled: true' : 'Enabled: false',
        saved.selected ? 'Selected: true' : 'Selected: false',
      ].filter(Boolean).join('\n'),
      preview: JSON.stringify(skillResultPreview(existing ? 'update' : 'create', saved)),
      data: saved,
    };
  }

  private async skillPreview(input: unknown): Promise<ReturnType<typeof skillPreviewPayload>> {
    const normalized = normalizeSkillInput(input);
    const existing = normalized.id ? await this.skillRegistry.getSkill(normalized.id) : null;
    return skillPreviewPayload(existing ? 'update' : 'create', normalized, existing);
  }
}

function dependencyToolInput(input: unknown): { skillId: string; serverKey?: string } {
  const record = recordInput(input);
  const skillId = optionalString(record.skill_id ?? record.skillId);
  const serverKey = optionalString(record.server_key ?? record.serverKey);
  if (!skillId) throw new Error('skill_id is required.');
  return { skillId, ...(serverKey ? { serverKey } : {}) };
}

function requiredDependencyToolInput(input: unknown): { skillId: string; serverKey: string } {
  const parsed = dependencyToolInput(input);
  if (!parsed.serverKey) throw new Error('server_key is required.');
  return { skillId: parsed.skillId, serverKey: parsed.serverKey };
}

function normalizeSkillInput(input: unknown): RuntimeSkillInput {
  const record = recordInput(input);
  const name = stringValue(record.name).trim();
  const content = stringValue(record.content).trim();
  const id = normalizeSkillId(stringValue(record.id || name));
  if (!name) throw new Error('Skill name is required.');
  if (!content) throw new Error('Skill content is required.');
  return {
    id,
    name,
    description: optionalString(record.description),
    content,
    enabled: booleanValue(record.enabled, true),
    selected: booleanValue(record.selected, false),
    ...(record.mcp_dependencies !== undefined || record.mcpDependencies !== undefined
      ? { mcpDependencies: normalizeSkillMcpDependencies(record.mcp_dependencies ?? record.mcpDependencies) }
      : {}),
  };
}

function skillPreviewPayload(
  action: 'create' | 'update',
  input: RuntimeSkillInput,
  existing?: RuntimeSkillDetail | null,
) {
  return {
    action,
    id: input.id,
    name: input.name,
    description: input.description,
    enabled: input.enabled,
    selected: input.selected,
    existingPath: existing?.path,
    contentChars: input.content.length,
    mcpDependencyCount: input.mcpDependencies?.length ?? 0,
  };
}

function normalizeSkillMcpDependencies(value: unknown): RuntimeSkillMcpDependencyInput[] {
  if (!Array.isArray(value)) throw new Error('mcp_dependencies must be an array.');
  return value.map((item, index) => {
    const input = recordInput(item);
    const type = optionalString(input.type);
    const serverKey = optionalString(input.value);
    const rawTransport = optionalString(input.transport);
    if (type !== 'mcp') throw new Error(`mcp_dependencies[${index}].type must be mcp.`);
    if (!serverKey) throw new Error(`mcp_dependencies[${index}].value is required.`);
    const transport = rawTransport === 'streamable_http' || rawTransport === 'streamableHttp'
      ? 'streamableHttp'
      : rawTransport === 'stdio'
        ? 'stdio'
        : null;
    if (!transport) throw new Error(`mcp_dependencies[${index}].transport must be stdio or streamable_http.`);
    return {
      type: 'mcp',
      value: serverKey,
      transport,
      ...(optionalString(input.label) ? { label: optionalString(input.label) } : {}),
      ...(optionalString(input.description) ? { description: optionalString(input.description) } : {}),
      ...(optionalString(input.url) ? { url: optionalString(input.url) } : {}),
      ...(optionalString(input.command) ? { command: optionalString(input.command) } : {}),
      ...(input.args !== undefined ? { args: stringArray(input.args, `mcp_dependencies[${index}].args`) } : {}),
      ...(optionalString(input.oauth_client_id ?? input.oauthClientId) ? { oauthClientId: optionalString(input.oauth_client_id ?? input.oauthClientId) } : {}),
      ...(optionalString(input.oauth_resource ?? input.oauthResource) ? { oauthResource: optionalString(input.oauth_resource ?? input.oauthResource) } : {}),
    };
  });
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${name} must be a string array.`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function skillResultPreview(action: 'create' | 'update', skill: RuntimeSkillDetail) {
  return {
    action,
    id: skill.id,
    name: skill.name,
    path: skill.path,
    enabled: skill.enabled,
    selected: skill.selected,
  };
}

function normalizeSkillId(value: string): string | undefined {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return id || undefined;
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  return text || undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
