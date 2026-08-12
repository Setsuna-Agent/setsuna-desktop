import {
  OPENAI_IMAGE_GENERATION_PLUGIN_ID,
  OPENAI_IMAGE_GENERATION_TOOL_NAME,
  OPENAI_VISION_RECOGNITION_PLUGIN_ID,
  OPENAI_VISION_RECOGNITION_TOOL_NAME,
} from '@setsuna-desktop/contracts';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  inspectBundleTree,
  readPluginManifest,
  type ParsedPluginManifest,
} from '../../src/adapters/plugin/file-plugin-bundle-model.js';
import { ExtensionToolHost } from '../../src/adapters/tool/extension-tool-host.js';
import { ExtensionManager } from '../../src/extensions/extension-manager.js';
import type { InstalledPluginRecord } from '../../src/ports/plugin-bundle-store.js';
import type { ToolExecutionContext, ToolTurnCleanupOutcome } from '../../src/ports/tool-host.js';

describe('bundled media extensions', () => {
  it('keeps image generation tool behavior in the bundle and uses the host only for private assets', async () => {
    const root = path.resolve('plugins/openai-image-generation');
    const manifest = await readPluginManifest(root);
    expect(manifest.extension?.capabilities).toEqual(['tools', 'image-generation']);
    expect(manifest.tools).toEqual([expect.objectContaining({
      name: OPENAI_IMAGE_GENERATION_TOOL_NAME,
      exposure: 'direct',
      requiresApproval: false,
    })]);

    const generate = vi.fn(async () => ({
      attachments: [{
        id: 'generated_image_call_1_1',
        name: 'generated-1.png',
        type: 'image/png',
        size: 68,
        source: 'generated',
        assetId: 'generated_image_asset_1',
        modelVisible: false,
      }],
      workspaceFiles: [{ projectId: 'project_1', path: 'generated-images/call_1-1.png' }],
      revisedPrompts: ['a revised prompt'],
      model: 'gpt-image-1',
      size: '1024x1024',
    }));
    const cleanupTurn = vi.fn(async () => undefined);
    const manager = await extensionManager(root, {
      imageGeneration: {
        isAvailable: async () => true,
        generate,
        cleanupTurn,
      },
    });
    const host = new ExtensionToolHost(manager);
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolCallId: 'call_1',
      permissionProfile: 'workspace-write' as const,
      environment: {
        id: 'workspace.project_1',
        cwd: '/workspace',
        workspaceRoot: '/workspace',
        workspaceRoots: ['/workspace'],
      },
    };

    try {
      await expect(host.listTools(context)).resolves.toEqual([
        expect.objectContaining({ name: OPENAI_IMAGE_GENERATION_TOOL_NAME }),
      ]);
      await expect(host.runTool(OPENAI_IMAGE_GENERATION_TOOL_NAME, {
        prompt: 'a moon above a lake',
        n: 1,
        size: '1024x1024',
      }, context)).resolves.toMatchObject({
        content: expect.stringContaining('Workspace files ready for publish_artifact'),
        attachments: [{ source: 'generated', assetId: 'generated_image_asset_1' }],
        preview: '已生成 1 张图片',
        data: {
          pluginId: OPENAI_IMAGE_GENERATION_PLUGIN_ID,
          imageCount: 1,
          model: 'gpt-image-1',
          size: '1024x1024',
        },
        containsExternalContext: true,
      });
      expect(generate).toHaveBeenCalledWith({
        prompt: 'a moon above a lake',
        n: 1,
        size: '1024x1024',
      }, expect.objectContaining({
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCallId: 'call_1',
        permissionProfile: 'workspace-write',
      }));
      await host.cleanupTurn(context, { status: 'completed' });
      expect(cleanupTurn).toHaveBeenCalledWith(context, { status: 'completed' });
    } finally {
      await manager.shutdown();
    }
  });

  it('keeps vision tool behavior in the bundle and passes only attachment ids to the host bridge', async () => {
    const root = path.resolve('plugins/openai-vision-recognition');
    const manifest = await readPluginManifest(root);
    expect(manifest.extension?.capabilities).toEqual(['tools', 'vision-recognition']);
    expect(manifest.tools).toEqual([expect.objectContaining({
      name: OPENAI_VISION_RECOGNITION_TOOL_NAME,
      exposure: 'direct',
      requiresApproval: false,
    })]);

    const analyze = vi.fn(async () => ({
      content: 'The screenshot contains a settings dialog.',
      attachmentId: 'attachment_asset_1',
      attachmentName: 'settings.png',
      providerId: 'vision-provider',
      modelId: 'vision-model',
      model: 'qwen-vl-max',
    }));
    const manager = await extensionManager(root, {
      visionRecognition: {
        isAvailable: async () => true,
        analyze,
      },
    });
    const host = new ExtensionToolHost(manager);
    const context = { threadId: 'thread_1', turnId: 'turn_1', toolCallId: 'call_1' };

    try {
      await expect(host.listTools(context)).resolves.toEqual([
        expect.objectContaining({ name: OPENAI_VISION_RECOGNITION_TOOL_NAME }),
      ]);
      await expect(host.runTool(OPENAI_VISION_RECOGNITION_TOOL_NAME, {
        attachment_id: 'attachment_asset_1',
        prompt: 'Describe the dialog.',
      }, context)).resolves.toMatchObject({
        content: 'Vision model analysis for settings.png:\nThe screenshot contains a settings dialog.',
        preview: 'The screenshot contains a settings dialog.',
        data: {
          pluginId: OPENAI_VISION_RECOGNITION_PLUGIN_ID,
          attachmentId: 'attachment_asset_1',
          model: 'qwen-vl-max',
        },
        containsExternalContext: true,
      });
      expect(analyze).toHaveBeenCalledWith({
        attachment_id: 'attachment_asset_1',
        prompt: 'Describe the dialog.',
      }, expect.objectContaining({ threadId: 'thread_1', turnId: 'turn_1' }));
    } finally {
      await manager.shutdown();
    }
  });
});

