import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSkillRegistry } from '../skill/file-skill-registry.js';
import { SkillManagementToolHost } from './skill-management-tool-host.js';

describe('skill management tool host', () => {
  it('creates and updates local skills through configure_skill', async () => {
    const { host, registry } = await createSkillHostFixture();

    const tools = await host.listTools({ threadId: 'thread_1' });
    expect(tools.map((tool) => tool.name)).toContain('configure_skill');
    await expect(host.approvalForTool('configure_skill', {
      name: 'Conversation Helper',
      description: 'Helps create local skills from chat',
      content: '# Conversation Helper\n\nUse chat context.',
      selected: true,
    })).resolves.toMatchObject({
      reason: expect.stringContaining('创建本地 Skill'),
    });

    const created = await host.runTool('configure_skill', {
      name: 'Conversation Helper',
      description: 'Helps create local skills from chat',
      content: '# Conversation Helper\n\nUse chat context.',
      selected: true,
    });

    expect(created.content).toContain('Skill configured: Conversation Helper');
    const saved = await registry.getSkill('conversation-helper');
    expect(saved).toMatchObject({
      id: 'conversation-helper',
      kind: 'user',
      enabled: true,
      selected: true,
      name: 'Conversation Helper',
    });
    expect(saved?.path ? await readFile(saved.path, 'utf8') : '').toContain('name: "Conversation Helper"');

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
      selected: false,
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
