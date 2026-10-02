import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ComputerDiagnosticJournal, type ComputerDiagnostic } from '../../src/main/diagnostics.js';
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });
async function file() { const folder = await mkdtemp(path.join(os.tmpdir(), 'computer-journal-')); folders.push(folder); return path.join(folder, 'logs', 'computer-use.jsonl'); }
describe('bounded local diagnostic metadata', () => {
  it('persists ordered events while stripping images, task identities and unexpected native metadata', async () => {
    const target = await file(); const journal = new ComputerDiagnosticJournal(target);
    journal.record({ event: 'command', run: 1, token: 'secret-token', threadId: 'private-task', dataUrl: 'private-image', nativeWindow: { supported: true, occlusion: 'unknown', title: 'private-title', pid: 999 } } as ComputerDiagnostic);
    journal.record({ event: 'stopped', reason: 'indicator-hidden', run: 1 }); await journal.flush();
    const text = await readFile(target, 'utf8'); const rows = text.trim().split('\n').map((line) => JSON.parse(line));
    expect(rows.map((row) => row.sequence)).toEqual([1, 2]); expect(text).not.toMatch(/secret|private|999/u);
    expect(rows[1]).toMatchObject({ event: 'stopped', reason: 'indicator-hidden' });
    if (process.platform !== 'win32') expect((await stat(target)).mode & 0o777).toBe(0o600);
  });
  it('retains only the current and previous bounded log', async () => {
    const target = await file(); const journal = new ComputerDiagnosticJournal(target, 250);
    for (let run = 1; run <= 10; run++) journal.record({ event: 'stopped', reason: 'requested', run });
    await journal.flush();
    expect((await stat(target)).size).toBeLessThanOrEqual(250);
    expect((await stat(`${target}.1`)).size).toBeLessThanOrEqual(250);
    expect(await readFile(target, 'utf8')).toContain('"run":10');
  });
});
