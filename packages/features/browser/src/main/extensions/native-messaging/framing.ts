const INBOUND_LIMIT = 1024 * 1024;
const OUTBOUND_LIMIT = 64 * 1024 * 1024;

/** Both supported platforms use the native protocol's little-endian length prefix. */
export function encodeNativeMessage(message: unknown): Buffer {
  const json = JSON.stringify(message);
  if (json === undefined) throw new Error('Native message must be JSON serializable.');
  const body = Buffer.from(json, 'utf8');
  if (body.length > OUTBOUND_LIMIT) throw new Error('Native message exceeds the size limit.');
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export class NativeMessageReader {
  private pending: Buffer = Buffer.alloc(0);
  private length: number | null = null;
  constructor(private readonly receive: (message: unknown) => void) {}

  push(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    while (true) {
      if (this.length === null) {
        if (this.pending.length < 4) return;
        this.length = this.pending.readUInt32LE(); this.pending = this.pending.subarray(4);
        if (!this.length || this.length > INBOUND_LIMIT) throw new Error('Invalid native message size.');
      }
      if (this.pending.length < this.length) return;
      const body = this.pending.subarray(0, this.length); this.pending = this.pending.subarray(this.length); this.length = null;
      let message;
      try { message = JSON.parse(body.toString('utf8')); }
      catch { throw new Error('Invalid JSON from native messaging host.'); }
      this.receive(message);
    }
  }
}
