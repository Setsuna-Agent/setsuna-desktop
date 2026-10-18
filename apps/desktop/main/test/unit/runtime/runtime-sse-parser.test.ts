import { describe, expect, it } from 'vitest';
import { RuntimeSseParser, type SseFrame } from '../../../src/runtime/runtime-sse-parser.js';

describe('incremental runtime SSE parsing', () => {
  it.each(['\n', '\r\n', '\r'])('preserves frames across every character boundary with %j newlines', (newline) => {
    const parser = new RuntimeSseParser();
    const input = [': heartbeat', '', 'event: runtime-event', 'data: {"first":1,', 'data:"second":2}', '', 'event:runtime-resync', 'data: {}', '', ''].join(newline);
    const frames = [...input].flatMap((character) => parser.push(character));
    expect(frames).toEqual([
      { event: 'runtime-event', data: '{"first":1,\n"second":2}' },
      { event: 'runtime-resync', data: '{}' },
    ]);
  });

  it('accepts a multi-megabyte legacy event split into small network chunks exactly once', () => {
    const parser = new RuntimeSseParser();
    const data = JSON.stringify({ content: '历史文件变更'.repeat(300_000) });
    const bytes = new TextEncoder().encode(`event: runtime-event\ndata: ${data}\n\n`);
    const decoder = new TextDecoder();
    const frames: SseFrame[] = [];
    for (let offset = 0; offset < bytes.length; offset += 4093) {
      frames.push(...parser.push(decoder.decode(bytes.subarray(offset, offset + 4093), { stream: true })));
    }
    expect(frames).toEqual([{ event: 'runtime-event', data }]);
    expect(parser.push('event: runtime-event\ndata: incomplete')).toEqual([]);
  });
});
