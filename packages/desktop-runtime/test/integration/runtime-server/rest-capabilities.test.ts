import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import {
  createImageGenerationCaptureServer,
  ONE_PIXEL_PNG_BASE64,
} from '../../support/runtime-server/rest-capabilities.js';

describe('runtime server REST skills and capabilities', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('lists and updates local skills', async () => {
      const list = await harness.runtimeFetch('/v1/skills');
      expect(list.skills.some((skill: { id: string }) => skill.id === 'create-skill-in-chat')).toBe(true);
  
      const updated = await harness.runtimeFetch('/v1/skills/create-skill-in-chat', {
        method: 'PATCH',
        body: JSON.stringify({ selected: true }),
      });
  
      expect(updated).toMatchObject({
        id: 'create-skill-in-chat',
        selected: true,
        enabled: true,
      });
    });
  
  it('lists the default marketplace and installs a selected plugin by id', async () => {
      const marketplace = await harness.runtimeFetch('/v1/plugin-marketplace');
      expect(marketplace).toMatchObject({
        errors: [],
        plugins: expect.arrayContaining([
          expect.objectContaining({
            id: 'openai-docs',
            name: 'OpenAI 官方文档',
            icon: 'openai-docs',
            featured: false,
            installed: false,
            skills: [expect.objectContaining({
              id: 'openai-docs.openai-docs',
              name: 'OpenAI 官方文档',
              description: expect.stringContaining('OpenAI'),
            })],
            mcpServers: [expect.objectContaining({
              key: 'openai_docs',
              label: 'OpenAI Developer Docs',
              transport: 'streamableHttp',
            })],
            capabilities: { skills: 1, mcpServers: 1, hooks: 0, resources: 0 },
          }),
          expect.objectContaining({
            id: 'context7-docs',
            name: 'Context7 文档查询',
            icon: 'context7',
            featured: false,
            installed: false,
          }),
          expect.objectContaining({
            id: 'pdf',
            name: 'PDF 文档处理',
            icon: 'pdf',
            featured: true,
            installed: false,
            skills: [expect.objectContaining({ id: 'pdf.pdf', name: 'pdf' })],
            mcpServers: [],
            capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
          }),
          expect.objectContaining({
            id: 'documents',
            name: 'Word 文档处理',
            icon: 'documents',
            featured: true,
            installed: false,
            skills: [expect.objectContaining({
              id: 'documents.documents',
              name: 'Word 文档处理',
              description: expect.stringContaining('DOCX'),
            })],
            mcpServers: [],
            resources: expect.arrayContaining([
              expect.objectContaining({ id: 'content-spec', path: path.join('skills', 'documents', 'references', 'content-spec.md') }),
              expect.objectContaining({ id: 'sample-document-spec', path: path.join('skills', 'documents', 'examples', 'sample-document.json') }),
            ]),
            capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 7 },
          }),
          expect.objectContaining({
            id: 'openai-image-generation',
            name: '图片生成',
            icon: 'image-generation',
            featured: true,
            installed: false,
            skills: [expect.objectContaining({
              id: 'openai-image-generation.image-generation',
              name: '图片生成',
            })],
            capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
          }),
          expect.objectContaining({
            id: 'guard-dangerous-shell',
            name: '阻止危险 Shell 命令',
            icon: 'guard-dangerous-shell',
            featured: false,
            installed: false,
            skills: [],
            mcpServers: [],
            hooks: [expect.objectContaining({
              id: 'guard-dangerous-shell',
              name: '阻止危险 Shell 命令',
              eventName: 'PreToolUse',
              matcher: 'run_shell_command|exec_command',
            })],
            capabilities: { skills: 0, mcpServers: 0, hooks: 1, resources: 0 },
          }),
        ]),
      });
      expect(marketplace.plugins.filter((plugin: { featured: boolean }) => plugin.featured).map((plugin: { id: string }) => plugin.id)).toEqual([
        'documents',
        'pdf',
        'openai-image-generation',
      ]);
      expect(JSON.stringify(marketplace)).not.toContain('{{pluginRoot}}');
      expect(JSON.stringify(marketplace)).not.toContain('.mjs');
  
      await expect(harness.runtimeFetch('/v1/plugin-marketplace/documents/items/skill/documents.documents')).resolves.toMatchObject({
        pluginId: 'documents',
        kind: 'skill',
        files: [expect.objectContaining({
          path: path.join('skills', 'documents', 'SKILL.md'),
          mimeType: 'text/markdown',
          text: expect.stringContaining('Word'),
        })],
      });
      await expect(harness.runtimeFetch('/v1/plugin-marketplace/documents/items/resource/sample-document-spec')).resolves.toMatchObject({
        pluginId: 'documents',
        kind: 'resource',
        files: [expect.objectContaining({
          path: path.join('skills', 'documents', 'examples', 'sample-document.json'),
          mimeType: 'application/json',
        })],
      });
      await expect(harness.runtimeFetch('/v1/plugin-marketplace/guard-dangerous-shell/items/hook/guard-dangerous-shell')).resolves.toMatchObject({
        pluginId: 'guard-dangerous-shell',
        kind: 'hook',
        files: [expect.objectContaining({
          path: path.join('hooks', 'guard-dangerous-shell.mjs'),
          mimeType: 'text/javascript',
          text: expect.stringContaining('process'),
        })],
      });
  
      const installed = await harness.runtimeFetch('/v1/plugin-marketplace/context7-docs/install', {
        method: 'POST',
      });
  
      expect(installed).toMatchObject({
        plugin: {
          id: 'context7-docs',
          skills: [{ id: 'context7-docs.context7-docs', name: 'Context7 文档查询' }],
        },
        installedMcpServers: ['context7'],
      });
      await expect(harness.runtimeFetch('/v1/mcp/servers')).resolves.toMatchObject({
        servers: [expect.objectContaining({
          key: 'context7',
          transport: 'streamableHttp',
          url: 'https://mcp.context7.com/mcp',
          enabled: true,
          requireApproval: 'prompt',
          trustLevel: 'untrusted',
        })],
      });
      await expect(harness.runtimeFetch('/v1/plugins')).resolves.toMatchObject({
        plugins: [expect.objectContaining({ id: 'context7-docs' })],
      });
      await expect(harness.runtimeFetch('/v1/plugins/context7-docs/items/skill/context7-docs.context7-docs')).resolves.toMatchObject({
        pluginId: 'context7-docs',
        kind: 'skill',
        files: [expect.objectContaining({ mimeType: 'text/markdown', text: expect.stringContaining('Context7') })],
      });
      await expect(harness.runtimeFetch('/v1/skills')).resolves.toMatchObject({
        skills: expect.arrayContaining([
          expect.objectContaining({
            id: 'context7-docs.context7-docs',
            kind: 'plugin',
            pluginId: 'context7-docs',
            mcpDependencies: [expect.objectContaining({ value: 'context7', status: 'ready' })],
          }),
        ]),
      });
  
      await expect(harness.runtimeFetch('/v1/plugins/context7-docs', { method: 'DELETE' })).resolves.toEqual({
        pluginId: 'context7-docs',
        removedMcpServers: ['context7'],
        preservedMcpServers: [],
      });
      await expect(harness.runtimeFetch('/v1/plugins')).resolves.toEqual({ plugins: [] });
      await expect(harness.runtimeFetch('/v1/plugin-marketplace')).resolves.toMatchObject({
        plugins: expect.arrayContaining([expect.objectContaining({ id: 'context7-docs', installed: false })]),
      });
  
      const installedHookPlugin = await harness.runtimeFetch('/v1/plugin-marketplace/guard-dangerous-shell/install', {
        method: 'POST',
      });
      expect(installedHookPlugin).toMatchObject({
        plugin: {
          id: 'guard-dangerous-shell',
          hooks: [expect.objectContaining({ id: 'guard-dangerous-shell', eventName: 'PreToolUse' })],
          hookCount: 1,
        },
      });
      await expect(harness.appServerRpc('hooks/list', { cwds: [] })).resolves.toMatchObject({
        data: [{
          hooks: [expect.objectContaining({
            pluginId: 'guard-dangerous-shell',
            source: 'plugin',
            eventName: 'preToolUse',
            trustStatus: 'trusted',
          })],
        }],
      });
      await expect(harness.runtimeFetch('/v1/plugins/guard-dangerous-shell', { method: 'DELETE' })).resolves.toMatchObject({
        pluginId: 'guard-dangerous-shell',
      });
      await expect(harness.appServerRpc('hooks/list', { cwds: [] })).resolves.toMatchObject({
        data: [{ hooks: [] }],
      });
    });
  
  it('updates an installed marketplace plugin through its id-only REST endpoint', async () => {
      await harness.runtimeFetch('/v1/plugin-marketplace/context7-docs/install', { method: 'POST' });
      const pluginIndexPath = path.join(harness.runtimeDataDir, 'runtime', 'plugins.json');
      const pluginIndex = JSON.parse(await readFile(pluginIndexPath, 'utf8')) as {
        plugins: Array<{ id: string; version?: string }>;
      };
      const context7Record = pluginIndex.plugins.find((plugin) => plugin.id === 'context7-docs');
      if (!context7Record) throw new Error('Expected the Context7 plugin to be installed');
      context7Record.version = '0.9.0';
      await writeFile(pluginIndexPath, JSON.stringify(pluginIndex, null, 2));
  
      await expect(harness.runtimeFetch('/v1/plugin-marketplace')).resolves.toMatchObject({
        plugins: expect.arrayContaining([expect.objectContaining({
          id: 'context7-docs',
          installedVersion: '0.9.0',
          updateAvailable: true,
        })]),
      });
      await expect(harness.runtimeFetch('/v1/plugin-marketplace/context7-docs/update', { method: 'POST' })).resolves.toMatchObject({
        plugin: { id: 'context7-docs', version: '1.0.0' },
      });
      await expect(harness.runtimeFetch('/v1/plugin-marketplace')).resolves.toMatchObject({
        plugins: expect.arrayContaining([expect.objectContaining({
          id: 'context7-docs',
          installedVersion: '1.0.0',
          updateAvailable: false,
        })]),
      });
    });
  
  it('does not expose local path side-loading through the renderer REST surface', async () => {
      const response = await fetch(`${harness.baseUrl}/v1/plugins`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${harness.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: '/tmp/plugin' }),
      });
  
      expect(response.status).toBe(404);
    });
  
  it('tests the installed image plugin through its configured private provider', async () => {
      const imageServer = await createImageGenerationCaptureServer();
      try {
        await harness.runtimeFetch('/v1/plugin-marketplace/openai-image-generation/install', { method: 'POST' });
        const savedConfig = await harness.runtimeFetch('/v1/config', {
          method: 'PUT',
          body: JSON.stringify({
            imageGeneration: {
              baseUrl: imageServer.baseUrl,
              model: 'test-image-model',
              apiKey: 'private-image-key',
            },
          }),
        });
        expect(savedConfig.imageGeneration).toMatchObject({
          baseUrl: imageServer.baseUrl,
          model: 'test-image-model',
          apiKeySet: true,
        });
        expect(JSON.stringify(savedConfig)).not.toContain('private-image-key');
  
        const result = await harness.runtimeFetch('/v1/plugins/openai-image-generation/test', {
          method: 'POST',
          body: JSON.stringify({ prompt: 'a tiny moon above a quiet lake' }),
        });
        expect(result).toMatchObject({
          images: [{
            source: 'generated',
            assetId: expect.stringMatching(/^generated_image_/u),
            type: 'image/png',
            modelVisible: false,
          }],
          durationMs: expect.any(Number),
          model: 'test-image-model',
        });
        expect(JSON.stringify(result)).not.toContain(ONE_PIXEL_PNG_BASE64);
        expect(JSON.stringify(result)).not.toContain('private-image-key');
        await expect(imageServer.nextRequest).resolves.toEqual({
          authorization: 'Bearer private-image-key',
          path: '/v1/images/generations',
          body: {
            prompt: 'a tiny moon above a quiet lake',
            model: 'test-image-model',
            n: 1,
          },
        });
      } finally {
        await imageServer.close();
      }
    });
  
  it('supports AppServer skills list, extra roots, and config writes', async () => {
      const stream = await harness.openAppServerNotificationStream();
      const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-skills-project-'));
      const extraRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-skills-extra-'));
      const extraSkillDir = path.join(extraRoot, 'appserver-extra');
      const extraSkillPath = path.join(extraSkillDir, 'SKILL.md');
      await mkdir(extraSkillDir, { recursive: true });
      await writeFile(
        extraSkillPath,
        [
          '---',
          'name: AppServer Extra',
          'description: Loaded through skills/extraRoots/set',
          '---',
          '',
          '# AppServer Extra',
          '',
          'Use the AppServer extra root.',
        ].join('\n'),
      );
  
      try {
        const initial = await harness.appServerRpc('skills/list', { cwds: [projectDir], forceReload: true });
        expect(initial).toMatchObject({
          data: [{
            cwd: projectDir,
            errors: [],
            skills: expect.arrayContaining([
              expect.objectContaining({
                name: '对话创建Skill',
                scope: 'system',
                enabled: true,
                path: expect.stringContaining(path.join('create-skill-in-chat', 'SKILL.md')),
              }),
            ]),
          }],
        });
  
        await expect(harness.appServerRpc('skills/extraRoots/set', { extraRoots: [extraRoot] })).resolves.toEqual({});
        await expect(stream.readNotification((notification) => notification.method === 'skills/changed', { timeoutMs: harness.eventStreamTimeoutMs }))
          .resolves.toMatchObject({ method: 'skills/changed', params: {} });
  
        const withExtraRoot = await harness.appServerRpc('skills/list', { cwds: [projectDir] });
        expect(withExtraRoot.data[0].skills).toEqual(expect.arrayContaining([
          expect.objectContaining({
            name: 'AppServer Extra',
            description: 'Loaded through skills/extraRoots/set',
            scope: 'user',
            enabled: true,
            path: extraSkillPath,
          }),
        ]));
  
        await expect(harness.appServerRpc('skills/config/write', {
          name: 'AppServer Extra',
          path: null,
          enabled: false,
        })).resolves.toEqual({ effectiveEnabled: false });
        await expect(stream.readNotification((notification) => notification.method === 'skills/changed', { timeoutMs: harness.eventStreamTimeoutMs }))
          .resolves.toMatchObject({ method: 'skills/changed', params: {} });
  
        await expect(harness.appServerRpc('skills/list', { cwds: [projectDir] })).resolves.toMatchObject({
          data: [{
            skills: expect.arrayContaining([
              expect.objectContaining({
                name: 'AppServer Extra',
                enabled: false,
              }),
            ]),
          }],
        });
  
        await expect(harness.appServerRpc('skills/config/write', {
          path: extraSkillPath,
          name: null,
          enabled: true,
        })).resolves.toEqual({ effectiveEnabled: true });
        await expect(stream.readNotification((notification) => notification.method === 'skills/changed', { timeoutMs: harness.eventStreamTimeoutMs }))
          .resolves.toMatchObject({ method: 'skills/changed', params: {} });
  
        await writeFile(
          extraSkillPath,
          [
            '---',
            'name: AppServer Extra',
            'description: Changed outside the AppServer RPC',
            '---',
            '',
            '# AppServer Extra',
            '',
            'Updated directly on disk.',
          ].join('\n'),
        );
        await expect(stream.readNotification((notification) => notification.method === 'skills/changed', { timeoutMs: harness.eventStreamTimeoutMs }))
          .resolves.toMatchObject({ method: 'skills/changed', params: {} });
        await expect(harness.appServerRpc('skills/list', { cwds: [projectDir] })).resolves.toMatchObject({
          data: [{
            skills: expect.arrayContaining([
              expect.objectContaining({
                name: 'AppServer Extra',
                description: 'Changed outside the AppServer RPC',
              }),
            ]),
          }],
        });
  
        await expect(harness.appServerRpcEnvelope({
          id: 'missing_skill_config',
          method: 'skills/config/write',
          params: { name: 'missing-skill', enabled: true },
        })).resolves.toMatchObject({
          id: 'missing_skill_config',
          error: {
            code: -32600,
            message: 'No matching skill found',
          },
        });
      } finally {
        await stream.close();
      }
    });
  
  it('supports AppServer hooks list discovery shape', async () => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'setsuna-appserver-hooks-project-'));
      const readConfig = await harness.appServerRpc('config/read', {});
      const configPath = readConfig.origins.hooks.name.file;
  
      await expect(harness.appServerRpc('config/batchWrite', {
        edits: [{
          keyPath: 'hooks',
          mergeStrategy: 'replace',
          value: {
            PreToolUse: [{
              matcher: 'Bash',
              hooks: [{
                type: 'command',
                command: 'python3 /tmp/listed-hook.py',
                timeout: 5,
                statusMessage: 'running listed hook',
              }],
            }],
          },
        }],
      })).resolves.toMatchObject({ status: 'ok' });
  
      const listed = await harness.appServerRpc('hooks/list', { cwds: [projectDir] });
      expect(listed).toMatchObject({
        data: [{
          cwd: projectDir,
          warnings: [],
          errors: [],
          hooks: [{
            key: `${configPath}:pre_tool_use:0:0`,
            eventName: 'preToolUse',
            handlerType: 'command',
            matcher: 'Bash',
            command: 'python3 /tmp/listed-hook.py',
            timeoutSec: 5,
            statusMessage: 'running listed hook',
            sourcePath: configPath,
            source: 'user',
            pluginId: null,
            displayOrder: 0,
            enabled: true,
            isManaged: false,
            currentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            trustStatus: 'untrusted',
          }],
        }],
      });
      const hook = listed.data[0].hooks[0];
  
      await expect(harness.appServerRpc('config/batchWrite', {
        edits: [{
          keyPath: 'hooks',
          mergeStrategy: 'replace',
          value: {
            PreToolUse: [{
              matcher: 'Bash',
              hooks: [{
                type: 'command',
                command: 'python3 /tmp/listed-hook.py',
                timeout: 5,
                statusMessage: 'running listed hook',
              }],
            }],
            state: {
              [hook.key]: {
                enabled: true,
                trusted_hash: hook.currentHash,
              },
            },
          },
        }],
      })).resolves.toMatchObject({ status: 'ok' });
  
      await expect(harness.appServerRpc('hooks/list', { cwds: [projectDir] })).resolves.toEqual({
        data: [{
          cwd: projectDir,
          hooks: [{
            ...hook,
            trustStatus: 'trusted',
          }],
          warnings: [],
          errors: [],
        }],
      });
  
      await expect(harness.appServerRpc('config/batchWrite', {
        edits: [{
          keyPath: 'features.hooks',
          value: false,
        }],
      })).resolves.toMatchObject({ status: 'ok' });
      await expect(harness.appServerRpc('hooks/list', { cwds: [] })).resolves.toEqual({
        data: [{
          cwd: process.cwd(),
          hooks: [],
          warnings: [],
          errors: [],
        }],
      });
      await expect(harness.appServerRpcEnvelope({
        id: 'invalid_hooks_cwds',
        method: 'hooks/list',
        params: { cwds: projectDir },
      })).resolves.toMatchObject({
        id: 'invalid_hooks_cwds',
        error: {
          code: -32602,
          message: 'cwds must be an array',
        },
      });
    });
});
