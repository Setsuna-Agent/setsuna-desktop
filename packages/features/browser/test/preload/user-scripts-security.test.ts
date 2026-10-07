import { createContext, runInContext, type Context } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import type { WireExtensionPlan, WorldDelivery } from '../../src/contracts/user-scripts.js';
import { installUserScripts, type UserScriptsBridge } from '../../src/preload/user-scripts-runner.js';

afterEach(() => vi.unstubAllGlobals());

/** Execute the real serialized world API in separate JS globals, sharing only the event target. */
function harness(plans: WireExtensionPlan[]) {
  const document = Object.assign(new EventTarget(), { readyState: 'complete', documentElement: {} });
  vi.stubGlobal('document', document);
  vi.stubGlobal('location', { href: 'https://scripts.test/' });
  const worlds = new Map<number, { context: Context; deliveries: unknown[] }>();
  let deliver: (delivery: WorldDelivery) => void = () => { throw new Error('Runner not initialized'); };
  const answer = vi.fn();
  const bridge: UserScriptsBridge = {
    plan: () => plans,
    message: vi.fn(async () => ({})), port: vi.fn(), answer,
    onPort: () => undefined, onExecute: () => undefined, onInvalidate: () => undefined,
    onDeliver: (listener) => { deliver = listener; },
    setIsolatedWorldInfo: () => undefined,
    executeInMainWorld: async () => undefined,
    executeInIsolatedWorld: async (id, code) => {
      let world = worlds.get(id);
      if (!world) {
        const deliveries: unknown[] = [];
        const worldDocument = {
          dispatchEvent: (event: Event) => document.dispatchEvent(event),
          addEventListener: (name: string, listener: EventListener) => document.addEventListener(name, (event) => {
            if (event instanceof CustomEvent && typeof event.detail === 'string') {
              const payload = JSON.parse(event.detail);
              if (payload.kind === 'deliver') deliveries.push(payload.message);
            }
            listener(event);
          }),
        };
        world = { context: createContext({ document: worldDocument, CustomEvent, console, setTimeout }), deliveries };
        worlds.set(id, world);
      }
      return runInContext(code, world.context);
    },
  };
  installUserScripts(bridge);
  return { worlds: [...worlds.values()], answer, deliver: (extensionId: string) => deliver({
    token: 7, extensionId, message: 'private-extension-data', sender: { id: extensionId },
  }) };
}

function plan(extensionId: string, permissions: boolean[]): WireExtensionPlan {
  return { extensionId, incognito: false, worlds: permissions.map((messaging, index) => ({
    world: 'USER_SCRIPT', worldId: index ? `world-${index}` : null, csp: null, messaging,
    scripts: [{ id: `script-${index}`, runAt: 'document_start', code: [
      'chrome.runtime.onMessage?.addListener((message, _sender, respond) => respond(message));',
    ] }],
  })) };
}

it('keeps every messaging API and the incoming payload behind the same world permission', () => {
  const runner = harness([plan('target', [false, true]), plan('other-extension', [true])]);
  const [blocked, allowed, unrelated] = runner.worlds;
  const surface = (world: typeof blocked) => JSON.parse(runInContext(
    `JSON.stringify(['sendMessage','connect','onMessage','onConnect'].map(key => typeof chrome.runtime[key]))`, world.context,
  ));
  expect(surface(blocked)).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  expect(surface(allowed)).toEqual(['function', 'function', 'object', 'object']);
  expect(runInContext('chrome.runtime.id', blocked.context)).toBe('target');
  runner.deliver('target');
  // Observe transport delivery itself: hiding onMessage alone cannot protect the payload.
  expect(blocked.deliveries).toEqual([]);
  expect(unrelated.deliveries).toEqual([]);
  expect(allowed.deliveries).toEqual(['private-extension-data']);
  expect(runner.answer).toHaveBeenCalledExactlyOnceWith({ token: 7, handled: true, responded: true, result: 'private-extension-data' });
});

it('returns no receiver immediately when all of the extension worlds deny messaging', () => {
  const runner = harness([plan('target', [false, false])]);
  runner.deliver('target');
  expect(runner.worlds.every(world => world.deliveries.length === 0)).toBe(true);
  expect(runner.answer).toHaveBeenCalledExactlyOnceWith({ token: 7, handled: false, responded: false });
});
