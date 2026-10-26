import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  TOOL_PROGRAM_MAX_CALLS, TOOL_PROGRAM_OUTPUT_BYTES, TOOL_PROGRAM_TIMEOUT_MS, TOOL_PROGRAM_VALUE_BYTES,
  type ToolProgramRuntime,
} from '../../ports/tool-program-runtime.js';
import { ToolProgramState } from './program-state.js';

/** The engine and its WASM are loaded in a disposable worker only on run_code. */
export class QuickJsToolProgramRuntime implements ToolProgramRuntime {
  private readonly sessions = new Map<string, ToolProgramState>();
  private readonly active = new Map<string, Worker>();
  private stopped = false;

  releaseThread(threadId: string): void {
    this.sessions.delete(threadId);
    void this.active.get(threadId)?.terminate();
  }

  shutdown(): void {
    this.stopped = true;
    this.sessions.clear();
    for (const worker of this.active.values()) void worker.terminate();
  }

  async execute(input: Parameters<ToolProgramRuntime['execute']>[0]): Promise<string> {
    input.signal.throwIfAborted();
    const sessionId = input.sessionId ?? 'default';
    if (this.stopped || this.active.has(sessionId) || this.active.size >= 4) throw new Error('Tool program runtime is unavailable or busy.');
    const state = this.sessions.get(sessionId) ?? new ToolProgramState();
    this.sessions.delete(sessionId);
    // Bound idle state across threads; evicted keys read as undefined and can be recreated.
    if (this.sessions.size >= 8) {
      const oldest = [...this.sessions.keys()].find(id => !this.active.has(id));
      if (oldest) this.sessions.delete(oldest);
    }
    this.sessions.set(sessionId, state);
    const entry = workerEntrypoint();
    const worker = new Worker(entry.path, { execArgv: entry.execArgv,
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 } });
    this.active.set(sessionId, worker);
    let count = 0;
    let finished = false;
    let cancel = () => {};
    const timer = setTimeout(() => cancel(), TOOL_PROGRAM_TIMEOUT_MS);
    try {
      return await new Promise<string>((resolve, reject) => {
        cancel = () => reject(input.signal.reason ?? new Error('Tool program exceeded its 120 second deadline.'));
        input.signal.addEventListener('abort', cancel, { once: true });
        worker.once('error', reject);
        worker.once('exit', code => { if (!finished) reject(new Error(`Tool program worker exited (${code}).`)); });
        worker.on('message', (message: { type: string; id: number; name: string; values: [string, string][]; arguments: string; output: string; error: string }) => {
          if (finished || input.signal.aborted) return;
          if (message.type === 'done') {
            if (typeof message.output !== 'string' || Buffer.byteLength(message.output) > TOOL_PROGRAM_OUTPUT_BYTES) reject(new Error('Invalid tool program output.'));
            else resolve(message.output);
          } else if (message.type === 'error') reject(new Error(message.error));
          else if (message.type === 'state') {
            try {
              if (this.sessions.get(sessionId) === state) this.sessions.set(sessionId, new ToolProgramState(message.values));
            } catch (error) { reject(error); }
          }
          else if (message.type === 'call') {
            void (async () => {
              try {
                if (++count > TOOL_PROGRAM_MAX_CALLS || !input.toolNames.includes(message.name)) throw new Error('Tool is outside this program catalog or call budget.');
                if (Buffer.byteLength(message.arguments) > 256 * 1024) throw new Error('Tool arguments exceed 256 KiB.');
                const result = await input.callTool(message.name, JSON.parse(message.arguments));
                const value = JSON.stringify(result ?? null);
                if (Buffer.byteLength(value) > TOOL_PROGRAM_VALUE_BYTES) throw new Error('Tool value exceeds 2 MiB; request a smaller range.');
                if (!finished) worker.postMessage({ type: 'result', id: message.id, value });
              } catch (error) {
                if (!finished) worker.postMessage({ type: 'result', id: message.id, error: error instanceof Error ? error.message : String(error) });
              }
            })();
          }
        });
        worker.postMessage({ type: 'start', code: input.code, toolNames: input.toolNames,
          state: state.snapshot(), toolCatalog: input.toolCatalog ?? input.toolNames.map(name => ({ name, description: '' })) });
        if (input.signal.aborted) cancel();
      });
    } finally {
      finished = true;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', cancel);
      await worker.terminate();
      this.active.delete(sessionId);
      // The caller owns cancellation and settling of nested tools; never await them here
      // before it can abort a program that failed while a host call was still running.
    }
  }
}

function workerEntrypoint(): { path: string; execArgv: string[] } {
  for (const name of ['./tool-program-worker.cjs', './quickjs-worker.js']) {
    const path = fileURLToPath(new URL(name, import.meta.url));
    if (existsSync(path)) return { path, execArgv: [] };
  }
  return { path: fileURLToPath(new URL('./quickjs-worker.ts', import.meta.url)),
    execArgv: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href] };
}
