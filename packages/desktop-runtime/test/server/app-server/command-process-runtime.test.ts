import { describe, expect, it } from 'vitest';
import {
  appServerConnectionId,
  appServerSessionKey,
  appendAppServerOutputBuffer,
  createAppServerOutputBuffer,
  requiredAppServerTerminalSize,
  type AppServerManagedProcessSession,
  writeAppServerProcessInput,
} from '../../../src/server/app-server/command-process-runtime.js';

describe('AppServer command/process runtime seam', () => {
  it('caps captured and streamed bytes through the same output buffer', () => {
    const output = createAppServerOutputBuffer(5);

    const first = appendAppServerOutputBuffer(output, Buffer.from('abc'));
    const second = appendAppServerOutputBuffer(output, Buffer.from('def'));

    expect(first).toMatchObject({ capReached: false });
    expect(second.chunk.toString('utf8')).toBe('de');
    expect(second.capReached).toBe(true);
    expect(Buffer.concat(output.chunks).toString('utf8')).toBe('abcde');
    expect(output.capturedBytes).toBe(5);
  });

  it('uses collision-safe session keys and a normalized default connection', () => {
    expect(appServerConnectionId('  ')).toBe('default');
    expect(appServerConnectionId(' connection-a ')).toBe('connection-a');
    expect(appServerSessionKey('a:b', 'c')).not.toBe(appServerSessionKey('a', 'b:c'));
  });

  it('validates PTY dimensions before either command surface resizes', () => {
    expect(requiredAppServerTerminalSize(
      { rows: 30, cols: 100 },
      'process/resizePty',
    )).toEqual({ rows: 30, cols: 100 });
    expect(() => requiredAppServerTerminalSize(
      { rows: 0, cols: 100 },
      'process/resizePty',
    )).toThrow('process/resizePty size rows and cols must be greater than 0');
  });

  it('shares base64 stdin writes and close semantics across command and process sessions', () => {
    const writes: string[] = [];
    const session: AppServerManagedProcessSession = {
      connectionId: 'connection-a',
      ptyProcess: {
        kill() {},
        onData: () => ({ dispose() {} }),
        onExit: () => ({ dispose() {} }),
        resize() {},
        write: (value) => writes.push(value),
      },
      streamStdin: true,
      stdinClosed: false,
      timedOut: false,
    };

    writeAppServerProcessInput(session, {
      deltaBase64: Buffer.from('hello').toString('base64'),
      closeStdin: true,
    }, {
      methodName: 'command/exec/write',
      disabledMessage: 'disabled',
    });

    expect(writes[0]).toBe('hello');
    expect(writes[1]).toBe(process.platform === 'win32' ? '\x1a\r' : '\x04');
    expect(session.stdinClosed).toBe(true);
  });
});
