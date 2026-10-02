import type { NativeModule } from '@zavora-ai/computer-use-mcp/host-native';
import { pathToFileURL } from 'node:url';
import type { ComputerAction } from '../contracts/index.js';
import { InputAdmission } from './input-admission.js';
import { dispatchNativeInput, type InputFrame } from './native-input.js';

type Request = { id: number; kind: 'probe' | 'start' | 'action' | 'shutdown'; sessionId?: string; action?: ComputerAction; frame?: InputFrame };
const port = (process as NodeJS.Process & { parentPort?: { on(event: 'message', callback: (event: { data: Request }) => void): void; postMessage(value: unknown): void } }).parentPort;
if (!port) throw new Error('Computer helper requires an Electron parent port.');
if (process.platform !== 'win32') throw new Error('Global input helper is Windows-only; use the macOS window helper.');
const host: typeof import('@zavora-ai/computer-use-mcp/host-native') = await import(pathToFileURL(process.argv[2]).href);
const native: NativeModule = host.loadNative();
const inputMethods = ['getDisplaySize', 'listDisplays', 'mouseClick', 'mouseMove', 'mouseScroll', 'keyPress', 'typeText'] as const;
if (inputMethods.some((name) => typeof native[name] !== 'function')) throw new Error('Native desktop input API is incomplete.');
let session: string | undefined;
let queue: Promise<unknown> = Promise.resolve();
const admission = new InputAdmission();
async function run(request: Request): Promise<unknown> {
  if (request.kind === 'probe') return { metadata: { name: '@zavora-ai/computer-use-mcp/host-native', version: '7.4.0', addonPath: host.resolveAddonPath(), executable: process.execPath, pid: process.pid, parentPid: process.ppid, sampledAt: new Date().toISOString(), inputMethods, captureBackend: 'electron-desktop-capturer', mode: 'foreground-desktop' } };
  if (request.kind === 'shutdown') {
    session = undefined;
    // The queue has completed the bounded down/up gesture before this ack.
    // No hold API is exposed. Native failure/hang leaves the parent closed.
    return { stopped: true };
  }
  admission.check();
  if (request.kind === 'start') {
    if (!request.sessionId || session) throw new Error('Invalid desktop helper session.');
    session = request.sessionId;
    return { ready: true };
  }
  if (!session || request.kind !== 'action' || !request.action || !request.frame) throw new Error('Invalid desktop input request.');
  await dispatchNativeInput(native, request.action, request.frame, admission);
  return { dispatched: true };
}
port.on('message', ({ data }) => {
  // Stop is received between complete native gestures, not between down/up.
  if (data.kind === 'shutdown') admission.close();
  queue = queue.then(async () => {
    try { port.postMessage({ id: data.id, result: await run(data) }); }
    catch (error) { port.postMessage({ id: data.id, error: error instanceof Error ? error.message.slice(0, 500) : 'Desktop input failed.' }); }
  });
});
