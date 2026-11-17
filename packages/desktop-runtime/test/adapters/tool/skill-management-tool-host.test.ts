import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileSkillRegistry } from '../../../src/adapters/skill/file-skill-registry.js';
import { SkillManagementToolHost } from '../../../src/adapters/tool/skill-management-tool-host.js';
import { runtimeSkillCatalogPrompt } from '../../../src/loop/context/runtime-skill-catalog-prompt.js';

describe('skill management tool host', () => {
  it('discovers omitted Skills in bounded metadata pages and loads only the requested body', async () => {
    const { host, registry, root } = await createSkillHostFixture();
    try {
      await Promise.all(Array.from({ length: 30 }, (_, index) => registry.createSkill({
        name: `Guide ${String(index).padStart(2, '0')}`,
        description: `Topic ${index}: ${'适用范围🙂'.repeat(500)}`,
        content: `Private workflow body ${index}`,
      })));
      await registry.updateSkill('guide-00', { enabled: false });
      const catalog = runtimeSkillCatalogPrompt((await registry.listSkills()).skills, {
        maxMetadataChars: 200, readSkillAvailable: true,
      });
      expect(catalog?.omittedSkillIds).toContain('guide-29');

      type Page = { skills: { id: string; description?: string; content_version: string }[]; next_offset: number | null };
      const discovered: Page['skills'] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const result = await host.runTool('list_skills', { offset });
        expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThanOrEqual(16 * 1024);
        expect(result.content).not.toContain('Private workflow body');
        const page = JSON.parse(result.content) as Page;
        expect(page.skills.length).toBeGreaterThan(0);
        if (page.next_offset !== null) expect(page.next_offset).toBeGreaterThan(offset);
        discovered.push(...page.skills);
        offset = page.next_offset;
      }
      expect(new Set(discovered.map((skill) => skill.id)).size).toBe(30);
      expect(discovered.map((skill) => skill.id)).not.toContain('guide-00');
      expect(discovered.map((skill) => skill.id)).toContain('guide-29');

      const found = JSON.parse((await host.runTool('list_skills', { query: 'GUIDE-29' })).content) as Page;
      expect(found.skills.map((skill) => skill.id)).toEqual(['guide-29']);
      await expect(host.runTool('read_skill', {
        skill_id: found.skills[0]!.id, content_version: found.skills[0]!.content_version,
      })).resolves.toMatchObject({ content: expect.stringContaining('Private workflow body 29'), data: { complete: true } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cancels read_skill while initialization is pending and permits a later read', async () => {
    const { host, registry } = await createSkillHostFixture();
    const skill = await registry.getSkill('builtin-guide');
    let finishRead!: (value: typeof skill) => void;
    const pendingRead = new Promise<typeof skill>((resolve) => { finishRead = resolve; });
    const read = vi.spyOn(registry, 'getSkill').mockReturnValue(pendingRead);
    const controller = new AbortController();
    const input = { skill_id: 'builtin-guide', content_version: skill!.contentVersion };
    try {
      const waiting = host.runTool('read_skill', input, { threadId: 'cancelled', signal: controller.signal });
      const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
      controller.abort();
      await rejected;
      finishRead(skill);
      await expect(host.runTool('read_skill', input, { threadId: 'other' }))
        .resolves.toMatchObject({ data: { complete: true } });
    } finally {
      finishRead(skill);
      read.mockRestore();
    }
  });

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

async function createSkillHostFixture(): Promise<{ host: SkillManagementToolHost; registry: FileSkillRegistry; root: string }> {
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
    root,
    host: new SkillManagementToolHost(registry),
    registry,
  };
}
