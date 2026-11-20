import { randomUUID } from 'node:crypto';
import type { DesignScriptCanvas } from '@setsuna-desktop/feature-design/contracts';
import { QuickJsToolProgramRuntime } from './quickjs-tool-program-runtime.js';

export function createDesignScriptSandbox() {
  const sandbox = new QuickJsToolProgramRuntime();
  const active = new Set<Promise<void>>();
  return {
    async evaluate(source: string, canvas: DesignScriptCanvas, signal: AbortSignal): Promise<unknown> {
      while (active.size >= 2 && !signal.aborted) await Promise.race(active);
      signal.throwIfAborted();
      const sessionId = randomUUID();
      // Use a fresh VM and an empty tool catalog for each canvas evaluation.
      const code = `const canvas = Object.freeze(${JSON.stringify(canvas)});\nObject.freeze(canvas.input);\nreturn JSON.stringify((() => {\n${source}\n})());`;
      const execution = sandbox.execute({ code, sessionId, output: 'return', toolNames: [], signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
        callTool: async () => { throw new Error('Canvas scripts have no tools.'); } });
      const settled = execution.then(() => undefined, () => undefined);
      active.add(settled);
      try { return JSON.parse(await execution) as unknown; }
      finally {
        active.delete(settled);
        sandbox.releaseThread(sessionId);
      }
    },
  };
}
