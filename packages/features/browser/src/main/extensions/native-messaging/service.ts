import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { Extension } from 'electron';
import type { ExtensionSystemEvent } from '../../../contracts/extension-api.js';
import type { ExtensionEndpoint } from '../contexts.js';
import { resolveNativeHost } from './manifest.js';
import { encodeNativeMessage, NativeMessageReader } from './framing.js';

type Connection = { extensionId: string; context: ExtensionEndpoint<ExtensionSystemEvent>; portId: string;
  process?: ChildProcessWithoutNullStreams; closed: boolean; release(): void };

/** Ports belong to authenticated extension contexts and keep their MV3 worker alive. */
export class BrowserExtensionNativeMessaging {
  private readonly ports = new Map<string, Map<string, Connection>>();

  async call(extension: Extension, context: ExtensionEndpoint<ExtensionSystemEvent>, method: string, args: unknown[]): Promise<void> {
    if (!extension.manifest.permissions?.includes('nativeMessaging')) throw new Error('nativeMessaging permission required.');
    const [portId] = args;
    if (typeof portId !== 'string' || !portId.length || portId.length > 128) throw new Error('Invalid native messaging port.');
    if (method === 'connect') {
      if (typeof args[1] !== 'string') throw new Error('Invalid native messaging host name specified.');
      const ports = this.ports.get(context.key) ?? new Map<string, Connection>();
      if (ports.has(portId) || ports.size >= 32) throw new Error('Native messaging port unavailable.');
      const connection: Connection = { extensionId: extension.id, context, portId, closed: false, release: context.hold() };
      ports.set(portId, connection); this.ports.set(context.key, ports);
      try {
        const host = await resolveNativeHost(args[1], extension.id);
        if (connection.closed) return;
        const child = spawn(host.executable, [host.origin, ...(process.platform === 'win32' ? ['--parent-window=0'] : [])], {
          cwd: path.dirname(host.executable), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
        });
        connection.process = child;
        const reader = new NativeMessageReader((message) => {
          if (!connection.closed) context.send({ kind: 'nativeMessage', portId, message });
        });
        child.stdout.on('data', (chunk: Buffer) => { try { reader.push(chunk); } catch (error) { this.close(connection, (error as Error).message); } });
        // Host stderr can contain account information; drain it without forwarding it to the app log.
        child.stderr.resume();
        child.on('error', () => this.close(connection, 'Failed to start native messaging host.'));
        child.stdin.on('error', () => this.close(connection, 'Error when communicating with the native messaging host.'));
        child.once('exit', () => this.close(connection, 'Native host has exited.'));
      } catch (error) {
        // Startup errors travel in the RPC reply, even before worker event delivery is ready.
        this.close(connection, undefined, false); throw error;
      }
      return;
    }
    const connection = this.ports.get(context.key)?.get(portId);
    if (!connection || connection.extensionId !== extension.id || connection.closed) throw new Error('Native messaging port is disconnected.');
    if (method === 'disconnect') { this.close(connection); return; }
    if (method !== 'postMessage' || !connection.process) throw new Error('Native messaging port unavailable.');
    try { connection.process.stdin.write(encodeNativeMessage(args[1])); }
    catch (error) { this.close(connection, (error as Error).message); throw error; }
  }

  closeContext(key: string): void { for (const connection of [...(this.ports.get(key)?.values() ?? [])]) this.close(connection); }
  remove(id: string): void {
    for (const ports of this.ports.values()) for (const connection of [...ports.values()]) if (connection.extensionId === id) this.close(connection);
  }
  dispose(): void { for (const key of [...this.ports.keys()]) this.closeContext(key); }

  private close(connection: Connection, error?: string, notify = true): void {
    if (connection.closed) return;
    connection.closed = true;
    const ports = this.ports.get(connection.context.key); ports?.delete(connection.portId);
    if (!ports?.size) this.ports.delete(connection.context.key);
    connection.process?.stdin.end(); connection.process?.kill();
    if (notify) connection.context.send({ kind: 'nativeDisconnect', portId: connection.portId, ...(error ? { error } : {}) });
    connection.release();
  }
}
