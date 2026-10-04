import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { reserveBrowserDownload } from '../../../src/main/settings/downloads.js';

vi.mock('electron', () => ({ app: {} }));
it('reserves non-overwriting download destinations and confines Windows and macOS filenames to the selected folder', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-download-'));
  try {
    await writeFile(path.join(directory, 'report.pdf'), 'keep this');
    expect(reserveBrowserDownload(directory, 'report.pdf')).toBe(path.join(directory, 'report (1).pdf'));
    expect(reserveBrowserDownload(directory, 'report.pdf')).toBe(path.join(directory, 'report (2).pdf'));
    expect(await readFile(path.join(directory, 'report.pdf'), 'utf8')).toBe('keep this');
    for (const name of ['../../escape', '..\\..\\escape', 'CON.txt', 'bad:name?.txt']) {
      const target = reserveBrowserDownload(directory, name);
      expect(path.dirname(target)).toBe(directory);
      expect(path.basename(target)).not.toMatch(/[/\\:?]/);
      expect(path.basename(target)).not.toBe('CON.txt');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
