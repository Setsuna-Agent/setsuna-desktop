import { TOOL_PROGRAM_STATE_BYTES, TOOL_PROGRAM_VALUE_BYTES } from '../../ports/tool-program-runtime.js';

/** Serialized values only: no host objects and no live JS references cross executions. */
export class ToolProgramState {
  private readonly values = new Map<string, string>();
  private bytes = 0;

  constructor(snapshot: readonly [string, string][] = []) {
    for (const [key, value] of snapshot) this.set(key, value);
  }

  get(key: string): string | undefined { return this.values.get(key); }
  snapshot(): [string, string][] { return [...this.values]; }

  set(key: string, value: string): void {
    if (typeof key !== 'string' || !key.trim() || key.length > 128 || typeof value !== 'string') throw new Error('store requires a non-empty key (up to 128 characters) and JSON-serializable data.');
    const size = Buffer.byteLength(value);
    const nextBytes = this.bytes - Buffer.byteLength(this.values.get(key) ?? '') + size;
    if (size > TOOL_PROGRAM_VALUE_BYTES || nextBytes > TOOL_PROGRAM_STATE_BYTES
      || (!this.values.has(key) && this.values.size >= 128)) throw new Error('Program state limit exceeded (2 MiB/value, 4 MiB/thread, 128 keys).');
    JSON.parse(value);
    this.values.set(key, value);
    this.bytes = nextBytes;
  }
}
