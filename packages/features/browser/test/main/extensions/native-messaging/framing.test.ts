import { expect, it } from 'vitest';
import { encodeNativeMessage, NativeMessageReader } from '../../../../src/main/extensions/native-messaging/framing.js';

it('decodes split UTF-8 messages and multiple messages in the same pipe read', () => {
  const received: unknown[] = [];
  const reader = new NativeMessageReader((message) => received.push(message));
  const first = encodeNativeMessage({ text: '中文 🐈', id: 1 });
  const next = encodeNativeMessage({ id: 2 });
  reader.push(first.subarray(0, 2)); reader.push(first.subarray(2, 7));
  expect(received).toEqual([]);
  reader.push(Buffer.concat([first.subarray(7), next]));
  expect(received).toEqual([{ text: '中文 🐈', id: 1 }, { id: 2 }]);
});

it('rejects invalid or oversized host messages before accepting the payload', () => {
  for (const length of [0, 1024 * 1024 + 1, 0xffffffff]) {
    const header = Buffer.alloc(4); header.writeUInt32LE(length);
    expect(() => new NativeMessageReader(() => undefined).push(header)).toThrow('size');
  }
  expect(() => new NativeMessageReader(() => undefined).push(Buffer.from([1, 0, 0, 0, 123]))).toThrow('JSON');
  expect(() => encodeNativeMessage(undefined)).toThrow('serializable');
});
