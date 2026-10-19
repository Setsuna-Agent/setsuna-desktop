import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

type BundledTool = {
  name: string;
  execute(input: Record<string, unknown>, context: BundledToolContext): Promise<Record<string, unknown>>;
};

type BundledToolContext = {
  state?: {
    get(key: string, scope: string): Promise<unknown>;
    set(key: string, value: unknown, scope: string): Promise<void>;
  };
};

type BundledHandler = (
  payload: Record<string, unknown>,
  context: { cwd?: string },
) => Promise<Record<string, unknown>> | Record<string, unknown>;

describe('bundled Setsuna utility extensions', () => {
  it('persists the todo list in thread-scoped extension state', async () => {
    const { tools } = await loadBundledExtension('todo');
    const todo = tools.get('todo');
    expect(todo).toBeDefined();
    const values = new Map<string, unknown>();
    const state = {
      get: vi.fn(async (key: string, scope: string) => values.get(`${scope}:${key}`)),
      set: vi.fn(async (key: string, value: unknown, scope: string) => {
        values.set(`${scope}:${key}`, structuredClone(value));
      }),
    };

    await expect(todo!.execute({ action: 'add', text: 'Run tests' }, { state })).resolves.toMatchObject({
      content: 'Added todo #1: Run tests',
      data: { nextId: 2, todos: [{ id: 1, text: 'Run tests', done: false }] },
    });
    await expect(todo!.execute({ action: 'toggle', id: 1 }, { state })).resolves.toMatchObject({
      content: 'Todo #1 completed.',
      data: { todos: [{ id: 1, done: true }] },
    });
    await expect(todo!.execute({ action: 'list' }, { state })).resolves.toMatchObject({
      content: '[x] #1: Run tests',
    });
    expect(state.set).toHaveBeenCalledWith('todos', expect.any(Object), 'thread');
  });

  it('discovers Claude rule paths at session start without embedding their contents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-claude-rules-'));
    const ruleDirectory = path.join(root, '.claude', 'rules', 'frontend');
    await mkdir(ruleDirectory, { recursive: true });
    await writeFile(path.join(ruleDirectory, 'react.md'), '# React rules\nNever inline secrets.\n');
    try {
      const { handlers } = await loadBundledExtension('claude-rules');
      const sessionStart = handlers.get('session.start')?.[0];
      expect(sessionStart).toBeDefined();
      await expect(sessionStart!({ source: 'startup' }, { cwd: root })).resolves.toMatchObject({
        context: [expect.stringContaining('.claude/rules/frontend/react.md')],
      });
      const outcome = await sessionStart!({ source: 'startup' }, { cwd: root });
      expect(JSON.stringify(outcome)).not.toContain('Never inline secrets');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function loadBundledExtension(pluginId: string): Promise<{
  tools: Map<string, BundledTool>;
  handlers: Map<string, BundledHandler[]>;
}> {
  const tools = new Map<string, BundledTool>();
  const handlers = new Map<string, BundledHandler[]>();
  const entryPath = path.resolve('plugins', pluginId, 'extension', 'entry.mjs');
  const extension = await import(`${pathToFileURL(entryPath).href}?test=${encodeURIComponent(pluginId)}`) as {
    default(api: {
      registerTool(tool: BundledTool): void;
      on(eventName: string, handler: BundledHandler): void;
    }): void | Promise<void>;
  };
  await extension.default({
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    on(eventName, handler) {
      handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
    },
  });
  return { tools, handlers };
}
