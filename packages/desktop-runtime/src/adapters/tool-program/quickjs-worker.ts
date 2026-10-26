import { parentPort } from 'node:worker_threads';
import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { newQuickJSWASMModuleFromVariant, type QuickJSDeferredPromise } from 'quickjs-emscripten-core';
import { TOOL_PROGRAM_MAX_CALLS, TOOL_PROGRAM_OUTPUT_BYTES, TOOL_PROGRAM_TIMEOUT_MS } from '../../ports/tool-program-runtime.js';
import { ToolProgramState } from './program-state.js';

const port = parentPort;
if (!port) throw new Error('Tool programs require a managed worker.');
const pending = new Map<number, { resolve(value: string): void; reject(error: Error): void }>();
let started = false;
port.on('message', (message: { type: string; code: string; toolNames: string[]; toolCatalog?: Array<{ name: string; description: string }>; state?: [string, string][]; id: number; value: string; error?: string }) => {
  if (message.type === 'result') {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error)); else call?.resolve(message.value);
  } else if (message.type === 'start' && !started) {
    started = true;
    execute(message.code, message.toolNames, message.state, message.toolCatalog).then(
      output => port.postMessage({ type: 'done', output }),
      error => port.postMessage({ type: 'error', error: Buffer.from(error instanceof Error ? error.message : String(error))
        .subarray(0, TOOL_PROGRAM_OUTPUT_BYTES).toString() }),
    );
  }
});

async function execute(code: string, toolNames: string[], snapshot: [string, string][] = [], catalog: Array<{ name: string; description: string }> = []): Promise<string> {
  // NodeNext sees the CommonJS namespace; bundled and tsx imports may unwrap it.
  const engine = await newQuickJSWASMModuleFromVariant(variant.default ?? variant);
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + TOOL_PROGRAM_TIMEOUT_MS;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  const deferred = new Set<QuickJSDeferredPromise>();
  const state = new ToolProgramState(snapshot);
  const lines: string[] = [];
  let bytes = 0;
  let callCount = 0;
  let alive = true;
  let pump = () => {};
  const call = vm.newFunction('__call', (name, args) => {
    if (++callCount > TOOL_PROGRAM_MAX_CALLS) throw new Error('Tool program call limit exceeded.');
    const serialized = vm.getString(args);
    if (Buffer.byteLength(serialized) > 256 * 1024) throw new Error('Tool arguments exceed 256 KiB.');
    const promise = vm.newPromise();
    deferred.add(promise);
    const id = callCount;
    new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port!.postMessage({ type: 'call', id, name: vm.getString(name), arguments: serialized });
    }).then(value => {
      if (alive) { const handle = vm.newString(value); promise.resolve(handle); handle.dispose(); }
    }, error => {
      if (alive) { const handle = vm.newError(String(error)); promise.reject(handle); handle.dispose(); }
    }).finally(() => { if (alive) pump(); });
    return promise.handle;
  });
  const print = vm.newFunction('print', value => {
    const line = vm.getString(value);
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > TOOL_PROGRAM_OUTPUT_BYTES) throw new Error('Program output exceeds 64 KiB; print a smaller selection.');
    lines.push(line);
  });
  vm.setProp(vm.global, '__call', call);
  vm.setProp(vm.global, '__print', print);
  call.dispose(); print.dispose();
  const save = vm.newFunction('__store', (key, value) => {
    const name = vm.getString(key);
    const serialized = vm.getString(value);
    state.set(name, serialized);
  });
  const load = vm.newFunction('__load', key => {
    const value = state.get(vm.getString(key));
    return value === undefined ? vm.undefined : vm.newString(value);
  });
  vm.setProp(vm.global, '__store', save); vm.setProp(vm.global, '__load', load);
  save.dispose(); load.dispose();
  try {
    const bootstrap = `
      const tools = Object.create(null);
      for (const name of ${JSON.stringify(toolNames)}) {
        tools[name] = async (args = {}) => JSON.parse(await __call(name, JSON.stringify(args)));
      }
      Object.freeze(tools);
      const print = (...values) => __print(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '));
      const text = print;
      const console = Object.freeze({ log: print });
      const store = (key, value) => { const encoded = JSON.stringify(value); if (encoded === undefined) throw new Error('store requires JSON-serializable data'); __store(key, encoded); };
      const load = key => { const encoded = __load(key); return encoded === undefined ? undefined : JSON.parse(encoded); };
      const ALL_TOOLS = Object.freeze(${JSON.stringify(catalog)}.map(tool => Object.freeze(tool)));
    `;
    vm.unwrapResult(vm.evalCode(bootstrap)).dispose();
    const result = vm.unwrapResult(vm.evalCode(`(async () => {\n${code}\n})()`, 'tool-program.js'));
    try {
      await new Promise<void>((resolve, reject) => {
        let scheduled = false;
        pump = () => {
          if (!alive) return;
          try {
            const jobs = runtime.executePendingJobs(128);
            if (jobs.error) { const error = vm.dump(jobs.error); jobs.error.dispose(); throw new Error(JSON.stringify(error)); }
            const state = vm.getPromiseState(result);
            if (state.type === 'fulfilled') { state.value.dispose(); resolve(); }
            else if (state.type === 'rejected') {
              const error = vm.dump(state.error); state.error.dispose(); reject(new Error(JSON.stringify(error)));
            } else if (runtime.hasPendingJob() && !scheduled) {
              scheduled = true;
              setImmediate(() => { scheduled = false; pump(); });
            } else if (!runtime.hasPendingJob() && !pending.size) reject(new Error('Program is waiting on a promise with no active tool call.'));
          } catch (error) { reject(error); }
        };
        pump();
      });
      return lines.join('\n') || 'Program completed without printed output.';
    } finally { result.dispose(); }
  } finally {
    alive = false;
    // Flush one bounded snapshot; a store() loop must not flood the host IPC queue.
    // Forced termination may discard this execution's writes, as with other volatile state.
    port!.postMessage({ type: 'state', values: state.snapshot() });
    for (const promise of deferred) promise.dispose();
    vm.dispose(); runtime.dispose();
  }
}
