import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES, WORKSPACE_TEXT_FILE_MAX_BYTES } from '@setsuna-desktop/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { FileWorkspaceProjectStore } from '../../../src/adapters/workspace/file-workspace-project-store.js';
import { saveRuntimeWorkspaceFile } from '../../../src/runtime/use-cases/workspace-operations.js';
import { systemClock } from '../../../src/ports/clock.js';

const io = vi.hoisted(() => ({ budgets: new Map<string, { limit: number; read: number; closed: number }>() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      if (io.budgets.has(String(args[0]))) throw new Error('Unbounded preview read.');
      return actual.readFile(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      const budget = io.budgets.get(String(args[0]));
      if (!budget) return file;
      return {
        stat: file.stat.bind(file),
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          if (budget.read + length > budget.limit) throw new Error('Preview exceeded its disk read budget.');
          const result = await file.read(buffer, offset, length, position);
          budget.read += result.bytesRead;
          return result;
        },
        close: async () => { budget.closed += 1; await file.close(); },
      };
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  io.budgets.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'setsuna-preview-budget-')));
  roots.push(root);
  const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock);
  const project = await store.addProject({ path: root });
  return { root, store, project };
}

it.each([
  ['installer.exe', Buffer.from('MZ'), { kind: 'unsupported', reason: 'binary' }],
  ['archive.bin', Buffer.from([0x50, 0x4b, 0x03, 0x04]), { kind: 'unsupported', reason: 'binary' }],
  ['large.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { kind: 'unsupported', reason: 'image-too-large' }],
  ['large.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04]), { kind: 'document', format: 'docx' }],
  ['large.pdf', Buffer.from('%PDF-1.7'), { kind: 'document', format: 'pdf' }],
  ['large.MP4', Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypmp42')]), { kind: 'video', mimeType: 'video/mp4' }],
  ['fake.mp4', Buffer.from('MZ'), { kind: 'unsupported', reason: 'binary' }],
])('only probes the header of a 1 GiB %s file, including refreshes', async (name, header, preview) => {
  const { root, store, project } = await fixture();
  const target = path.join(root, name);
  await writeFile(target, header);
  const size = 1024 * 1024 * 1024;
  await truncate(target, size);
  for (let refresh = 0; refresh < 2; refresh += 1) {
    const budget = { limit: 64 * 1024, read: 0, closed: 0 };
    io.budgets.set(target, budget);
    await expect(store.readFile(project.id, name)).resolves.toMatchObject({
      size, content: '', preview, truncated: false, revision: expect.stringMatching(/^stat:/u),
    });
    expect(budget.read).toBeLessThanOrEqual(budget.limit);
    expect(budget.closed).toBe(1);
  }
});

it('caps actual text reads even when the file or requested preview budget is much larger', async () => {
  const { root, store, project } = await fixture();
  const target = path.join(root, 'large.log');
  await writeFile(target, Buffer.alloc(WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES, 0x61));
  const size = 1024 * 1024 * 1024;
  await truncate(target, size);
  for (const maxTextBytes of [WORKSPACE_TEXT_FILE_MAX_BYTES, size]) {
    const limit = Math.min(maxTextBytes, WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES);
    const budget = { limit, read: 0, closed: 0 };
    io.budgets.set(target, budget);
    const result = await store.readFile(project.id, 'large.log', { maxTextBytes });
    expect(result).toMatchObject({ size, preview: { kind: 'text' }, truncated: true });
    expect(Buffer.byteLength(result.content)).toBe(limit);
    expect(budget.read).toBe(limit);
    expect(budget.closed).toBe(1);
  }
});

it('still detects edits beyond the displayed prefix before saving an editable text file', async () => {
  const { root, store, project } = await fixture();
  const original = 'a'.repeat(WORKSPACE_TEXT_FILE_MAX_BYTES + 32);
  await writeFile(path.join(root, 'editable.txt'), original);
  const preview = await store.readFile(project.id, 'editable.txt');
  expect(preview.revision).toBe(createHash('sha256').update(original).digest('hex'));
  await writeFile(path.join(root, 'editable.txt'), `${original.slice(0, -1)}b`);
  await expect(saveRuntimeWorkspaceFile(store, project.id, 'editable.txt', {
    content: 'new content', expectedRevision: preview.revision!,
  })).rejects.toThrow('changed on disk');
});
