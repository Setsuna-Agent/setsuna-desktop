import { RUNTIME_LOCAL_PLUGIN_INSTALL_PATH } from '@setsuna-desktop/contracts';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import {
  createImageGenerationCaptureServer,
  createVisionRecognitionCaptureServer,
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
      expect(list.skills.some((skill: { id: string }) => skill.id === 'create-plugin-in-chat')).toBe(true);
  
      const updated = await harness.runtimeFetch('/v1/skills/create-skill-in-chat', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      });
  
      expect(updated).toMatchObject({
        id: 'create-skill-in-chat',
        enabled: false,
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
            id: 'question',
            name: '结构化提问',
            icon: 'question',
            publisher: 'Setsuna',
            tags: expect.arrayContaining(['交互', '工具']),
            tools: [expect.objectContaining({ name: 'question' })],
            resources: [],
            extension: { apiVersion: 1, runtime: 'node-worker', capabilities: ['tools', 'ui'] },
            capabilities: { extension: 1, tools: 1, skills: 0, mcpServers: 0, hooks: 0, resources: 0 },
            installed: false,
          }),
          expect.objectContaining({
            id: 'todo',
            name: '任务清单',
            icon: 'todo',
            publisher: 'Setsuna',
            tags: expect.arrayContaining(['任务', '状态']),
            tools: [expect.objectContaining({ name: 'todo' })],
            extension: { apiVersion: 1, runtime: 'node-worker', capabilities: ['tools', 'state'] },
            installed: false,
          }),
          expect.objectContaining({
            id: 'claude-rules',
            name: 'Claude Rules 兼容',
            icon: 'claude-rules',
            publisher: 'Setsuna',
            tags: expect.arrayContaining(['Claude', '项目规则']),
            extension: { apiVersion: 1, runtime: 'node-worker', capabilities: ['events'] },
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
            tools: [expect.objectContaining({ name: 'generate_image' })],
            extension: {
              apiVersion: 1,
              runtime: 'node-worker',
              capabilities: ['tools', 'image-generation'],
            },
            capabilities: {
              extension: 1,
              tools: 1,
              skills: 1,
              mcpServers: 0,
              hooks: 0,
              resources: 0,
            },
          }),
          expect.objectContaining({
            id: 'openai-vision-recognition',
            name: '视觉识别',
            icon: 'vision-recognition',
            featured: true,
            installed: false,
            skills: [expect.objectContaining({
              id: 'openai-vision-recognition.vision-recognition',
              name: '视觉识别',
            })],
            tools: [expect.objectContaining({
              name: 'analyze_image',
              description: expect.stringContaining('视觉模型'),
            })],
            extension: {
              apiVersion: 1,
              runtime: 'node-worker',
              capabilities: ['tools', 'vision-recognition'],
            },
            capabilities: {
              extension: 1,
              tools: 1,
              skills: 1,
              mcpServers: 0,
              hooks: 0,
              resources: 0,
            },
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
        'openai-vision-recognition',
        'web-search',
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
      await expect(harness.appServerRpc('skills/list', { cwds: [process.cwd()] })).resolves.toMatchObject({
        data: [{
          skills: expect.arrayContaining([
            expect.objectContaining({
              name: 'Context7 文档查询',
              scope: 'user',
            }),
          ]),
        }],
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

      await expect(harness.runtimeFetch('/v1/plugin-marketplace/question/install', {
        method: 'POST',
      })).resolves.toMatchObject({
        plugin: {
          id: 'question',
          extension: { trust: 'trusted' },
        },
      });
      await expect(harness.runtimeFetch('/v1/plugins/question', { method: 'DELETE' })).resolves.toMatchObject({
        pluginId: 'question',
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
        plugin: { id: 'context7-docs', version: '1.0.1' },
      });
      await expect(harness.runtimeFetch('/v1/plugin-marketplace')).resolves.toMatchObject({
        plugins: expect.arrayContaining([expect.objectContaining({
          id: 'context7-docs',
          installedVersion: '1.0.1',
          updateAvailable: false,
        })]),
      });
    });

  it('installs a main-selected local extension through the internal runtime endpoint', async () => {
      const bundleDir = path.join(harness.runtimeDataDir, 'local-extension-source');
      await Promise.all([
        mkdir(path.join(bundleDir, '.setsuna-plugin'), { recursive: true }),
        mkdir(path.join(bundleDir, 'extension'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(bundleDir, 'extension', 'entry.mjs'), 'export default () => {};\n'),
        writeFile(path.join(bundleDir, '.setsuna-plugin', 'plugin.json'), JSON.stringify({
          schemaVersion: 2,
          id: 'local-extension',
          name: 'Local Extension',
          version: '1.0.0',
          extension: {
            apiVersion: 1,
            runtime: 'node-worker',
            entry: 'extension/entry.mjs',
            capabilities: ['tools'],
          },
        }, null, 2)),
      ]);

      await expect(harness.runtimeFetch(RUNTIME_LOCAL_PLUGIN_INSTALL_PATH, {
        method: 'POST',
        body: JSON.stringify({ path: bundleDir }),
      })).resolves.toMatchObject({
        plugin: {
          id: 'local-extension',
          extension: { trust: 'untrusted' },
        },
      });
      await expect(harness.runtimeFetch('/v1/plugins')).resolves.toMatchObject({
        plugins: [expect.objectContaining({ id: 'local-extension' })],
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

  it('does not run the vision Feature test when its marketplace plugin is not installed', async () => {
      const response = await fetch(`${harness.baseUrl}/v1/features/vision-recognition/test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${harness.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: 'quick test' }),
      });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: 'PLUGIN_NOT_INSTALLED' });
    });
  
  it('tests the installed image plugin through its configured private provider', async () => {
      const imageServer = await createImageGenerationCaptureServer();
      try {
        await harness.runtimeFetch('/v1/plugin-marketplace/openai-image-generation/install', { method: 'POST' });
        const savedConfig = await harness.runtimeFetch('/v1/features/image-generation/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            expectedRevision: 1,
            patch: {
              baseUrl: imageServer.baseUrl,
              model: 'test-image-model',
            },
            secretPatch: { apiKey: 'private-image-key' },
          }),
        });
        expect(savedConfig.value).toMatchObject({
          baseUrl: imageServer.baseUrl,
          model: 'test-image-model',
          apiKeySet: true,
        });
        expect(JSON.stringify(savedConfig)).not.toContain('private-image-key');
  
        const result = await harness.runtimeFetch('/v1/features/image-generation/test', {
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

  it('keeps image settings and test operations reachable while the Feature is degraded', async () => {
      const initialStatus = await harness.runtimeFetch('/v1/feature-management/status');
      expect(initialStatus.features).toContainEqual(expect.objectContaining({
        featureId: 'image-generation',
        status: 'degraded',
      }));

      const initial = await harness.runtimeFetch('/v1/features/image-generation/settings');
      expect(initial).toMatchObject({
        value: { apiKeySet: false },
        health: 'not-configured',
        revision: expect.any(Number),
      });

      const updated = await harness.runtimeFetch('/v1/features/image-generation/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          expectedRevision: initial.revision,
          patch: { baseUrl: 'https://images.invalid/v1', model: 'fixture-image-model' },
        }),
      });
      expect(updated).toMatchObject({
        value: {
          baseUrl: 'https://images.invalid/v1',
          model: 'fixture-image-model',
        },
        health: 'credentials-missing',
      });

      await expect(harness.runtimeFetch('/v1/features/image-generation/test', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'a small paper moon' }),
      })).rejects.toThrow('CREDENTIALS_MISSING');

      const degradedStatus = await harness.runtimeFetch('/v1/feature-management/status');
      expect(degradedStatus.features).toContainEqual(expect.objectContaining({
        featureId: 'image-generation',
        status: 'degraded',
      }));
    });

  it('tests the installed vision plugin through a selected configured model', async () => {
      const visionServer = await createVisionRecognitionCaptureServer();
      try {
        const installed = await harness.runtimeFetch('/v1/plugin-marketplace/openai-vision-recognition/install', { method: 'POST' });
        expect(installed).toMatchObject({
          plugin: { tools: [{ name: 'analyze_image' }] },
        });
        const savedConfig = await harness.runtimeFetch('/v1/config', {
          method: 'PUT',
          body: JSON.stringify({
            providers: [{
              id: 'vision-provider',
              name: 'Configured vision provider',
              provider: 'openai-compatible',
              baseUrl: `${visionServer.baseUrl}/v1`,
              enabled: true,
              apiKey: 'private-vision-key',
              models: [{
                id: 'vision-model',
                name: 'Test vision model',
                code: 'test-vision-model',
                enabled: true,
                maxOutputTokens: 8_192,
                thinkingEnabled: false,
                thinkingEfforts: [],
                supportsImages: true,
              }],
            }],
          }),
        });
        expect(savedConfig).not.toHaveProperty('visionRecognition');
        expect(savedConfig.providers).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 'vision-provider', apiKeySet: true }),
        ]));
        expect(JSON.stringify(savedConfig)).not.toContain('private-vision-key');

        const initialSettings = await harness.runtimeFetch('/v1/features/vision-recognition/settings');
        expect(initialSettings).toMatchObject({
          selection: null,
          health: 'not-configured',
          revision: expect.any(Number),
        });
        const updatedSettings = await harness.runtimeFetch('/v1/features/vision-recognition/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            expectedRevision: initialSettings.revision,
            selection: { providerId: 'vision-provider', modelId: 'vision-model' },
          }),
        });
        expect(updatedSettings).toMatchObject({
          selection: { providerId: 'vision-provider', modelId: 'vision-model' },
          health: 'ready',
          availableModels: [expect.objectContaining({
            providerId: 'vision-provider',
            modelId: 'vision-model',
          })],
        });

        const result = await harness.runtimeFetch('/v1/features/vision-recognition/test', {
          method: 'POST',
          body: JSON.stringify({ prompt: 'Describe the test image.' }),
        });
        expect(result).toMatchObject({
          content: 'The test image was received.',
          durationMs: expect.any(Number),
          model: 'test-vision-model',
        });
        expect(JSON.stringify(result)).not.toContain(ONE_PIXEL_PNG_BASE64);
        expect(JSON.stringify(result)).not.toContain('private-vision-key');
        const request = await visionServer.nextRequest;
        expect(request.authorization).toBe('Bearer private-vision-key');
        expect(request.path).toBe('/v1/chat/completions');
        expect(request.body).toMatchObject({
          model: 'test-vision-model',
          stream: true,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Describe the test image.' },
              { type: 'image_url' },
            ],
          }],
        });
      } finally {
        await visionServer.close();
      }
    });
  
  it('shares skill extra roots across REST and AppServer configuration views', async () => {
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
  
        await expect(harness.runtimeFetch('/v1/skills/extra-roots', {
          method: 'PUT',
          body: JSON.stringify({ extraRoots: [extraRoot] }),
        })).resolves.toEqual({ ok: true });
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
  
  it('shares hook discovery across REST and AppServer views', async () => {
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
  
      const listed = await harness.runtimeFetch(`/v1/hooks?cwd=${encodeURIComponent(projectDir)}`);
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
