import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ModelImageTransport } from '../../../src/adapters/model/model-image-transport.js';

describe('high-quality model image transport', () => {
  it('reduces image bytes while preserving dimensions, alpha and the source with limited colour error', async () => {
    const input = await screenshotPng();
    const original = Buffer.from(input);
    const transport = new ModelImageTransport();

    const result = await transport.prepare(input, 'image/png');

    expect(result.type).toBe('image/webp');
    expect(result.data.byteLength).toBeLessThan(input.byteLength / 2);
    expect(input.equals(original)).toBe(true);
    const before = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(result.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(after.info).toMatchObject({ width: before.info.width, height: before.info.height, channels: 4 });
    const beforeAlpha = await sharp(input).extractChannel('alpha').raw().toBuffer();
    const afterAlpha = await sharp(result.data).extractChannel('alpha').raw().toBuffer();
    expect(afterAlpha.equals(beforeAlpha)).toBe(true);
    let colourError = 0;
    let visibleChannels = 0;
    for (let index = 0; index < before.data.length; index += 1) {
      if (index % 4 === 3 || before.data[index - index % 4 + 3] === 0) continue;
      colourError += Math.abs(before.data[index]! - after.data[index]!);
      visibleChannels += 1;
    }
    expect(colourError / visibleChannels).toBeLessThan(3);
  });

  it('shares in-flight work and cached bytes by content while keeping changed images distinct', async () => {
    const input = await screenshotPng();
    const transport = new ModelImageTransport();
    const [first, concurrent] = await Promise.all([
      transport.prepare(input, 'image/png'),
      transport.prepare(Buffer.from(input), 'image/png'),
    ]);
    const followUp = await transport.prepare(Buffer.from(input), 'image/png');
    const changed = await transport.prepare(await screenshotPng(30), 'image/png');

    expect(first.type).toBe('image/webp');
    expect(concurrent.data).toBe(first.data);
    expect(followUp.data).toBe(first.data);
    expect(changed.data.equals(first.data)).toBe(false);
  });

  it('isolates cached compression levels and preserves exact pixels in lossless mode', async () => {
    const input = await screenshotPng();
    const transport = new ModelImageTransport();
    const high = await transport.prepare(input, 'image/png', 'high');
    const original = await transport.prepare(input, 'image/png', 'original');
    const lossless = await transport.prepare(input, 'image/png', 'lossless');
    const compact = await transport.prepare(input, 'image/png', 'compact');
    const fast = await transport.prepare(input, 'image/png', 'fast');

    expect(original).toEqual({ data: input, type: 'image/png' });
    expect(original.data).toBe(input);
    expect(lossless.type).toBe('image/webp');
    const before = await sharp(input).ensureAlpha().raw().toBuffer();
    const after = await sharp(lossless.data).ensureAlpha().raw().toBuffer();
    expect(after.equals(before)).toBe(true);
    expect(compact.type).toBe('image/webp');
    expect(compact.data.byteLength).toBeLessThan(high.data.byteLength);
    expect(fast.type).toBe('image/webp');
    expect(fast.data.byteLength).toBeLessThan(compact.data.byteLength);
    expect(await sharp(fast.data).metadata()).toMatchObject({ width: 256, height: 128 });
    expect((await transport.prepare(input, 'image/png', 'fast')).data).toBe(fast.data);
    expect((await transport.prepare(input, 'image/png', 'high')).data).toBe(high.data);
  });

  it('preserves invalid, animated, high-bit-depth and already compact inputs', async () => {
    const transport = new ModelImageTransport();
    const input = await screenshotPng();
    const animated = Buffer.concat([
      input.subarray(0, 33),
      Buffer.from([0, 0, 0, 8]), Buffer.from('acTL'), Buffer.alloc(12),
      input.subarray(33),
    ]);
    const highDepth = await sharp(input).toColourspace('rgb16').png({ compressionLevel: 0 }).toBuffer();
    const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
    for (const data of [Buffer.alloc(100_000), animated, highDepth, tiny]) {
      const result = await transport.prepare(data, 'image/png');
      expect(result.type).toBe('image/png');
      expect(result.data).toBe(data);
    }
    const jpeg = await sharp(input).jpeg().toBuffer();
    expect((await transport.prepare(jpeg, 'image/jpeg')).data).toBe(jpeg);
  });
});

async function screenshotPng(offset = 0): Promise<Buffer> {
  const width = 256;
  const height = 128;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = (index % width + offset) % 256;
    pixels[index * 4 + 1] = Math.floor(index / width);
    pixels[index * 4 + 2] = 83;
    pixels[index * 4 + 3] = index % 3 === 0 ? 0 : 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
}
