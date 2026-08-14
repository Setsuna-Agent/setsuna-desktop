import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSkillRegistry } from '../../../src/adapters/skill/file-skill-registry.js';
import { SkillManagementToolHost } from '../../../src/adapters/tool/skill-management-tool-host.js';

describe('skill management tool host', () => {
  it('reads complete instructions only for enabled Skills without approval', async () => {
    const { host, registry } = await createSkillHostFixture();
    const builtin = await registry.getSkill('builtin-guide');
    expect(builtin?.contentVersion).toMatch(/^sha256-/);

    const tools = await host.listTools({ threadId: 'thread_1' });
    expect(tools.map((tool) => tool.name)).toContain('read_skill');
    expect(tools.find((tool) => tool.name === 'read_skill')?.inputSchema).toMatchObject({
      required: ['skill_id', 'content_version'],
    });
    await expect(host.approvalForTool('read_skill', { skill_id: 'builtin-guide' })).resolves.toBeNull();
    await expect(host.runTool('read_skill', { skill_id: 'builtin-guide' })).rejects.toThrow('content_version is required');
    await expect(host.runTool('read_skill', {
      skill_id: 'builtin-guide',
      content_version: builtin?.contentVersion,
    })).resolves.toMatchObject({
      content: expect.stringContaining('Use this built-in guide.'),
      preview: expect.stringContaining('"skillId":"builtin-guide"'),
      data: expect.objectContaining({ complete: true, contentVersion: expect.stringMatching(/^sha256-/) }),
    });

    await registry.updateSkill('builtin-guide', { enabled: false });
    await expect(host.runTool('read_skill', {
      skill_id: 'builtin-guide',
      content_version: builtin?.contentVersion,
    })).rejects.toThrow('Skill is disabled');
  });

  it('limits read_skill to version-bound chunks and rejects stale continuation versions', async () => {
    const { host, registry } = await createSkillHostFixture();
    const created = await registry.createSkill({
      name: 'Large Guide',
      content: `# Large Guide\n\n${'🙂'.repeat(12_000)}`,
    });

    const first = await host.runTool('read_skill', {
      skill_id: created.id,
      content_version: created.contentVersion,
    });
    const firstData = first.data as {
      complete: boolean;
      contentVersion: string;
      nextOffset: number | null;
    };
    expect(Buffer.byteLength(first.content, 'utf8')).toBeLessThanOrEqual(16 * 1024);
    expect(first.content).not.toContain('�');
    expect(firstData).toMatchObject({ complete: false, contentVersion: created.contentVersion });
    expect(firstData.nextOffset).toBeTypeOf('number');

    const second = await host.runTool('read_skill', {
      skill_id: created.id,
      content_version: created.contentVersion,
      offset: firstData.nextOffset,
    });
    expect(second.content).toContain(`Content version: ${created.contentVersion}`);
    expect(second.content).toContain(`Chunk: ${firstData.nextOffset}-`);

    const updated = await registry.updateSkill(created.id, { content: '# Large Guide\n\nUpdated.' });
    expect(updated.contentVersion).not.toBe(created.contentVersion);
    await expect(host.runTool('read_skill', {
      skill_id: created.id,
      content_version: created.contentVersion,
      offset: firstData.nextOffset,
    })).resolves.toMatchObject({
      content: expect.stringContaining('Discard chunks from the older version'),
      data: expect.objectContaining({
        requestedContentVersion: created.contentVersion,
        contentVersion: updated.contentVersion,
        versionMismatch: true,
      }),
    });
  });

  it('describes only Skill tools advertised for the current request', async () => {
    const { host } = await createSkillHostFixture();
    const tools = await host.listTools({ threadId: 'thread_1' });
    const readTool = tools.find((tool) => tool.name === 'read_skill');
    expect(readTool).toBeDefined();

    const prompt = host.systemPrompt(
      { threadId: 'thread_1' },
      { tools: [readTool!] },
    );
    expect(prompt).toContain('call read_skill');
    expect(prompt).not.toContain('configure_skill');
    expect(prompt).not.toContain('install_skill_mcp_dependencies');
    expect(prompt).not.toContain('authenticate_skill_mcp_dependency');
  });

  it('creates and updates local skills through configure_skill', async () => {
    const { host, registry } = await createSkillHostFixture();

    const tools = await host.listTools({ threadId: 'thread_1' });
    expect(tools.map((tool) => tool.name)).toContain('configure_skill');
    await expect(host.approvalForTool('configure_skill', {
      name: 'Conversation Helper',
      description: 'Helps create local skills from chat',
      content: '# Conversation Helper\n\nUse chat context.',
    })).resolves.toMatchObject({
      reason: expect.stringContaining('创建本地 Skill'),
    });

    const created = await host.runTool('configure_skill', {
      name: 'Conversation Helper',
      description: 'Helps create local skills from chat',
      content: '# Conversation Helper\n\nUse chat context.',
      mcp_dependencies: [{
        type: 'mcp',
        value: 'docs',
        transport: 'streamable_http',
        url: 'https://developers.openai.com/mcp',
      }],
    });

    expect(created.content).toContain('Skill configured: Conversation Helper');
    const saved = await registry.getSkill('conversation-helper');
    expect(saved).toMatchObject({
      id: 'conversation-helper',
      kind: 'user',
      enabled: true,
      name: 'Conversation Helper',
    });
    expect(saved?.path ? await readFile(saved.path, 'utf8') : '').toContain('name: "Conversation Helper"');
    expect(saved?.path ? await readFile(path.join(path.dirname(saved.path), 'agents', 'openai.yaml'), 'utf8') : '')
      .toContain('value: docs');

    await expect(host.previewToolCall('configure_skill', {
      id: 'conversation-helper',
      name: 'Conversation Helper',
      content: '# Changed\n\nKeep it narrow.',
    })).resolves.toMatchObject({
      resultPreview: expect.stringContaining('"action":"update"'),
    });

    const updated = await host.runTool('configure_skill', {
      id: 'conversation-helper',
      name: 'Conversation Guide',
      content: '# Changed\n\nKeep it narrow.',
      enabled: false,
    });

    expect(updated.preview).toContain('"action":"update"');
    await expect(registry.getSkill('conversation-helper')).resolves.toMatchObject({
      id: 'conversation-helper',
      name: 'Conversation Guide',
      enabled: false,
      content: expect.stringContaining('Keep it narrow.'),
    });
  });

  it('keeps built-in skills read-only', async () => {
    const { host } = await createSkillHostFixture();

    await expect(host.runTool('configure_skill', {
      id: 'builtin-guide',
      name: 'Builtin Guide',
      content: '# Changed',
    })).rejects.toThrow('Built-in skill is read-only');
  });
});

async function createSkillHostFixture(): Promise<{ host: SkillManagementToolHost; registry: FileSkillRegistry }> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-skill-toolhost-test-'));
  const builtinDir = path.join(root, 'skills');
  const dataDir = path.join(root, 'data');
  const builtinSkillDir = path.join(builtinDir, 'builtin-guide');
  await mkdir(builtinSkillDir, { recursive: true });
  await writeFile(
    path.join(builtinSkillDir, 'SKILL.md'),
    [
      '---',
      'name: Builtin Guide',
      'description: Built-in test skill',
      '---',
      '',
      '# Builtin Guide',
      '',
      'Use this built-in guide.',
    ].join('\n'),
    'utf8',
  );
  const registry = new FileSkillRegistry(builtinDir, dataDir);
  return {
    host: new SkillManagementToolHost(registry),
    registry,
  };
}
