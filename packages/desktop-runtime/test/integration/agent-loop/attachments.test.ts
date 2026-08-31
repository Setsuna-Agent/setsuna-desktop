import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserControlPort } from '@setsuna-desktop/feature-browser/contracts';
import { BrowserRuntimeTools } from '@setsuna-desktop/feature-browser/runtime';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { ImageAssetResolvingModelClient } from '../../../src/adapters/model/image-asset-resolving-model-client.js';
import { FileGeneratedImageStore } from '../../../src/adapters/store/file-generated-image-store.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { BrowserToolHost } from '../../../src/adapters/tool/browser-tool-host.js';
import { WorkspaceImageToolHost } from '../../../src/adapters/tool/workspace-image-tool-host.js';
import { FileWorkspaceProjectStore } from '../../../src/adapters/workspace/file-workspace-project-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import type { AttachmentStore } from '../../../src/ports/attachment-store.js';
import { systemClock } from '../../../src/ports/clock.js';
import { type ToolExecutionContext, type ToolHost } from '../../../src/ports/tool-host.js';
import {
  BrowserScreenshotModelClient,
  ImageCapabilityConfigStore,
  ReasoningModelClient,
} from '../../support/agent-loop/attachments.js';
import {
  mkDataDir,
  SingleToolCallModelClient,
  ToolCallingModelClient
} from '../../support/agent-loop/shared.js';

