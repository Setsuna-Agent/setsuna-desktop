import { access, mkdir, readFile, realpath, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileAttachmentStore } from '../../../src/adapters/store/file-attachment-store.js';
import { RuntimeAttachmentValidationError } from '../../../src/ports/attachment-store.js';
import type { Clock } from '../../../src/ports/clock.js';
import type { IdGenerator } from '../../../src/ports/id-generator.js';
import { createTestTempDirectory } from '../../support/test-temp-directory.js';

describe('file attachment store', () => {
  it('links a local file in place without copying it into attachment storage', async () => {
    const fixture = await attachmentStoreFixture();
    const sourceDirectory = path.join(fixture.dataDir, 'user-files');
    const sourcePath = path.join(sourceDirectory, 'large-notes.txt');
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(sourcePath, 'local source');
    await truncate(sourcePath, 24 * 1024 * 1024);

    const attachment = await fixture.store.link({ path: sourcePath, type: 'text/plain' });
    expect(attachment).toMatchObject({
      source: 'runtime',
      name: 'large-notes.txt',
      type: 'text/plain',
      size: 24 * 1024 * 1024,
    });
    await expect(access(path.join(
      fixture.dataDir,
      'attachments',
      'files',
      attachment.assetId,
    ))).rejects.toThrow();

    await fixture.store.claimForThread('thread_1', [attachment]);
    const reloadedStore = new FileAttachmentStore(fixture.dataDir, fixture.clock, new SequentialIdGenerator());
    const [resolved] = await reloadedStore.resolveForThread('thread_1', [attachment]);
    const canonicalSourcePath = await realpath(sourcePath);
    expect(resolved).toMatchObject({
      absolutePath: canonicalSourcePath,
      readableRoot: canonicalSourcePath,
    });

    await reloadedStore.releaseThread('thread_1');
    await expect(access(sourcePath)).resolves.toBeUndefined();
  });

  it('claims uploaded documents for a thread and keeps fork references until the last thread is released', async () => {
    const fixture = await attachmentStoreFixture();
    const bytes = Buffer.from('%PDF-1.7\nattachment body');
    const attachment = await fixture.store.create({
      name: '../Quarterly Report.pdf',
      type: 'application/pdf',
      data: bytes,
    });

    expect(attachment).toEqual({
      id: 'attachment_1',
      assetId: 'attachment_1',
      source: 'runtime',
      name: 'Quarterly Report.pdf',
      type: 'application/pdf',
      size: bytes.byteLength,
    });
    expect(await fixture.store.resolveForThread('thread_1', [attachment])).toEqual([]);

    await fixture.store.claimForThread('thread_1', [attachment]);
    const [resolved] = await fixture.store.resolveForThread('thread_1', [attachment]);
    expect(resolved?.absolutePath).toBe(path.join(fixture.dataDir, 'attachments', 'files', 'attachment_1', 'Quarterly Report.pdf'));
    await expect(readFile(resolved!.absolutePath)).resolves.toEqual(bytes);
    await expect(fixture.store.deletePending(attachment.assetId)).resolves.toBe(false);

    await fixture.store.retainForThread('thread_2', [attachment]);
    await fixture.store.releaseThread('thread_1');
    await expect(fixture.store.resolveForThread('thread_2', [attachment])).resolves.toHaveLength(1);

    await fixture.store.releaseThread('thread_2');
    await expect(access(resolved!.absolutePath)).rejects.toThrow();
  });

  it('rejects invalid content and attachment metadata tampering', async () => {
    const { store } = await attachmentStoreFixture();

    await expect(store.create({
      name: 'not-really.pdf',
      type: 'application/pdf',
      data: new Uint8Array([1, 2, 3]),
    })).rejects.toMatchObject({ code: 'attachment_unsupported' } satisfies Partial<RuntimeAttachmentValidationError>);

    const attachment = await store.create({
      name: 'valid.pdf',
      type: '',
      data: Buffer.from('%PDF-1.4\nvalid'),
    });
    await expect(store.claimForThread('thread_1', [{ ...attachment, name: 'renamed.pdf' }]))
      .rejects.toThrow('Attachment is unavailable or invalid');
  });

  it('stores signature-validated raster images as read-only thread attachments', async () => {
    const fixture = await attachmentStoreFixture();
    const bytes = pngBytes();
    const attachment = await fixture.store.create({
      name: '../Diagram.PNG',
      type: 'image/png',
      data: bytes,
    });

    expect(attachment).toMatchObject({
      source: 'runtime',
      name: 'Diagram.PNG',
      type: 'image/png',
      size: bytes.byteLength,
    });
    await fixture.store.claimForThread('thread_1', [attachment]);
    const [resolved] = await fixture.store.resolveForThread('thread_1', [attachment]);
    expect(resolved?.absolutePath).toBe(path.join(
      fixture.dataDir,
      'attachments',
      'files',
      attachment.assetId,
      'Diagram.png',
    ));
    await expect(readFile(resolved!.absolutePath)).resolves.toEqual(bytes);
    const reloadedStore = new FileAttachmentStore(fixture.dataDir, fixture.clock, new SequentialIdGenerator());
    await expect(reloadedStore.resolveForThread('thread_1', [attachment])).resolves.toHaveLength(1);

    await expect(fixture.store.create({
      name: 'spoofed.jpg',
      type: 'image/jpeg',
      data: bytes,
    })).rejects.toMatchObject({ code: 'attachment_unsupported' } satisfies Partial<RuntimeAttachmentValidationError>);
  });

  it('expires abandoned uploads during recovery without deleting valid claimed files', async () => {
    const fixture = await attachmentStoreFixture(1_000);
    const abandoned = await fixture.store.create({
      name: 'abandoned.pdf',
      type: 'application/pdf',
      data: Buffer.from('%PDF-1.4\nabandoned'),
    });
    const claimed = await fixture.store.create({
      name: 'claimed.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: fakeDocx(),
    });
    await fixture.store.claimForThread('thread_1', [claimed]);

    fixture.clock.advance(1_001);
    await fixture.store.recover(['thread_1']);

    await expect(fixture.store.deletePending(abandoned.assetId)).resolves.toBe(false);
    await expect(fixture.store.resolveForThread('thread_1', [claimed])).resolves.toHaveLength(1);
  });
});

async function attachmentStoreFixture(pendingTtlMs = 24 * 60 * 60 * 1_000) {
  const dataDir = await createTestTempDirectory('setsuna-attachment-store-test-');
  const clock = new MutableClock(new Date('2026-07-17T00:00:00.000Z'));
  const ids = new SequentialIdGenerator();
  return {
    clock,
    dataDir,
    store: new FileAttachmentStore(dataDir, clock, ids, pendingTtlMs),
  };
}

function fakeDocx(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('[Content_Types].xml\0word/document.xml'),
  ]);
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
}

class MutableClock implements Clock {
  constructor(private value: Date) {}

  now(): Date {
    return new Date(this.value);
  }

  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}

class SequentialIdGenerator implements IdGenerator {
  private next = 0;

  id(prefix: string): string {
    this.next += 1;
    return `${prefix}_${this.next}`;
  }
}
