import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import { ModelLatencyLog } from '../../../src/adapters/model/model-latency-log.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setsuna-latency-log-'));
  roots.push(root);
  return { root, log: new ModelLatencyLog(root) };
}

describe('bounded model latency log', () => {
  it('rolls one file under 1 MiB, retaining complete recent lines and queued write order', async () => {
    const { log } = await fixture();
    await mkdir(path.dirname(log.filePath), { recursive: true });
    const oldLine = `${JSON.stringify({ phase: '旧记录', padding: 'x'.repeat(480) })}\n`;
    const oldBytes = Buffer.byteLength(oldLine);
    await writeFile(log.filePath, oldLine.repeat(Math.floor(1024 * 1024 / oldBytes)));
    for (let index = 0; index < 100; index += 1) log.record({ phase: 'http.started', attempt: index });
    await log.flush();

    const bytes = await readFile(log.filePath);
    expect(bytes.byteLength).toBeLessThanOrEqual(1024 * 1024);
    const lines = bytes.toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0].phase).toBe('旧记录');
    expect(lines.slice(-100).map((record) => record.attempt)).toEqual(Array.from({ length: 100 }, (_, index) => index));
    // A subsequent process instance can append to the same rolled file.
    const restarted = new ModelLatencyLog(path.dirname(path.dirname(log.filePath)));
    restarted.record({ phase: 'runtime.started' });
    await restarted.flush();
    expect((await readFile(log.filePath, 'utf8')).trim().split('\n').at(-1)).toContain('runtime.started');
  });

  it('records event timing without persisting conversation or tool payloads', async () => {
    const { log } = await fixture();
    log.recordEvent({
      threadId: 'thread-1', turnId: 'turn-1', id: 'event-1', seq: 42,
      type: 'turn.started', createdAt: '2026-09-17T01:00:00.000Z',
      payload: { input: 'PRIVATE PROMPT' },
    } as StoredThreadEvent);
    await log.flush();
    const content = await readFile(log.filePath, 'utf8');
    expect(content).not.toContain('PRIVATE PROMPT');
    expect(JSON.parse(content)).toMatchObject({ phase: 'turn.started', threadId: 'thread-1', turnId: 'turn-1', eventSeq: 42 });
  });

  it('isolates filesystem failures from callers and recovers on later writes', async () => {
    const { root, log } = await fixture();
    await writeFile(path.join(root, 'logs'), 'blocked');
    log.record({ phase: 'model.started' });
    await expect(log.flush()).resolves.toBeUndefined();
    await rm(path.join(root, 'logs'));
    log.record({ phase: 'model.completed' });
    await log.flush();
    expect(await readFile(log.filePath, 'utf8')).toContain('model.completed');
  });
});
