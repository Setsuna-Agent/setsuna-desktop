import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/test' }, utilityProcess: { fork: mocks.fork } }));
import type { InputFrame } from '../../src/main/native-input.js';
import { HelperComputerDriver } from '../../src/main/helper-driver.js';
const frame: InputFrame = { width: 200, height: 100, display: { id: 1, bounds: { x: 0, y: 0, width: 100, height: 50 }, scaleFactor: 2, inputBounds: { x: 0, y: 0, width: 100, height: 50 }, inputCoordinateSpace: 'macos-points' } };
class Child extends EventEmitter {
  reply = true;
  shutdownReply = true;
  image = 'iVBORw0KGgo=';
  messages: Array<{ kind: string; id: number }> = [];
  kill = vi.fn(() => { queueMicrotask(() => this.emit('exit', 0)); return true; });
  postMessage(message: { kind: string; id: number }) {
    this.messages.push(message);
    if (message.kind === 'shutdown') {
      if (this.shutdownReply) queueMicrotask(() => this.emit('message', { id: message.id, result: { stopped: true } }));
    } else if (this.reply) queueMicrotask(() => this.emit('message', { id: message.id, result: { image: this.image, ready: true } }));
  }
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers(); });
function fixture() {
  const child = new Child(); mocks.fork.mockReturnValue(child);
  const onExit = vi.fn(); const driver = new HelperComputerDriver(onExit, () => '/test/node_modules/@zavora-ai/computer-use-mcp/dist/native.js');
  return { driver, child, onExit };
}
describe('Electron desktop helper transport', () => {
  it('launches only native input from a private child and excludes runtime/model credentials', async () => {
    vi.stubEnv('SETSUNA_DESKTOP_COMPUTER_CONTROL_TOKEN', 'private'); vi.stubEnv('OPENAI_API_KEY', 'private');
    const f = fixture(); await f.driver.start('s', new AbortController().signal);
    expect(mocks.fork.mock.calls[0][0]).toBe('/test/dist/computer-use/driver-helper.mjs');
    expect(mocks.fork.mock.calls[0][2].env).not.toHaveProperty('OPENAI_API_KEY');
    expect(mocks.fork.mock.calls[0][2].env).not.toHaveProperty('SETSUNA_DESKTOP_COMPUTER_CONTROL_TOKEN');
    await f.driver.stop(); expect(f.child.kill).toHaveBeenCalledOnce();
  });
  it('supports read-only probes without requesting a session or screenshot', async () => {
    const f = fixture(); await f.driver.probe();
    expect(f.child.messages.map((message) => message.kind)).toEqual(['probe', 'shutdown']);
    expect(f.child.kill).toHaveBeenCalledOnce();
  });
  it('requests graceful release on cancellation before terminating the helper', async () => {
    const f = fixture(); await f.driver.start('s', new AbortController().signal); f.child.reply = false;
    const abort = new AbortController(); const pending = f.driver.action({ kind: 'key', key: 'Tab' }, frame, abort.signal);
    const rejected = expect(pending).rejects.toThrow('cancelled'); abort.abort(); await rejected;
    await vi.waitFor(() => expect(f.onExit).toHaveBeenCalledOnce());
    expect(f.child.kill).toHaveBeenCalledOnce(); await f.driver.stop();
    expect(f.child.messages.at(-1)?.kind).toBe('shutdown');
  });
  it('waits for release acknowledgement and keeps native timeouts closed', async () => {
    vi.useFakeTimers();
    const f = fixture(); await f.driver.start('s', new AbortController().signal); f.child.shutdownReply = false;
    const stopped = f.driver.stop(); const rejected = expect(stopped).rejects.toThrow('release is unconfirmed');
    expect(f.child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000); await rejected;
    await expect(f.driver.stop()).rejects.toThrow('release is unconfirmed');
    expect(f.child.kill).toHaveBeenCalledOnce();
  });
  it('rejects restart after an unexpected helper crash', async () => {
    const f = fixture(); await f.driver.start('s', new AbortController().signal);
    f.child.emit('exit', 1);
    await expect(f.driver.stop()).rejects.toThrow('crashed');
    await expect(f.driver.start('new', new AbortController().signal)).rejects.toThrow('crashed');
  });
});
