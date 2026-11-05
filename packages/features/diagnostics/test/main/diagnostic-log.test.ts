import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopDiagnosticLog, DIAGNOSTIC_LOG_MAX_BYTES } from '../../src/main/diagnostic-log.js';

const context = {
  appVersion: '0.5.4', electronVersion: '43.8.3', chromeVersion: '150.0', v8Version: '15.0',
  platform: 'darwin', arch: 'arm64', osVersion: '25.0.0',
};
let root: string;
let directory: string;
const currentFile = () => path.join(directory, 'desktop-diagnostics.jsonl');
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'setsuna-diagnostics-'));
  directory = path.join(root, 'logs');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

it('preserves ordered crash records, versions and separate sessions across application restarts', async () => {
  const log = new DesktopDiagnosticLog(directory, context);
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  for (let i = 0; i < 20; i += 1) {
    log.record('renderer-process-gone', { senderId: i, reason: 'crashed', exitCode: 5 });
  }
  await log.flush();
  const restarted = new DesktopDiagnosticLog(directory, { ...context, appVersion: '0.5.5' });
  restarted.record('renderer-process-gone', { senderId: 1, reason: 'oom', exitCode: 9 });
  await restarted.flush();

  const records = (await readFile(currentFile(), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  expect(records).toHaveLength(21);
  expect(records.slice(0, 20).map((record) => record.details.senderId)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  expect(records[0]).toMatchObject({ ...context, event: 'renderer-process-gone',
    mainProcessId: process.pid, details: { senderId: 0, reason: 'crashed', exitCode: 5 } });
  expect(Number.isFinite(Date.parse(records[0].timestamp))).toBe(true);
  expect(records[0].uptimeSeconds).toBeGreaterThanOrEqual(0);
  expect(new Set(records.slice(0, 20).map((record) => record.sessionId)).size).toBe(1);
  expect(records[20]).toMatchObject({ appVersion: '0.5.5', details: { reason: 'oom', exitCode: 9 } });
  expect(records[20].sessionId).not.toBe(records[0].sessionId);
});

it('rotates an existing full log before appending and keeps only the three most recent backups', async () => {
  await mkdir(directory);
  await writeFile(currentFile(), Buffer.alloc(DIAGNOSTIC_LOG_MAX_BYTES, 0x61));
  for (const [backup, value] of [[1, 'recent'], [2, 'older'], [3, 'oldest']] as const) {
    await writeFile(path.join(directory, `desktop-diagnostics.${backup}.jsonl`), value);
  }
  const log = new DesktopDiagnosticLog(directory, context);
  log.record('renderer-process-gone', { reason: 'crashed', exitCode: 5 });
  await log.flush();

  expect(JSON.parse((await readFile(currentFile(), 'utf8')).trim()).details.exitCode).toBe(5);
  expect((await stat(path.join(directory, 'desktop-diagnostics.1.jsonl'))).size).toBe(DIAGNOSTIC_LOG_MAX_BYTES);
  expect(await readFile(path.join(directory, 'desktop-diagnostics.2.jsonl'), 'utf8')).toBe('recent');
  expect(await readFile(path.join(directory, 'desktop-diagnostics.3.jsonl'), 'utf8')).toBe('older');
  expect(await readdir(directory)).toHaveLength(4);
});

it('isolates failed writes and can record later crashes after the directory becomes writable', async () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await writeFile(directory, 'blocked');
  const log = new DesktopDiagnosticLog(directory, context);
  expect(() => log.record('renderer-process-gone', { reason: 'crashed', exitCode: 5 })).not.toThrow();
  await expect(log.flush()).resolves.toBeUndefined();
  expect(report).toHaveBeenCalledOnce();
  expect(await readFile(directory, 'utf8')).toBe('blocked');
  await rm(directory);
  log.record('renderer-process-gone', { reason: 'oom', exitCode: 9 });
  await log.flush();
  expect(JSON.parse((await readFile(currentFile(), 'utf8')).trim()).details.reason).toBe('oom');
});
