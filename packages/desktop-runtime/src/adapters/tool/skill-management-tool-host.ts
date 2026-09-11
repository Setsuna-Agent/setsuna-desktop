import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type {
  RuntimeSkillDetail,
  RuntimeSkillInput,
  RuntimeSkillMcpDependencyInput,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type {
  SkillMcpDependencyManager,
  SkillRegistry,
} from '@setsuna-desktop/feature-skills/contracts';
import type {
  ToolExecutionContext,
  ToolExecutionPreview,
  ToolExecutionResult,
  ToolHost,
} from '../../ports/tool-host.js';
import { skillContentVersion } from '../../shared/skill-content-version.js';
import { recordInput } from '../../shared/unknown.js';

const configureSkillToolName = 'configure_skill';
const readSkillToolName = 'read_skill';
const installSkillMcpDependenciesToolName = 'install_skill_mcp_dependencies';
const authenticateSkillMcpDependencyToolName = 'authenticate_skill_mcp_dependency';
const READ_SKILL_RESULT_MAX_BYTES = 16 * 1024;
const READ_SKILL_RESULT_CONTROL_RESERVE_BYTES = 512;

function configureSkillDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: configureSkillToolName,
    description: text('Create or update a local desktop Skill. Use this for chat-driven Skill creation instead of writing runtime files directly.', "创建或更新本地桌面 Skill。通过对话创建 Skill 时使用此工具，不要直接写入运行时文件。"),
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: text('Optional stable skill id. If omitted, the id is generated from the name.', "可选稳定的 Skill ID；省略时根据名称生成。"),
        },
        name: {
          type: 'string',
          description: text('Display name for the Skill.', "Skill 显示名称。"),
        },
        description: {
          type: 'string',
          description: text('One-sentence description of when to use this Skill.', "用一句话描述何时使用此 Skill。"),
        },
        content: {
          type: 'string',
          description: text('SKILL.md body content without YAML frontmatter.', "不含 YAML frontmatter 的 SKILL.md 正文。"),
        },
        enabled: {
          type: 'boolean',
          description: text('Whether the Skill is enabled. Defaults to true.', "是否启用 Skill。默认 true。"),
        },
        mcp_dependencies: {
          type: 'array',
          description: text('Optional MCP dependencies stored in agents/openai.yaml. Do not include tokens or plaintext secrets.', "可选存储于 agents/openai.yaml 的 MCP 依赖。不得包含 token 或明文秘密。"),
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['mcp'] },
              value: { type: 'string', description: text('Stable MCP server key.', "稳定的 MCP 服务标识。") },
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
}

function readSkillDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: readSkillToolName,
    description: text('Read one bounded chunk of the current instructions for an enabled Skill. Continue from next_offset until complete before applying a Skill that was not injected for this turn, and restart at offset 0 when content_version changes.', "分块读取已启用 Skill 的当前指令。应用本轮未注入的 Skill 前，按 next_offset 读到 complete；content_version 变化时从 offset 0 重新读取。"),
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: text('Stable id from the enabled Skills metadata catalog.', "已启用 Skill 元数据目录中的稳定 ID。") },
        content_version: { type: 'string', description: text('Content version from the current Skills metadata catalog. Prevents mixing chunks from different revisions.', "当前 Skill 元数据目录中的内容版本，防止混用不同版本的分块。") },
        offset: { type: 'integer', minimum: 0, description: text('Optional UTF-16 character offset returned as next_offset by the previous chunk. Defaults to 0.', "可选 UTF-16 字符偏移，由上一块的 next_offset 返回。默认 0。") },
      },
      required: ['skill_id', 'content_version'],
      additionalProperties: false,
    },
  };
}

function installSkillMcpDependenciesDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: installSkillMcpDependenciesToolName,
    description: text('Install or enable the MCP servers declared by a local Skill agents/openai.yaml manifest.', "安装或启用本地 Skill 的 agents/openai.yaml 声明的 MCP 服务。"),
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: text('Skill id declaring the MCP dependencies.', "声明这些 MCP 依赖的 Skill ID。") },
      },
      required: ['skill_id'],
      additionalProperties: false,
    },
  };
}

function authenticateSkillMcpDependencyDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: authenticateSkillMcpDependencyToolName,
    description: text('Start OAuth login for one installed MCP server declared by a Skill.', "为 Skill 声明且已安装的一个 MCP 服务启动 OAuth 登录。"),
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: text('Skill id declaring the MCP dependency.', "声明该 MCP 依赖的 Skill ID。") },
        server_key: { type: 'string', description: text('Declared MCP server key requiring authentication.', "声明中需要认证的 MCP 服务标识。") },
      },
      required: ['skill_id', 'server_key'],
      additionalProperties: false,
    },
  };
}

