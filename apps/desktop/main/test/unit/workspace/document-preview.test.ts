import { DOCUMENT_PREVIEW_MAX_BYTES } from '@setsuna-desktop/contracts';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readWorkspaceDocument } from '../../../src/workspace/document-preview.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it('reads original bytes for all supported documents and rejects escapes, disguised binaries and oversized files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-document-preview-'));
  roots.push(root);
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  for (const format of ['docx', 'pptx', 'xlsx', 'csv', 'pdf']) {
    const fixture = path.resolve(`apps/desktop/renderer/test/fixtures/office/sample.${format}`);
    await copyFile(fixture, path.join(workspace, `sample.${format.toUpperCase()}`));
    const result = await readWorkspaceDocument(workspace, `sample.${format.toUpperCase()}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Buffer.from(result.data)).toEqual(await readFile(fixture));
  }
  await writeFile(path.join(outside, 'private.csv'), 'private,data');
  await symlink(outside, path.join(workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(workspace, 'fake.docx'), '<script>not an Office file</script>');
  await writeFile(path.join(workspace, 'fake.pdf'), '<html>not a PDF</html>');
  await writeFile(path.join(workspace, 'binary.csv'), Buffer.from([0x4d, 0x5a, 0, 1]));
  await writeFile(path.join(workspace, 'large.xlsx'), '');
  await truncate(path.join(workspace, 'large.xlsx'), DOCUMENT_PREVIEW_MAX_BYTES + 1);
  for (const filePath of ['../outside/private.csv', 'link/private.csv', path.join(outside, 'private.csv'), 'fake.docx', 'fake.pdf', 'binary.csv', 'large.xlsx', 'unknown.rar']) {
    await expect(readWorkspaceDocument(workspace, filePath)).resolves.toMatchObject({ ok: false });
  }
  await writeFile(path.join(workspace, 'empty.csv'), '');
  await expect(readWorkspaceDocument(workspace, 'empty.csv')).resolves.toEqual({ ok: true, data: Buffer.alloc(0) });
});
