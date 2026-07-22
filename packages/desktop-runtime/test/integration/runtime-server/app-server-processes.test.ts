import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRuntimeServerTestHarness,
  mediumIntegrationTestTimeoutMs,
  type RuntimeServerTestHarness,
} from '../../support/runtime-server/harness.js';
import {
  persistentOutputScript,
  persistentPtyScript
} from '../../support/runtime-server/shared.js';

describe('runtime server AppServer processes', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('spawns AppServer processes and emits process exit notifications', async () => {
      const processHandle = `process-buffered-${Date.now()}`;
      const exitedPromise = harness.readAppServerNotificationStreamContains('"stdout":"proc-out"', { timeoutMs: 3000 });
  
      await expect(harness.appServerRpc('process/spawn', {
        command: [process.execPath, '-e', 'process.stdout.write("proc-out")'],
        processHandle,
        cwd: process.cwd(),
        timeoutMs: 5_000,
      })).resolves.toEqual({});
  
      await expect(exitedPromise).resolves.toBe(true);
    });
  
  it('streams AppServer process output through server notifications', async () => {
      const processHandle = `process-stream-${Date.now()}`;
      const outputPromise = harness.readAppServerNotificationStreamContains(Buffer.from('proc-stream').toString('base64'), { timeoutMs: 3000 });
  
      await expect(harness.appServerRpc('process/spawn', {
        command: [process.execPath, '-e', 'process.stdout.write("proc-stream")'],
        processHandle,
        cwd: process.cwd(),
        streamStdoutStderr: true,
        timeoutMs: 5_000,
      })).resolves.toEqual({});
  
      await expect(outputPromise).resolves.toBe(true);
    });
  
  it('scopes AppServer process/spawn handles to explicit event-stream connections', async () => {
      const processHandle = `shared-process-${Date.now()}`;
      const firstConnectionId = `process-conn-a-${Date.now()}`;
      const secondConnectionId = `process-conn-b-${Date.now()}`;
      const firstStream = await harness.openAppServerNotificationStream({ connectionId: firstConnectionId });
      const secondStream = await harness.openAppServerNotificationStream({ connectionId: secondConnectionId });
  
      try {
        await expect(harness.appServerRpc('process/spawn', {
          command: [process.execPath, '-e', persistentOutputScript('process-one')],
          processHandle,
          cwd: process.cwd(),
          streamStdoutStderr: true,
          timeoutMs: 10_000,
        }, { connectionId: firstConnectionId })).resolves.toEqual({});
        await expect(firstStream.readDecodedOutputContains(
          'process/outputDelta',
          'processHandle',
          processHandle,
          'ready:process-one',
          { timeoutMs: 5_000 },
        )).resolves.toBe(true);
  
        await expect(harness.appServerRpc('process/spawn', {
          command: [process.execPath, '-e', persistentOutputScript('process-two')],
          processHandle,
          cwd: process.cwd(),
          streamStdoutStderr: true,
          timeoutMs: 10_000,
        }, { connectionId: secondConnectionId })).resolves.toEqual({});
        await expect(secondStream.readDecodedOutputContains(
          'process/outputDelta',
          'processHandle',
          processHandle,
          'ready:process-two',
          { timeoutMs: 5_000 },
        )).resolves.toBe(true);
  
        await expect(harness.appServerRpc('process/kill', { processHandle }, { connectionId: firstConnectionId })).resolves.toEqual({});
        await expect(harness.appServerRpc('process/kill', { processHandle }, { connectionId: secondConnectionId })).resolves.toEqual({});
      } finally {
        await firstStream.close();
        await secondStream.close();
      }
    }, mediumIntegrationTestTimeoutMs);
  
  it('supports AppServer process/spawn PTY sessions and resize', async () => {
      const processHandle = `pty-process-${Date.now()}`;
      const notificationTimeoutMs = 15_000;
      const readyPromise = harness.readAppServerNotificationDecodedOutputContains(
        'process/outputDelta',
        'processHandle',
        processHandle,
        'tty:true',
        { timeoutMs: notificationTimeoutMs },
      );
      await expect(harness.appServerRpc('process/spawn', {
        command: [process.execPath, '-e', persistentPtyScript('spawn')],
        processHandle,
        cwd: process.cwd(),
        tty: true,
        size: { rows: 29, cols: 99 },
        timeoutMs: 20_000,
      })).resolves.toEqual({});
  
      await expect(readyPromise).resolves.toBe(true);
      await expect(harness.appServerRpc('process/resizePty', {
        processHandle,
        size: { rows: 30, cols: 100 },
      })).resolves.toEqual({});
      await expect(harness.appServerRpc('process/kill', { processHandle })).resolves.toEqual({});
    });
  
  it('writes stdin to AppServer process sessions', async () => {
      const processHandle = `process-stdin-${Date.now()}`;
      const exitedPromise = harness.readAppServerNotificationStreamContains('"stdout":"stdin:hello"', { timeoutMs: 3000 });
  
      await expect(harness.appServerRpc('process/spawn', {
        command: [
          process.execPath,
          '-e',
          'let data = ""; process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => process.stdout.write(`stdin:${data}`));',
        ],
        processHandle,
        cwd: process.cwd(),
        streamStdin: true,
        timeoutMs: 5_000,
      })).resolves.toEqual({});
  
      await expect(harness.appServerRpc('process/writeStdin', {
        processHandle,
        deltaBase64: Buffer.from('hello').toString('base64'),
        closeStdin: true,
      })).resolves.toEqual({});
  
      await expect(exitedPromise).resolves.toBe(true);
    });
  
  it('kills AppServer process sessions and rejects PTY resize for non-PTY processes', async () => {
      const processHandle = `process-kill-${Date.now()}`;
      const exitedPromise = harness.readAppServerNotificationStreamContains('"method":"process/exited"', { timeoutMs: 3000 });
  
      await expect(harness.appServerRpc('process/spawn', {
        command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        processHandle,
        cwd: process.cwd(),
        timeoutMs: null,
      })).resolves.toEqual({});
  
      await expect(harness.appServerRpcEnvelope({
        id: 'resize_process',
        method: 'process/resizePty',
        params: { processHandle, size: { rows: 24, cols: 80 } },
      })).resolves.toMatchObject({
        id: 'resize_process',
        error: {
          code: -32600,
          message: expect.stringContaining('PTY-backed process'),
        },
      });
  
      await expect(harness.appServerRpc('process/kill', { processHandle })).resolves.toEqual({});
      await expect(exitedPromise).resolves.toBe(true);
    });
  
  it('lists and terminates AppServer background terminals by thread', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Background terminals', cwd: process.cwd() });
      const otherThread = await harness.appServerRpc('thread/start', { name: 'Other background terminals', cwd: process.cwd() });
      const connectionId = `background-terminals-${Date.now()}`;
      const processHandle = `background-terminal-${Date.now()}`;
      try {
        await expect(harness.appServerRpc('process/spawn', {
          command: [process.execPath, '-e', persistentOutputScript('background-terminal')],
          processHandle,
          cwd: process.cwd(),
          threadId: startedThread.thread.id,
          tty: true,
          timeoutMs: null,
        }, { connectionId })).resolves.toEqual({});
  
        await expect(harness.appServerRpc('thread/backgroundTerminals/list', {
          threadId: startedThread.thread.id,
        }, { connectionId })).resolves.toEqual({
          data: [
            expect.objectContaining({
              cwd: process.cwd(),
              processHandle,
              threadId: startedThread.thread.id,
              tty: true,
            }),
          ],
        });
        await expect(harness.appServerRpc('thread/backgroundTerminals/list', {
          threadId: otherThread.thread.id,
        }, { connectionId })).resolves.toEqual({ data: [] });
        await expect(harness.appServerRpc('thread/backgroundTerminals/terminate', {
          threadId: startedThread.thread.id,
          processHandle,
        }, { connectionId })).resolves.toEqual({ terminated: true });
        await expect(harness.appServerRpc('thread/backgroundTerminals/terminate', {
          threadId: startedThread.thread.id,
          processHandle,
        }, { connectionId })).resolves.toEqual({ terminated: false });
        await expect(harness.appServerRpc('thread/backgroundTerminals/list', {
          threadId: startedThread.thread.id,
        }, { connectionId })).resolves.toEqual({ data: [] });
      } finally {
        await harness.appServerRpc('process/kill', { processHandle }, { connectionId }).catch(() => undefined);
      }
    });
  
  it('cleans AppServer background terminals for a thread without touching other threads', async () => {
      const firstThread = await harness.appServerRpc('thread/start', { name: 'Background clean A', cwd: process.cwd() });
      const secondThread = await harness.appServerRpc('thread/start', { name: 'Background clean B', cwd: process.cwd() });
      const connectionId = `background-clean-${Date.now()}`;
      const firstHandle = `background-clean-a-${Date.now()}`;
      const secondHandle = `background-clean-b-${Date.now()}`;
      try {
        await expect(harness.appServerRpc('process/spawn', {
          command: [process.execPath, '-e', persistentOutputScript('background-clean-a')],
          processHandle: firstHandle,
          cwd: process.cwd(),
          threadId: firstThread.thread.id,
          timeoutMs: null,
        }, { connectionId })).resolves.toEqual({});
        await expect(harness.appServerRpc('process/spawn', {
          command: [process.execPath, '-e', persistentOutputScript('background-clean-b')],
          processHandle: secondHandle,
          cwd: process.cwd(),
          threadId: secondThread.thread.id,
          timeoutMs: null,
        }, { connectionId })).resolves.toEqual({});
  
        await expect(harness.appServerRpc('thread/backgroundTerminals/clean', {
          threadId: firstThread.thread.id,
        }, { connectionId })).resolves.toEqual({});
  
        await expect(harness.appServerRpc('thread/backgroundTerminals/list', {
          threadId: firstThread.thread.id,
        }, { connectionId })).resolves.toEqual({ data: [] });
        await expect(harness.appServerRpc('thread/backgroundTerminals/list', {
          threadId: secondThread.thread.id,
        }, { connectionId })).resolves.toEqual({
          data: [expect.objectContaining({ processHandle: secondHandle })],
        });
      } finally {
        await harness.appServerRpc('process/kill', { processHandle: firstHandle }, { connectionId }).catch(() => undefined);
        await harness.appServerRpc('process/kill', { processHandle: secondHandle }, { connectionId }).catch(() => undefined);
      }
    });
  
  it('returns the upstream empty response shape for AppServer turn interrupts', async () => {
      const startedThread = await harness.appServerRpc('thread/start', { name: 'Interrupt shape', cwd: process.cwd() });
      const startedTurn = await harness.appServerRpc('turn/start', {
        threadId: startedThread.thread.id,
        input: [{ type: 'text', text: 'Start a cancellable local response.' }],
      });
  
      await expect(harness.appServerRpc('turn/interrupt', {
        threadId: startedThread.thread.id,
        turnId: startedTurn.turn.id,
      })).resolves.toEqual({});
    });
  
  it('returns JSON-RPC invalid request errors from the AppServer app-server adapter', async () => {
      const response = await harness.appServerRpcEnvelope(null);
      expect(response).toEqual({
        id: null,
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      });
    });
  
  it('accepts AppServer JSON-RPC approval response envelopes on the app-server adapter', async () => {
      const response = await harness.appServerRpcEnvelope({
        id: 'approval_missing',
        result: { decision: 'accept' },
      });
  
      expect(response).toEqual({
        id: 'approval_missing',
        error: {
          code: -32603,
          message: 'Approval not found: approval_missing',
        },
      });
    });
});
