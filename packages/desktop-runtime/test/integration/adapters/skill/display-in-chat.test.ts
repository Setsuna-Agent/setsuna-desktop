import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { FileSkillRegistry } from '../../../../src/adapters/skill/file-skill-registry.js';
import { SkillManagementToolHost } from '../../../../src/adapters/tool/skill-management-tool-host.js';

it.each(['zh-CN', 'en-US'] as const)('makes the complete bundled OpenUI catalog available through read_skill in %s', async (language) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-openui-skill-'));
  try {
    const registry = new FileSkillRegistry(path.resolve('skills'), dataDir, {
      getLanguage: async () => language,
      bundledPluginsDir: path.resolve('plugins'),
    });
    const context = await registry.resolvePromptContext();
    const metadata = context.availableSkills.find((skill) => skill.id === 'display-in-chat');
    expect(metadata).toBeDefined();
    expect(context.selectedInjections).toEqual([]);
    const skill = await registry.getSkill('display-in-chat');
    expect(skill?.kind).toBe('builtin');
    expect(skill?.enabled).toBe(true);
    expect(skill?.content.match(/^### /gm)).toHaveLength(80);
    const host = new SkillManagementToolHost(registry);
    let offset = 0;
    let complete = false;
    for (let chunk = 0; chunk < 10 && !complete; chunk += 1) {
      const input = { skill_id: 'display-in-chat', content_version: metadata!.contentVersion, offset };
      expect(await host.approvalForTool('read_skill', input)).toBeNull();
      const result = await host.runTool('read_skill', input);
      const data = result.data as { complete: boolean; nextOffset: number | null; totalCharacters: number };
      const end = data.nextOffset ?? data.totalCharacters;
      expect(end).toBeGreaterThan(offset);
      expect(result.content).toContain(skill!.content.slice(offset, end));
      offset = end;
      complete = data.complete;
    }
    expect(complete).toBe(true);
    expect(offset).toBe(skill!.content.length);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
