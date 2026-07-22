import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileAttachmentStore } from '../../../src/adapters/store/file-attachment-store.js';
import { RuntimeAttachmentValidationError } from '../../../src/ports/attachment-store.js';
import type { Clock } from '../../../src/ports/clock.js';
import type { IdGenerator } from '../../../src/ports/id-generator.js';

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('file attachment store', () => {
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
  const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-attachment-store-test-'));
  testDirectories.push(dataDir);
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
