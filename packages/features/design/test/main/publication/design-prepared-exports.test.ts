import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vitest';
import { designPackageStagingFile, designPackageStagingPrefix } from '../../../src/contracts/design-package.js';
import { DesignPreparedExports } from '../../../src/main/publication/design-prepared-exports.js';
import type { DesignPackageMainHost } from '../../../src/main/publication/design-export-files.js';

const { choose, open, reveal } = vi.hoisted(() => ({ choose: vi.fn(), open: vi.fn(), reveal: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showSaveDialog: choose }, shell: { openPath: open, showItemInFolder: reveal } }));
const window = {} as BrowserWindow;
const signal = new AbortController().signal;
const source = { kind: 'zip', version: {
  documentId: 'board', expectedRevision: '1'.repeat(64), ref: { storageId: 'local', path: 'board.design.json' },
} } as const;
const archive = { entries: ['manifest.json', 'content/board.design.json'], remaining: 0 };

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-design-export-test-'));
  const runtimeDirectory = path.join(directory, 'runtime');
  const temporary = path.join(directory, 'temporary');
  await Promise.all([mkdir(runtimeDirectory), mkdir(temporary)]);
  return { directory, runtimeDirectory, temporary };
}

it('saves the prepared ZIP only after confirmation and opens the saved file from its owning window', async () => {
  const { directory, runtimeDirectory, temporary } = await fixture();
  const destination = path.join(directory, 'delivered.zip');
  const original = 'previous ZIP';
  const prepared = 'frozen ZIP';
  let pendingSource = prepared;
  const prepareDesignPackage = vi.fn<DesignPackageMainHost['prepareDesignPackage']>(async ({ ticket }) => {
    await writeFile(path.join(runtimeDirectory, designPackageStagingPrefix + ticket, designPackageStagingFile), pendingSource);
    return { ticket, archive };
  });
  const exports = new DesignPreparedExports({ runtimeDirectory, prepareDesignPackage }, temporary);
  try {
    await writeFile(destination, original);
    await expect(exports.prepare(1, 'request', source, signal)).resolves.toEqual({ name: 'board.zip', archive });
    expect(choose).not.toHaveBeenCalled();
    await expect(exports.use(2, window, 'request', 'save', signal)).rejects.toThrow();
    expect(choose).not.toHaveBeenCalled();
    choose.mockResolvedValueOnce({ canceled: true });
    await expect(exports.use(1, window, 'request', 'save', signal)).resolves.toBeNull();
    expect(await readFile(destination, 'utf8')).toBe(original);

    pendingSource = 'edited since preview';
    choose.mockResolvedValueOnce({ canceled: false, filePath: destination });
    await expect(exports.use(1, window, 'request', 'save', signal)).resolves.toBe('delivered.zip');
    expect(await readFile(destination, 'utf8')).toBe(prepared);
    expect(prepareDesignPackage).toHaveBeenCalledOnce();
    await exports.use(1, window, 'request', 'open', signal);
    await exports.use(1, window, 'request', 'reveal', signal);
    expect(open).toHaveBeenCalledWith(destination);
    expect(reveal).toHaveBeenCalledWith(destination);
    await exports.close(1, 'request');
    expect(await readdir(temporary)).toEqual([]);
    expect(await readdir(runtimeDirectory)).toEqual([]);
  } finally {
    await exports.close(1);
    vi.resetAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
});

it('discards a ZIP that finishes after its preview closes without removing the replacement preview', async () => {
  const { directory, runtimeDirectory, temporary } = await fixture();
  const staged = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const exports = new DesignPreparedExports({ runtimeDirectory, async prepareDesignPackage({ ticket }) {
    await writeFile(path.join(runtimeDirectory, designPackageStagingPrefix + ticket, designPackageStagingFile), 'late ZIP');
    staged.resolve();
    await release.promise;
    return { ticket, archive };
  } }, temporary);
  const preparing = exports.prepare(1, 'first', source, signal);
  try {
    await staged.promise;
    await exports.close(1, 'first');
    await expect(exports.prepare(1, 'second', { kind: 'html', name: 'next.html', content: '<p>Next</p>' }, signal))
      .resolves.toMatchObject({ name: 'next.html' });
    release.resolve();
    await expect(preparing).resolves.toBeNull();
    expect(await readdir(runtimeDirectory)).toEqual([]);
    const remaining = await readdir(temporary);
    expect(remaining).toHaveLength(1);
    expect(await readFile(path.join(temporary, remaining[0], 'next.html'), 'utf8')).toBe('<p>Next</p>');
  } finally {
    release.resolve();
    await preparing.catch(() => undefined);
    await exports.close(1);
    await rm(directory, { recursive: true, force: true });
  }
});

it('cleans up a temporary export on disposal after it was opened and its preview closed', async () => {
  const { directory, runtimeDirectory, temporary } = await fixture();
  const exports = new DesignPreparedExports({ runtimeDirectory, prepareDesignPackage: vi.fn() }, temporary);
  try {
    const html = '<p>Published draft</p>';
    await exports.prepare(1, 'request', { kind: 'html', name: 'draft.html', content: html }, signal);
    open.mockResolvedValueOnce('');
    await exports.use(1, window, 'request', 'open', signal);
    const [opened] = open.mock.lastCall!;
    await exports.close(1, 'request');
    expect(await readFile(opened, 'utf8')).toBe(html);

    await exports.dispose();
    expect(await readdir(temporary)).toEqual([]);
  } finally {
    await exports.dispose();
    vi.resetAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
});