describe('agent loop reasoning and attachments', () => {
  it('keeps attachment read grants out of shell sandbox permissions', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Attachment read boundary' });
      const attachment = {
        id: 'attachment_message_1',
        assetId: 'attachment_asset_1',
        name: 'private-notes.txt',
        type: 'text/plain',
        size: 7,
        source: 'runtime' as const,
      };
      const attachmentPath = path.join(await mkDataDir(), 'private-notes.txt');
      const contexts: ToolExecutionContext[] = [];
      const attachmentStore: AttachmentStore = {
        async recover() {},
        async link() { throw new Error('unused'); },
        async create() { throw new Error('unused'); },
        async deletePending() { return false; },
        async claimForThread(_threadId, attachments) { return attachments; },
        async retainForThread() {},
        async releaseThread() {},
        async resolveForThread() {
          return [{ attachment, absolutePath: attachmentPath, readableRoot: attachmentPath }];
        },
      };
      const toolHost: ToolHost = {
        async listTools(context) {
          contexts.push(context);
          return [];
        },
        async runTool() { throw new Error('unused'); },
      };
      const loop = new AgentLoop({
        threadStore,
        attachmentStore,
        modelClient: new ReasoningModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });

      await loop.sendTurn(thread.id, { input: 'Read the attachment.', attachments: [attachment] });

      expect(contexts[0]?.directToolReadableRoots).toEqual([attachmentPath]);
      expect(contexts[0]?.sandboxWorkspaceWrite?.readableRoots ?? []).not.toContain(attachmentPath);
    });

  it('passes per-turn thinking options and stores reasoning deltas', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Thinking loop' });
      const modelClient = new ReasoningModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });
  
      await loop.sendTurn(thread.id, { input: 'think first', thinking: true, thinkingEffort: 'max' });
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id);
      const assistant = saved?.messages.find((message) => message.role === 'assistant');
      const agentItemStarted = events.find((event) => event.type === 'item.started'
        && event.payload.item.kind === 'agent_message'
        && event.payload.item.transcriptMessageId === assistant?.id);
      const reasoningItemStarted = events.find((event) => event.type === 'item.started'
        && event.payload.item.kind === 'reasoning'
        && event.payload.item.transcriptMessageId === assistant?.id);
  
      expect(modelClient.requests[0]).toMatchObject({ thinking: true, reasoningEffort: 'max' });
      expect(assistant?.content).toBe('answer');
      expect(assistant?.streamParts).toEqual([
        { type: 'reasoning', content: 'plan' },
        { type: 'content', content: 'answer' },
      ]);
      expect(agentItemStarted).toBeTruthy();
      expect(reasoningItemStarted).toBeTruthy();
      expect(events).toContainEqual(expect.objectContaining({
        type: 'reasoning.raw_delta',
        payload: expect.objectContaining({ itemId: `${assistant?.id}:reasoning`, delta: 'plan' }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'item.delta',
        payload: { itemId: assistant?.id, delta: 'answer' },
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'token.count',
        payload: { usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      }));
    });
  
  it('rejects image attachments when the active model does not support image input', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Image support' });
      const modelClient = new ToolCallingModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        configStore: new ImageCapabilityConfigStore(false),
      });
  
      await expect(loop.sendTurn(thread.id, {
        input: 'look at this',
        attachments: [
          {
            id: 'image_1',
            name: 'diagram.png',
            type: 'image/png',
            size: 12,
            url: 'data:image/png;base64,aW1hZ2U=',
          },
        ],
      })).rejects.toThrow('当前模型未启用图片输入。');
  
      expect(modelClient.requests).toHaveLength(0);
    });
  
  it('advertises browser screenshots and returns them as image tool attachments for vision models', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Browser screenshot vision' });
      const modelClient = new BrowserScreenshotModelClient();
      const browserControl: BrowserControlPort = {
        async execute(command) {
          if (command.kind !== 'screenshot') throw new Error(`Unexpected browser command: ${command.kind}`);
          return {
            dataUrl: 'data:image/png;base64,aW1hZ2U=',
            height: 720,
            kind: 'screenshot',
            mimeType: 'image/png',
            size: 5,
            tabId: 'tab-1',
            title: 'Example',
            url: 'https://example.com/',
            width: 1280,
          };
        },
      };
      const browserToolHost = new BrowserToolHost();
      browserToolHost.bind(new BrowserRuntimeTools(browserControl));
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        configStore: new ImageCapabilityConfigStore(true),
        toolHost: browserToolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'inspect the visible page' });
      const saved = await threadStore.getThread(thread.id);
      const sampledScreenshot = modelClient.requests[1]?.messages.find((message) =>
        message.role === 'tool' && message.toolName === 'browser_screenshot');
  
      expect(modelClient.requests[0]?.tools?.map((tool) => tool.name)).toContain('browser_screenshot');
      expect(sampledScreenshot?.attachments).toEqual([
        expect.objectContaining({
          size: 5,
          type: 'image/png',
          url: 'data:image/png;base64,aW1hZ2U=',
        }),
      ]);
      expect(saved?.messages.find((message) => message.toolName === 'browser_screenshot')?.attachments)
        .toEqual(sampledScreenshot?.attachments);
    });
  
  it('loads workspace images and sends them back to vision models as tool attachments', async () => {
      const dataDir = await mkDataDir();
      const projectDir = path.join(dataDir, 'project');
      mkdirSync(projectDir, { recursive: true });
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      );
      writeFileSync(path.join(projectDir, 'design.png'), png);
      const projects = new FileWorkspaceProjectStore(path.join(dataDir, 'workspace-state'), systemClock);
      const project = await projects.addProject({ path: projectDir });
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(path.join(dataDir, 'thread-state'), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Workspace image vision', projectId: project.id });
      const capturedModelClient = new SingleToolCallModelClient({
        id: 'call_view_image',
        name: 'view_image',
        arguments: JSON.stringify({ path: 'design.png' }),
      });
      const imageStore = new FileGeneratedImageStore(path.join(dataDir, 'image-assets'), ids);
      const modelClient = new ImageAssetResolvingModelClient(capturedModelClient, imageStore);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        imageStore,
        configStore: new ImageCapabilityConfigStore(true),
        toolHost: new WorkspaceImageToolHost(projects),
      });
  
      await loop.sendTurn(thread.id, { input: 'inspect the design asset' });
      const sampledImage = capturedModelClient.requests[1]?.messages.find((message) =>
        message.role === 'tool' && message.toolName === 'view_image');
      const saved = await threadStore.getThread(thread.id);
  
      expect(capturedModelClient.requests[0]?.tools?.map((tool) => tool.name)).toContain('view_image');
      expect(sampledImage?.attachments).toEqual([
        expect.objectContaining({
          name: 'design.png',
          size: png.byteLength,
          type: 'image/png',
          url: `data:image/png;base64,${png.toString('base64')}`,
        }),
      ]);
      expect(saved?.messages.find((message) => message.toolName === 'view_image')?.attachments).toEqual([
        expect.objectContaining({
          name: 'design.png',
          size: png.byteLength,
          type: 'image/png',
          source: 'generated',
          assetId: expect.any(String),
          modelVisible: true,
        }),
      ]);
      expect(JSON.stringify(saved)).not.toContain(png.toString('base64'));
    });
  
  it('publishes only one terminal event when tool attachment externalization fails', async () => {
      const dataDir = await mkDataDir();
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(path.join(dataDir, 'threads'), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Invalid tool attachment' });
      const toolHost: ToolHost = {
        listTools: async () => [{
          name: 'invalid_image_tool',
          description: 'Return a deliberately invalid test image.',
          inputSchema: { type: 'object', properties: {} },
        }],
        runTool: async () => ({
          content: 'image generation side effect completed',
          attachments: [{
            id: 'invalid_image',
            name: 'invalid.png',
            type: 'image/png',
            size: 3,
            url: 'data:image/png;base64,not-valid-base64!',
          }],
        }),
      };
      const loop = new AgentLoop({
        threadStore,
        modelClient: new SingleToolCallModelClient({
          id: 'call_invalid_image',
          name: 'invalid_image_tool',
          arguments: '{}',
        }),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        imageStore: new FileGeneratedImageStore(path.join(dataDir, 'images'), ids),
        toolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'run the invalid image tool' });
      const events = await threadStore.listEvents(thread.id, 0);
      const terminalEvents = events.filter((event) =>
        event.type === 'tool.completed' && event.payload.toolCallId === 'call_invalid_image');
  
      expect(terminalEvents).toHaveLength(1);
      expect(terminalEvents[0]).toMatchObject({
        payload: {
          status: 'error',
          content: expect.stringContaining('valid Base64'),
        },
      });
    });
});
