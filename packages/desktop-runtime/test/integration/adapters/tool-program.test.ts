import { describe, expect, it } from 'vitest';
import { QuickJsToolProgramRuntime } from '../../../src/adapters/tool-program/quickjs-tool-program-runtime.js';
import { runToolProgram } from '../../../src/loop/tools/programmatic-tool.js';

describe('isolated tool programs', () => {
  it('chains and filters real bridge results without exposing host capabilities or intermediate values', async () => {
    const calls: string[] = [];
    const output = await runToolProgram({
      arguments: { code: `
        const first = await tools.list({});
        const ids = JSON.parse(first.content);
        const values = await Promise.all(ids.map(id => tools.read({id})));
        print(values.map(r => JSON.parse(r.content).value).reduce((a,b) => a+b, 0));
        print(typeof process, typeof require, typeof fetch, typeof tools.hidden);
      ` },
      runtime: new QuickJsToolProgramRuntime(), toolNames: ['list', 'read'], signal: new AbortController().signal,
      canRunInParallel: async () => true,
      callTool: async (name, args) => {
        calls.push(name);
        return { tool_call_id: `call_${calls.length}`, content: name === 'list' ? '[1,2,3]'
          : JSON.stringify({ value: (args as { id: number }).id, secret: 'intermediate-only' }) };
      },
    });
    expect(output).toBe('6\nundefined undefined undefined undefined');
    expect(calls).toEqual(['list', 'read', 'read', 'read']);
  });

  it('interrupts non-yielding code and cancels/settles started host work', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const start = new Promise<void>(resolve => { started = resolve; });
    let settled = false;
    const run = runToolProgram({ arguments: { code: 'void tools.wait({}); while (true) {}' },
      runtime: new QuickJsToolProgramRuntime(), toolNames: ['wait'], signal: controller.signal,
      canRunInParallel: async () => false,
      callTool: async (_name, _args, signal) => {
        started();
        await new Promise<void>(resolve => signal.addEventListener('abort', () => { settled = true; resolve(); }, { once: true }));
        return { content: '', tool_call_id: 'wait' };
      },
    });
    const rejected = expect(run).rejects.toThrow('cancelled by test');
    await start;
    controller.abort(new Error('cancelled by test'));
    await rejected;
    expect(settled).toBe(true);
  });

  it('does not retain variables or expose unavailable tools across programs', async () => {
    const runtime = new QuickJsToolProgramRuntime();
    const input = { runtime, toolNames: [], signal: new AbortController().signal,
      canRunInParallel: async () => false, callTool: async () => { throw new Error('must not execute'); } };
    await runToolProgram({ ...input, arguments: { code: 'globalThis.saved = 42;' } });
    expect(await runToolProgram({ ...input, arguments: { code: 'print(typeof saved);' } })).toBe('undefined');
    await expect(runToolProgram({ ...input, arguments: { code: 'await tools.unavailable({});' } })).rejects.toThrow();
  });

  it('cancels admission even when a policy lookup does not settle', async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const admission = new Promise<void>(resolve => { entered = resolve; });
    const run = runToolProgram({ arguments: { code: 'await tools.read({});' }, runtime: new QuickJsToolProgramRuntime(),
      toolNames: ['read'], signal: controller.signal,
      canRunInParallel: async () => { entered(); return new Promise<boolean>(() => {}); },
      callTool: async () => { throw new Error('Queued call must not run.'); },
    });
    const rejected = expect(run).rejects.toThrow('cancelled during policy');
    await admission;
    controller.abort(new Error('cancelled during policy'));
    await rejected;
  });

  it('retains only explicitly stored JSON within one thread and releases it on deletion', async () => {
    const runtime = new QuickJsToolProgramRuntime();
    const input = { runtime, toolNames: ['lookup'], toolCatalog: [{ name: 'lookup', description: 'Find records' }],
      signal: new AbortController().signal, canRunInParallel: async () => true,
      callTool: async () => ({ content: '[{"status":"failed"},{"status":"ok"}]', tool_call_id: 'lookup' }) };
    expect(await runToolProgram({ ...input, sessionId: 'a', arguments: { code: `
      const result = await tools.lookup({}); store('records', JSON.parse(result.content));
      text({ count: load('records').length, tool: ALL_TOOLS[0].name });
    ` } })).toBe('{"count":2,"tool":"lookup"}');
    expect(await runToolProgram({ ...input, sessionId: 'a', arguments: { code: `text(load('records').filter(r => r.status === 'failed'));` } })).toBe('[{"status":"failed"}]');
    expect(await runToolProgram({ ...input, sessionId: 'b', arguments: { code: `text(typeof load('records'));` } })).toBe('undefined');
    runtime.releaseThread('a');
    expect(await runToolProgram({ ...input, sessionId: 'a', arguments: { code: `text(typeof load('records'));` } })).toBe('undefined');
    await expect(runToolProgram({ ...input, sessionId: 'a', arguments: { code: `store('too-big', 'x'.repeat(3 * 1024 * 1024));` } })).rejects.toThrow('state limit');
    runtime.shutdown();
  });
});
