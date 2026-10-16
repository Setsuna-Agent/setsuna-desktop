import { randomUUID } from 'node:crypto';
import type { BrowserDebuggerTransport } from './automation.js';

type Context = { uniqueId: string; sessionId?: string };
type Evaluation = { result?: { type?: string; value?: unknown; objectId?: string }; exceptionDetails?: unknown };

/** Inspect existing tracks on demand, including tracks held only by a recorder or a child frame. */
export async function hasActiveMediaCapture(transport: BrowserDebuggerTransport,
  targetSessions: () => readonly (string | undefined)[], signal: AbortSignal): Promise<boolean> {
  const sessions = new Set<string | undefined>();
  const contexts = new Map<string, Context>();
  const objectGroup = `setsuna-media-capture-${randomUUID()}`;
  const message = (...args: unknown[]) => {
    const sessionId = typeof args[3] === 'string' && args[3] ? args[3] : undefined;
    if (!sessions.has(sessionId)) return;
    const params = args[2] as { context?: { uniqueId: string; auxData?: { frameId?: string } } };
    const context = params?.context;
    if (args[1] === 'Runtime.executionContextCreated' && context?.auxData?.frameId) {
      contexts.set(context.uniqueId, { uniqueId: context.uniqueId, sessionId });
    }
  };
  const send = (method: string, params: unknown, sessionId?: string) => abortableCommand(transport, method, params, sessionId, signal);
  transport.on('message', message);
  try {
    // Auto-attachment can discover nested out-of-process frames while their parents enable Runtime.
    for (;;) {
      const added = targetSessions().filter(sessionId => !sessions.has(sessionId));
      if (!added.length) break;
      for (const sessionId of added) {
        sessions.add(sessionId);
        await send('Runtime.enable', {}, sessionId);
      }
    }
    if (!contexts.size) throw new Error('Page media contexts are unavailable.');
    for (const context of contexts.values()) {
      const prototype = await send('Runtime.evaluate', {
        expression: 'typeof MediaStreamTrack === "undefined" ? undefined : MediaStreamTrack.prototype',
        uniqueContextId: context.uniqueId, objectGroup,
      }, context.sessionId) as Evaluation;
      if (prototype.exceptionDetails) throw new Error('Page media inspection failed.');
      if (prototype.result?.type === 'undefined') continue;
      if (!prototype.result?.objectId) throw new Error('Page media prototype is unavailable.');
      const tracks = await send('Runtime.queryObjects', {
        prototypeObjectId: prototype.result.objectId, objectGroup,
      }, context.sessionId) as { objects?: { objectId?: string } };
      if (!tracks.objects?.objectId) throw new Error('Page media tracks are unavailable.');
      const active = await send('Runtime.callFunctionOn', {
        objectId: tracks.objects.objectId,
        // queryObjects also returns subclass prototypes, which fail the native getter's brand check.
        functionDeclaration: `function(prototype) {
          const state = Object.getOwnPropertyDescriptor(prototype, 'readyState').get;
          return this.some(track => {
            try { return state.call(track) === 'live'; }
            catch (error) { if (error instanceof TypeError) return false; throw error; }
          });
        }`,
        arguments: [{ objectId: prototype.result.objectId }], objectGroup, returnByValue: true,
      }, context.sessionId) as Evaluation;
      if (active.exceptionDetails || typeof active.result?.value !== 'boolean') throw new Error('Page media state is unavailable.');
      if (active.result.value) return true;
    }
    return false;
  } finally {
    transport.off('message', message);
    // Queue cleanup even after timeout; no listener or remote object group belongs to later inspections.
    for (const sessionId of sessions) {
      void transport.sendCommand('Runtime.releaseObjectGroup', { objectGroup }, sessionId).catch(() => undefined);
      void transport.sendCommand('Runtime.disable', {}, sessionId).catch(() => undefined);
    }
  }
}

async function abortableCommand(transport: BrowserDebuggerTransport, method: string, params: unknown,
  sessionId: string | undefined, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      transport.sendCommand(method, params, sessionId),
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}