async function extensionManager(
  root: string,
  bridges: {
    imageGeneration?: {
      isAvailable(): Promise<boolean>;
      generate(input: unknown, context: ToolExecutionContext): Promise<unknown>;
      cleanupTurn(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome): Promise<void>;
    };
    visionRecognition?: {
      isAvailable(): Promise<boolean>;
      analyze(input: unknown, context: ToolExecutionContext): Promise<unknown>;
    };
  },
): Promise<ExtensionManager> {
  const manifest = await readPluginManifest(root);
  const record = await installedRecord(root, manifest);
  return new ExtensionManager(
    { listInstalledRecords: async () => [structuredClone(record)] },
    {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
    },
    { handle: async () => null },
    {
      ...bridges,
      workerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
      workerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
      toolTimeoutMs: 2_000,
    },
  );
}

async function installedRecord(
  root: string,
  manifest: ParsedPluginManifest,
): Promise<InstalledPluginRecord> {
  const { bundleHash } = await inspectBundleTree(root);
  return {
    id: manifest.id,
    name: manifest.name,
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    ...(manifest.version ? { version: manifest.version } : {}),
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(manifest.publisher ? { publisher: manifest.publisher } : {}),
    tags: [...manifest.tags],
    tools: manifest.tools.map((tool) => ({ ...tool })),
    installedAt: '2026-08-12T00:00:00.000Z',
    installationSource: 'marketplace',
    sourcePath: root,
    installPath: root,
    manifestPath: manifest.manifestPath,
    skills: [],
    skillEntries: [],
    mcpServers: [],
    mcpServerInputs: [],
    hooks: [],
    hookCount: 0,
    resources: [],
    extension: {
      ...manifest.extension!,
      capabilities: [...manifest.extension!.capabilities],
      entry: manifest.extension!.entry,
      bundleHash,
      trustedHash: bundleHash,
    },
  };
}
