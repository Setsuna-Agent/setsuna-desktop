import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowProcess } from '../../src/main/window-process.js';
import { StaleComputerObservationError } from '../../src/main/backend.js';

class Child extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  messages: Array<{ id: number; kind: string }> = [];
  shutdownReply = true;
  kill = vi.fn(() => { queueMicrotask(() => this.emit('close', null)); return true; });
  constructor() {
    super();
    this.stdin.on('data', (data) => {
      const command = JSON.parse(data.toString()); this.messages.push(command);
      if (command.kind === 'shutdown' && this.shutdownReply) queueMicrotask(() => {
        this.reply(command.id, { stopped: true }); this.emit('close', 0);
      });
    });
  }
  reply(id: number, result: unknown) { this.stdout.write(`${JSON.stringify({ id, result })}\n`); }
}
function fixture() {
  const child = new Child(); const spawn = vi.fn(() => child);
  const onExit = vi.fn();
  const process = new WindowProcess('/signed-app/setsuna-computer', onExit, spawn as never);
  return { child, process, onExit, spawn };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('window helper lifecycle', () => {
  it('preserves typed pre-input geometry errors without restarting the helper', async () => {
    const f = fixture();
    const pending = f.process.request({ kind: 'action' }, new AbortController().signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(StaleComputerObservationError);
    f.child.stdout.write(`${JSON.stringify({ id: f.child.messages[0]!.id, error: 'Window moved', errorCode: 'stale-observation' })}\n`);
    await rejected;
    const capture = f.process.request({ kind: 'capture' }, new AbortController().signal);
    f.child.reply(f.child.messages[1]!.id, { image: 'fresh' });
    await expect(capture).resolves.toEqual({ image: 'fresh' });
    expect(f.spawn).toHaveBeenCalledOnce();
    await f.process.stop();
  });
  it('decodes split stdio responses and starts without model or runtime credentials', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'secret'); vi.stubEnv('SETSUNA_DESKTOP_COMPUTER_CONTROL_TOKEN', 'secret');
    const f = fixture(); const pending = f.process.request({ kind: 'windows' }, new AbortController().signal);
    const id = f.child.messages[0]!.id;
    const reply = JSON.stringify({ id, result: [{ id: 'window' }] });
    f.child.stdout.write(reply.slice(0, 8)); f.child.stdout.write(`${reply.slice(8)}\n`);
    expect(await pending).toEqual([{ id: 'window' }]);
    const options = (f.spawn.mock.calls as unknown as Array<[string, string[], { env: Record<string, string> }]>)[0]![2];
    expect(options.env).not.toHaveProperty('OPENAI_API_KEY'); expect(options.env).not.toHaveProperty('SETSUNA_DESKTOP_COMPUTER_CONTROL_TOKEN');
    await f.process.stop(); expect(f.onExit).not.toHaveBeenCalled();
  });
  it('cancels an in-flight request, waits for release acknowledgement, and permits a new session', async () => {
    const f = fixture(); const abort = new AbortController();
    const pending = f.process.request({ kind: 'action' }, abort.signal);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    abort.abort(); await rejected; await f.process.stop();
    expect(f.child.messages.map((message) => message.kind)).toEqual(['action', 'shutdown']);
    expect(f.child.kill).not.toHaveBeenCalled();
    const next = new Child(); f.spawn.mockReturnValueOnce(next);
    const fresh = f.process.request({ kind: 'start' }, new AbortController().signal);
    next.reply(next.messages[0]!.id, { ready: true }); await fresh; await f.process.stop();
    expect(f.onExit).not.toHaveBeenCalled();
  });
  it('closes admission permanently after an unacknowledged shutdown or crash', async () => {
    vi.useFakeTimers();
    const f = fixture(); f.child.shutdownReply = false;
    const pending = f.process.request({ kind: 'action' }, new AbortController().signal);
    const cancelled = expect(pending).rejects.toThrow('cancelled');
    const stopped = f.process.stop(); const rejected = expect(stopped).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(2000); await rejected; await cancelled;
    await expect(f.process.request({ kind: 'start' }, new AbortController().signal)).rejects.toThrow('timed out');
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
    const crashed = fixture();
    const command = crashed.process.request({ kind: 'action' }, new AbortController().signal);
    const failed = expect(command).rejects.toThrow('exited');
    crashed.child.emit('close', 1); await failed;
    expect(crashed.onExit).toHaveBeenCalledOnce();
    await expect(crashed.process.request({ kind: 'start' }, new AbortController().signal)).rejects.toThrow('exited');
  });
});