export class SkillManagementToolHost implements ToolHost {
  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly dependencyManager?: SkillMcpDependencyManager,
  ) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      readSkillDefinition(context.interfaceLanguage),
      configureSkillDefinition(context.interfaceLanguage),
      ...(this.dependencyManager && context.features?.skill_mcp_dependency_install !== false
        ? [installSkillMcpDependenciesDefinition(context.interfaceLanguage), authenticateSkillMcpDependencyDefinition(context.interfaceLanguage)]
        : []),
    ];
  }

  systemPrompt(
    context: ToolExecutionContext,
    request?: { tools: RuntimeToolDefinition[] },
  ): string | null {
    const text = runtimeText(context.interfaceLanguage);
    const advertised = request ? new Set(request.tools.map((tool) => tool.name)) : null;
    const lines: string[] = [];
    if (toolIsAdvertised(advertised, readSkillToolName)) {
      lines.push(
        text('Every enabled Skill is advertised separately as routing metadata. Metadata visibility does not mean the full Skill instructions have been loaded.', "所有已启用 Skill 都会单独公布路由元数据。能看到元数据不代表已加载完整指令。"),
        text('When a request matches a Skill that was not injected for the current turn, call read_skill with its skill_id and current content_version. Read every chunk through complete=true before acting, and restart from offset 0 if the catalog version changes.', "请求匹配本轮未注入的 Skill 时，调用 read_skill，提供 skill_id 和当前 content_version。行动前读取所有分块直到 complete=true；目录版本变化后从 offset 0 重读。"),
      );
    }
    if (toolIsAdvertised(advertised, configureSkillToolName)) {
      lines.push(
        text('When the user asks to create, update, or save a Setsuna Desktop Skill from chat, use configure_skill.', "用户通过对话要求创建、更新或保存 Setsuna Desktop Skill 时，使用 configure_skill。"),
        text('Do not write directly into runtime user-skills directories.', "不要直接写入运行时的 user-skills 目录。"),
        text('Pass SKILL.md body content without YAML frontmatter; the runtime stores name and description metadata separately.', "传入不含 YAML frontmatter 的 SKILL.md 正文；运行时会单独存储名称和描述元数据。"),
        text('Pass optional mcp_dependencies for non-secret MCP configuration that should be written to agents/openai.yaml.', "需要将非秘密 MCP 配置写入 agents/openai.yaml 时，传入可选的 mcp_dependencies。"),
      );
    }
    const canInstall = toolIsAdvertised(advertised, installSkillMcpDependenciesToolName);
    const canAuthenticate = toolIsAdvertised(advertised, authenticateSkillMcpDependencyToolName);
    if (canInstall || canAuthenticate) {
      lines.push(
        [
          text('An injected Skill can declare MCP dependencies in agents/openai.yaml.', "注入的 Skill 可以在 agents/openai.yaml 中声明 MCP 依赖。"),
          ...(canInstall ? [text('Use install_skill_mcp_dependencies when an injected dependency is missing or disabled.', "注入的依赖缺失或被禁用时，使用 install_skill_mcp_dependencies。")] : []),
          ...(canAuthenticate ? [text('Use authenticate_skill_mcp_dependency when an injected dependency is authRequired.', "注入的依赖状态为 authRequired 时，使用 authenticate_skill_mcp_dependency。")] : []),
        ].join(' '),
        text('Advertised dependency actions require explicit user approval. Do not edit MCP config files directly.', "公布的依赖操作需要明确的用户审批。不要直接编辑 MCP 配置文件。"),
      );
    }
    return lines.join('\n') || null;
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
    if (name === readSkillToolName) {
      return { resultPreview: JSON.stringify(readSkillInput(input)) };
    }
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
    if (name === readSkillToolName) {
      const { skillId, contentVersion, offset } = readSkillInput(input);
      const skill = await this.skillRegistry.getSkill(skillId);
      if (!skill) throw new Error(`Skill not found: ${skillId}`);
      if (!skill.enabled) throw new Error(`Skill is disabled: ${skillId}`);
      const currentContentVersion = skill.contentVersion ?? skillContentVersion(skill.content);
      if (contentVersion !== currentContentVersion) {
        return {
          content: [
            `Skill changed before the requested chunk could be read: ${boundedSingleLine(skill.name, 512)}`,
            `ID: ${boundedSingleLine(skill.id, 256)}`,
            `Requested content version: ${boundedSingleLine(contentVersion, 128)}`,
            `Current content version: ${currentContentVersion}`,
            'Discard chunks from the older version and call read_skill again with the current content_version and offset 0.',
          ].join('\n'),
          preview: JSON.stringify({
            skillId: skill.id,
            requestedContentVersion: contentVersion,
            contentVersion: currentContentVersion,
            versionMismatch: true,
          }),
          data: {
            skillId: skill.id,
            requestedContentVersion: contentVersion,
            contentVersion: currentContentVersion,
            versionMismatch: true,
          },
        };
      }
      const body = skill.content.trim();
      if (offset > body.length) {
        throw new Error(`read_skill offset ${offset} exceeds Skill length ${body.length}. Restart at offset 0.`);
      }
      const dependencySummary = [
        ...(skill.mcpDependencies ?? []).map((dependency) => `${dependency.value}=${dependency.status}`),
        ...(skill.dependencyErrors ?? []).map((error) => `invalid=${error}`),
      ];
      const header = [
        `Skill instructions: ${boundedSingleLine(skill.name, 512)}`,
        `ID: ${boundedSingleLine(skill.id, 256)}`,
        `Content version: ${currentContentVersion}`,
        skill.path ? `Path: ${boundedSingleLine(skill.path, 1_024)}` : '',
        dependencySummary.length
          ? `MCP dependencies: ${boundedSingleLine(dependencySummary.join(', '), 2_048)}`
          : '',
      ].filter(Boolean).join('\n');
      const chunkBudget = Math.max(
        0,
        READ_SKILL_RESULT_MAX_BYTES
          - Buffer.byteLength(`${header}\n\n`, 'utf8')
          - READ_SKILL_RESULT_CONTROL_RESERVE_BYTES,
      );
      const chunk = utf8Chunk(body, offset, chunkBudget);
      const complete = chunk.nextOffset >= body.length;
      const control = [
        `Chunk: ${offset}-${chunk.nextOffset} of ${body.length} UTF-16 characters`,
        `Complete: ${complete}`,
        ...(!complete
          ? [
              `Next offset: ${chunk.nextOffset}`,
              `Call read_skill again with content_version ${JSON.stringify(currentContentVersion)} and offset ${chunk.nextOffset} before applying this Skill.`,
            ]
          : []),
      ].join('\n');
      const content = `${header}\n${control}\n\n${chunk.content}`;
      if (Buffer.byteLength(content, 'utf8') > READ_SKILL_RESULT_MAX_BYTES) {
        throw new Error('Internal read_skill result budget error.');
      }
      return {
        content,
        preview: JSON.stringify({
          skillId: skill.id,
          name: skill.name,
          path: skill.path,
          contentVersion: currentContentVersion,
          offset,
          nextOffset: complete ? null : chunk.nextOffset,
          complete,
        }),
        data: {
          skillId: skill.id,
          contentVersion: currentContentVersion,
          offset,
          nextOffset: complete ? null : chunk.nextOffset,
          complete,
          totalCharacters: body.length,
        },
      };
    }
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

    const saved = existing
      ? await this.skillRegistry.updateSkill(existing.id, normalized)
      : await this.skillRegistry.createSkill(normalized);

    return {
      content: [
        `Skill configured: ${saved.name}`,
        `ID: ${saved.id}`,
        saved.path ? `Path: ${saved.path}` : '',
        saved.enabled ? 'Enabled: true' : 'Enabled: false',
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

function toolIsAdvertised(advertised: ReadonlySet<string> | null, toolName: string): boolean {
  return advertised?.has(toolName) ?? true;
}

function readSkillInput(input: unknown): {
  skillId: string;
  contentVersion: string;
  offset: number;
} {
  const record = recordInput(input);
  const skillId = optionalString(record.skill_id ?? record.skillId);
  const contentVersion = optionalString(record.content_version ?? record.contentVersion);
  const rawOffset = record.offset ?? 0;
  if (!skillId) throw new Error('skill_id is required.');
  if (!contentVersion) throw new Error('content_version is required.');
  if (typeof rawOffset !== 'number' || !Number.isSafeInteger(rawOffset) || rawOffset < 0) {
    throw new Error('offset must be a non-negative safe integer.');
  }
  return { skillId, contentVersion, offset: rawOffset };
}

function utf8Chunk(value: string, offset: number, maxBytes: number): { content: string; nextOffset: number } {
  if (maxBytes <= 0 || offset >= value.length) return { content: '', nextOffset: offset };
  let low = offset;
  // Every UTF-16 code unit needs at least one UTF-8 byte, so there is no need
  // to inspect the rest of a potentially multi-megabyte Skill body.
  let high = Math.min(value.length, offset + maxBytes);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(offset, middle), 'utf8') <= maxBytes) low = middle;
    else high = middle - 1;
  }
  if (low > offset && low < value.length && isHighSurrogate(value.charCodeAt(low - 1)) && isLowSurrogate(value.charCodeAt(low))) {
    low -= 1;
  }
  return { content: value.slice(offset, low), nextOffset: low };
}

function boundedSingleLine(value: string, maxBytes: number): string {
  // Normalize only a bounded prefix so hostile frontmatter cannot force a
  // second multi-megabyte allocation merely to render the control header.
  const normalized = value.slice(0, Math.max(0, maxBytes * 2)).normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return utf8Chunk(normalized, 0, maxBytes).content;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xD800 && code <= 0xDBFF;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xDC00 && code <= 0xDFFF;
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
