import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLISH_ARTIFACT_TOOL_NAME } from '@setsuna-desktop/contracts';
import { createRuntimeFactory } from './runtime-factory.js';

describe('runtime factory tool wiring', () => {
  it('uses the same skill registry for chat tool creation and capability form APIs', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-factory-test-'));
    const runtime = createRuntimeFactory({ dataDir });
    const context = { threadId: 'thread_1', turnId: 'turn_1' };

    const tools = await runtime.toolHost.listTools(context);
    expect(tools.filter((tool) => tool.name === 'configure_skill')).toHaveLength(1);
    expect(tools.filter((tool) => tool.name === 'open_browser')).toHaveLength(1);
    expect(tools.filter((tool) => tool.name === 'request_user_input')).toHaveLength(1);
    expect(tools.filter((tool) => tool.name === PUBLISH_ARTIFACT_TOOL_NAME)).toHaveLength(1);
    await expect(runtime.toolHost.systemPrompt?.(context, { tools })).resolves.toContain('call publish_artifact once');
    await expect(runtime.toolHost.toolRuntimeProfile?.('request_user_input', context)).resolves.toMatchObject({
      approvalMode: 'selfManaged',
      supportsParallel: false,
    });

    await expect(runtime.toolHost.runTool('open_browser', { url: 'https://www.baidu.com' }, context)).resolves.toMatchObject({
      data: { kind: 'browser.open', url: 'https://www.baidu.com/' },
    });

    const created = await runtime.toolHost.runTool('configure_skill', {
      name: 'Factory Skill',
      description: 'Created through the chat Skill tool.',
      content: '# Factory Skill\n\nUse this from the shared runtime registry.',
      selected: true,
    }, context);

    expect(created.content).toContain('Skill configured: Factory Skill');
    await expect(runtime.skillRegistry.listSkills()).resolves.toMatchObject({
      skills: expect.arrayContaining([
        expect.objectContaining({
          id: 'factory-skill',
          name: 'Factory Skill',
          kind: 'user',
          enabled: true,
          selected: true,
        }),
      ]),
    });

    const updated = await runtime.skillRegistry.updateSkill('factory-skill', {
      name: 'Factory Skill Updated',
      content: '# Factory Skill Updated\n\nUpdated through the capability form registry.',
      selected: false,
    });

    expect(updated).toMatchObject({
      id: 'factory-skill',
      name: 'Factory Skill Updated',
      selected: false,
      content: expect.stringContaining('capability form registry'),
    });
    await expect(runtime.toolHost.previewToolCall?.('configure_skill', {
      id: 'factory-skill',
      name: 'Factory Skill Updated',
      content: '# Factory Skill Updated\n\nPreview existing skill.',
    }, context)).resolves.toMatchObject({
      resultPreview: expect.stringContaining('"action":"update"'),
    });
  });
});
