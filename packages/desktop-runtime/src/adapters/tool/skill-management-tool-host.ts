import type { RuntimeSkillDetail, RuntimeSkillInput, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { SkillRegistry } from '../../ports/skill-registry.js';
import type { ToolExecutionContext, ToolExecutionPreview, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';

const configureSkillToolName = 'configure_skill';

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
    },
    required: ['name', 'content'],
  },
};

export class SkillManagementToolHost implements ToolHost {
  constructor(private readonly skillRegistry: SkillRegistry) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [configureSkillTool];
  }

  systemPrompt(): string {
    return [
      'When the user asks to create, update, or save a Setsuna Desktop Skill from chat, use configure_skill.',
      'Do not write directly into runtime user-skills directories.',
      'Pass SKILL.md body content without YAML frontmatter; the runtime stores name and description metadata separately.',
    ].join('\n');
  }

  async approvalForTool(name: string, input: unknown, _context?: ToolExecutionContext): Promise<{ reason: string; argumentsPreview?: string } | null> {
    if (name !== configureSkillToolName) return null;
    const preview = await this.skillPreview(input);
    return {
      reason: `${preview.action === 'update' ? '更新' : '创建'}本地 Skill：${preview.name || preview.id}`,
      argumentsPreview: JSON.stringify(preview).slice(0, 1200),
    };
  }

  async previewToolCall(name: string, input: unknown, _context?: ToolExecutionContext): Promise<ToolExecutionPreview | null> {
    if (name !== configureSkillToolName) return null;
    return {
      resultPreview: JSON.stringify(await this.skillPreview(input)),
    };
  }

  async runTool(name: string, input: unknown, _context?: ToolExecutionContext): Promise<ToolExecutionResult> {
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
  };
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
