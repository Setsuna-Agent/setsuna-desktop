import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appServerCommandSandboxProfile } from '../../../src/server/app-server/command-exec.js';
import {
  createRuntimeServerTestHarness,
  longIntegrationTestTimeoutMs,
  mediumIntegrationTestTimeoutMs,
  type RuntimeServerTestHarness,
} from '../../support/runtime-server/harness.js';
import {
  persistentOutputScript,
  persistentPtyScript
} from '../../support/runtime-server/shared.js';

describe('runtime server AppServer command execution', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('runs buffered AppServer command/exec requests without creating thread output', async () => {
      const response = await harness.appServerRpc('command/exec', {
        command: [
          process.execPath,
          '-e',
          'process.stdout.write("exec-out"); process.stderr.write("exec-err");',
        ],
        timeoutMs: 5_000,
      });
  
      expect(response).toEqual({
        exitCode: 0,
        stdout: 'exec-out',
        stderr: 'exec-err',
      });
    });
  
  it('builds AppServer command/exec sandbox profiles from sandboxPolicy', () => {
      const cwd = path.join(tmpdir(), 'setsuna app-server command sandbox');
      const writableRoot = path.join(cwd, 'generated');
      const profile = appServerCommandSandboxProfile({
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [writableRoot],
          networkAccess: false,
        },
      }, cwd, { supported: true, provider: 'macos-seatbelt', reason: '' });
  
      expect(profile).toContain('(deny network*)');
      expect(profile).toContain('(deny file-write*');
      expect(profile).toContain(`(require-not (subpath ${JSON.stringify(path.resolve(writableRoot))}))`);
    });
  
  it('accepts upstream AppServer command/exec permission profile ids', () => {
      const cwd = path.join(tmpdir(), 'setsuna app-server command profile');
      const profile = appServerCommandSandboxProfile({
        permissionProfile: ':workspace',
      }, cwd, { supported: true, provider: 'macos-seatbelt', reason: '' });
  
      expect(profile).toContain('(deny network*)');
      expect(profile).toContain(`(require-not (subpath ${JSON.stringify(path.resolve(cwd))}))`);
      expect(appServerCommandSandboxProfile({
        permissionProfile: ':danger-full-access',
      }, cwd, { supported: false, provider: 'none', reason: 'unsupported platform: test' })).toBe('');
    });
  
  it('accepts AppServer command/exec externalSandbox policy without local enforcement', () => {
      expect(appServerCommandSandboxProfile({
        sandboxPolicy: { type: 'externalSandbox', networkAccess: 'enabled' },
      }, process.cwd(), { supported: false, provider: 'none', reason: 'unsupported platform: test' })).toBe('');
    });
  
  it('fails closed for AppServer command/exec sandboxPolicy when OS sandbox is unavailable', () => {
      expect(() => appServerCommandSandboxProfile({
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      }, process.cwd(), { supported: false, provider: 'none', reason: 'unsupported platform: test' })).toThrow('OS sandbox is unavailable');
    });
  
  it('merges AppServer command/exec environment overrides and supports unset values', async () => {
      const response = await harness.appServerRpc('command/exec', {
        command: [
          process.execPath,
          '-e',
          'process.stdout.write(`${process.env.APP_SERVER_EXEC_BASELINE}|${process.env.APP_SERVER_EXEC_EXTRA}|${process.env.APP_SERVER_EXEC_UNSET ?? "unset"}`);',
        ],
        env: {
          APP_SERVER_EXEC_BASELINE: 'request',
          APP_SERVER_EXEC_EXTRA: 'added',
          APP_SERVER_EXEC_UNSET: null,
        },
        timeoutMs: 5_000,
      });
  
      expect(response).toEqual({
        exitCode: 0,
        stdout: 'request|added|unset',
        stderr: '',
      });
    });
  
  it('supports AppServer command/exec stdin writes for client process ids', async () => {
      const processId = `proc-${Date.now()}`;
      const execPromise = harness.appServerRpc('command/exec', {
        command: [
          process.execPath,
          '-e',
          'let data = ""; process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => process.stdout.write(`stdin:${data}`));',
        ],
        processId,
        streamStdin: true,
        timeoutMs: 5_000,
      });
  
      await expect(harness.appServerRpcEventually('command/exec/write', {
        processId,
        deltaBase64: Buffer.from('hello').toString('base64'),
        closeStdin: true,
      })).resolves.toEqual({});
  
      await expect(execPromise).resolves.toEqual({
        exitCode: 0,
        stdout: 'stdin:hello',
        stderr: '',
      });
    });
  
  it('streams AppServer command/exec output through server notifications', async () => {
      const processId = `streaming-process-${Date.now()}`;
      const outputPromise = harness.readAppServerNotificationStreamContains(Buffer.from('stream').toString('base64'), { timeoutMs: 3000 });
  
      await expect(harness.appServerRpc('command/exec', {
        command: [process.execPath, '-e', 'process.stdout.write("stream")'],
        processId,
        streamStdoutStderr: true,
        timeoutMs: 5_000,
      })).resolves.toEqual({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });
  
      await expect(outputPromise).resolves.toBe(true);
    });
  
  it('supports AppServer command/exec PTY sessions and resize', async () => {
      const processId = `pty-command-${Date.now()}`;
      const notificationTimeoutMs = 15_000;
      const commandTimeoutMs = 20_000;
      const readyPromise = harness.readAppServerNotificationDecodedOutputContains(
        'command/exec/outputDelta',
        'processId',
        processId,
        'tty:true',
        { timeoutMs: notificationTimeoutMs },
      );
  
      const execPromise = harness.appServerRpc('command/exec', {
        command: [process.execPath, '-e', persistentPtyScript('command')],
        processId,
        tty: true,
        size: { rows: 31, cols: 101 },
        timeoutMs: commandTimeoutMs,
      });
  
      await expect(readyPromise).resolves.toBe(true);
      await expect(harness.appServerRpc('command/exec/resize', {
        processId,
        size: { rows: 32, cols: 102 },
      })).resolves.toEqual({});
      await expect(harness.appServerRpc('command/exec/terminate', { processId })).resolves.toEqual({});
  
      await expect(execPromise).resolves.toMatchObject({
        exitCode: expect.any(Number),
        stdout: '',
        stderr: '',
      });
    }, longIntegrationTestTimeoutMs);
  
  it('scopes AppServer command/exec process ids to explicit event-stream connections', async () => {
      const processId = `shared-command-${Date.now()}`;
      const firstConnectionId = `command-conn-a-${Date.now()}`;
      const secondConnectionId = `command-conn-b-${Date.now()}`;
      const firstStream = await harness.openAppServerNotificationStream({ connectionId: firstConnectionId });
      const secondStream = await harness.openAppServerNotificationStream({ connectionId: secondConnectionId });
      let firstExecPromise: Promise<Record<string, any>> | undefined;
      let secondExecPromise: Promise<Record<string, any>> | undefined;
  
      try {
        firstExecPromise = harness.appServerRpc('command/exec', {
          command: [process.execPath, '-e', persistentOutputScript('command-one')],
          processId,
          streamStdoutStderr: true,
          timeoutMs: 10_000,
        }, { connectionId: firstConnectionId });
        await expect(firstStream.readDecodedOutputContains(
          'command/exec/outputDelta',
          'processId',
          processId,
          'ready:command-one',
          { timeoutMs: 5_000 },
        )).resolves.toBe(true);
  
        secondExecPromise = harness.appServerRpc('command/exec', {
          command: [process.execPath, '-e', persistentOutputScript('command-two')],
          processId,
          streamStdoutStderr: true,
          timeoutMs: 10_000,
        }, { connectionId: secondConnectionId });
        await expect(secondStream.readDecodedOutputContains(
          'command/exec/outputDelta',
          'processId',
          processId,
          'ready:command-two',
          { timeoutMs: 5_000 },
        )).resolves.toBe(true);
  
        await firstStream.close();
        await expect(firstExecPromise).resolves.toMatchObject({ stdout: '', stderr: '' });
        await expect(harness.appServerRpc('command/exec/terminate', { processId }, { connectionId: secondConnectionId })).resolves.toEqual({});
        await expect(secondExecPromise).resolves.toMatchObject({ stdout: '', stderr: '' });
      } finally {
        await firstStream.close();
        await secondStream.close();
        if (firstExecPromise) await firstExecPromise.catch(() => undefined);
        if (secondExecPromise) await secondExecPromise.catch(() => undefined);
      }
    }, mediumIntegrationTestTimeoutMs);
});
