import type {
  RuntimeInlineMessageAttachment,
  RuntimeMessageAttachment,
  RuntimeStoredMessageAttachment,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesktopVisionRecognitionRuntimeHost } from '../../../src/adapters/feature/vision-recognition-runtime-host.js';
import { MAX_IN_MEMORY_RASTER_IMAGE_BYTES } from '../../../src/utils/safe-image.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DesktopVisionRecognitionRuntimeHost attachment boundary', () => {
  it('loads only safe linked and inline images referenced by the current thread', async () => {
    const fixture = await linkedImageFixture();
    const inline: RuntimeInlineMessageAttachment = {
      id: 'inline_image_1',
      name: 'inline.png',
      type: 'image/png',
      size: ONE_PIXEL_PNG.byteLength,
      source: 'inline',
      url: `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`,
    };
    let resolveCalls = 0;
    const host = runtimeHost(runtimeThread([fixture.attachment, inline]), {
      async resolveForThread() {
        resolveCalls += 1;
        return [{
          attachment: fixture.attachment,
          absolutePath: fixture.absolutePath,
          readableRoot: fixture.root,
        }];
      },
    });

    await expect(host.resolveImage('thread_1', fixture.attachment.assetId)).resolves.toEqual({
      id: fixture.attachment.assetId,
      name: 'diagram.png',
      mimeType: 'image/png',
      data: ONE_PIXEL_PNG,
    });
    await expect(host.resolveImage('thread_1', inline.id)).resolves.toEqual({
      id: inline.id,
      name: 'inline.png',
      mimeType: 'image/png',
      data: ONE_PIXEL_PNG,
    });
    await expect(host.resolveImage('thread_1', 'attachment_from_another_thread'))
      .rejects.toThrow('当前会话中没有可用的图片附件');
    expect(resolveCalls).toBe(1);
  });

  it('rejects an oversized linked image before reading it into memory', async () => {
    const fixture = await linkedImageFixture();
    const oversized = {
      ...fixture.attachment,
      size: MAX_IN_MEMORY_RASTER_IMAGE_BYTES + 1,
    };
    const host = runtimeHost(runtimeThread([oversized]), {
      async resolveForThread() {
        return [{
          attachment: oversized,
          absolutePath: fixture.absolutePath,
          readableRoot: fixture.root,
        }];
      },
    });

    await expect(host.resolveImage('thread_1', oversized.assetId)).rejects.toThrow('图片附件过大');
  });
});

async function linkedImageFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-vision-host-test-'));
  temporaryRoots.push(root);
  const absolutePath = path.join(root, 'diagram.png');
  await writeFile(absolutePath, ONE_PIXEL_PNG);
  const attachment: RuntimeStoredMessageAttachment = {
    id: 'attachment_message_1',
    name: 'diagram.png',
    type: 'image/png',
    size: ONE_PIXEL_PNG.byteLength,
    source: 'runtime',
    assetId: 'attachment_asset_1',
  };
  return { root, absolutePath, attachment };
}

function runtimeHost(
  thread: RuntimeThread,
  attachments: ConstructorParameters<typeof DesktopVisionRecognitionRuntimeHost>[0]['attachments'],
) {
  return new DesktopVisionRecognitionRuntimeHost({
    attachments,
    clock: { now: () => new Date('2026-08-08T01:02:03.000Z') },
    config: { async getConfig() { throw new Error('not used'); } },
    legacySettings: {
      async read() { return null; },
      async retire() {},
    },
    models: {
      async *stream() { yield { type: 'text_delta' as const, text: '' }; },
    },
    plugins: { async listInstalledRecords() { return []; } },
    threads: { async getThread(threadId) { return threadId === thread.id ? thread : null; } },
    usage: { async recordUsage(input) { return { id: 'usage_1', ...input }; } },
  });
}

function runtimeThread(attachments: RuntimeMessageAttachment[]): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Vision test',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    archived: false,
    messageCount: 1,
    lastMessagePreview: 'Analyze attachment',
    lastSeq: 0,
    messages: [{
      id: 'message_1',
      role: 'user',
      content: 'Analyze attachment',
      createdAt: '2026-08-08T00:00:00.000Z',
      attachments,
    }],
  };
}
