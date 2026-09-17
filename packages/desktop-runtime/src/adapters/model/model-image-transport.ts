import { createHash } from 'node:crypto';
import type { RuntimeImageCompression } from '@setsuna-desktop/contracts';

type TransportImage = { data: Buffer; type: string };

const MIN_OPTIMIZATION_BYTES = 64 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 128;
const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const LOSSY_WEBP_QUALITY = { high: 95, compact: 80, fast: 60 } as const;

/** Wire copies only: originals, dimensions and conversation history stay intact. */
export class ModelImageTransport {
  private readonly cache = new Map<string, TransportImage | null>();
  private readonly pending = new Map<string, Promise<TransportImage | null>>();
  private cacheBytes = 0;

  async prepare(data: Buffer, type: string, compression: RuntimeImageCompression = 'high'): Promise<TransportImage> {
    const original = { data, type };
    if (compression === 'original' || type !== 'image/png' || data.byteLength < MIN_OPTIMIZATION_BYTES) return original;
    // Changing the setting must never reuse a copy encoded at a different quality.
    const key = `${compression}:${createHash('sha256').update(data).digest('hex')}`;
    if (this.cache.has(key)) {
      const cached = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached ?? original;
    }
    let pending = this.pending.get(key);
    if (!pending) {
      pending = optimizePng(data, compression).catch(() => null).then((image) => {
        // Unprofitable or unsupported inputs are also remembered, without retaining
        // their bytes. Tool continuations must not pay the encoder cost every step.
        this.remember(key, image);
        return image;
      }).finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return await pending ?? original;
  }

  private remember(key: string, image: TransportImage | null): void {
    if (image && image.data.byteLength > MAX_CACHE_BYTES) return;
    this.cache.set(key, image);
    this.cacheBytes += image?.data.byteLength ?? 0;
    while (this.cacheBytes > MAX_CACHE_BYTES || this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value!;
      this.cacheBytes -= this.cache.get(oldest)?.data.byteLength ?? 0;
      this.cache.delete(oldest);
    }
  }
}

async function optimizePng(data: Buffer, compression: Exclude<RuntimeImageCompression, 'original'>): Promise<TransportImage | null> {
  if (!isStaticPng(data)) return null;
  // Lazy loading keeps text-only turns independent of the native encoder. Encoding
  // runs on libvips workers, never as a synchronous task on the runtime event loop.
  const { default: sharp } = await import('sharp');
  const image = sharp(data, { limitInputPixels: MAX_INPUT_PIXELS });
  const metadata = await image.metadata();
  if (metadata.format !== 'png' || metadata.depth !== 'uchar'
    || (metadata.pages ?? 1) !== 1 || metadata.space !== 'srgb') return null;
  // Keep screenshot resolution and lossless alpha at every level. Modest encoder
  // effort keeps the first turn fast; cached copies serve later tool steps.
  const encoded = await image.keepMetadata()
    .webp(compression === 'lossless'
      ? { lossless: true, exact: true, effort: 1 }
      : { quality: LOSSY_WEBP_QUALITY[compression], alphaQuality: 100, smartSubsample: true,
        effort: compression === 'fast' ? 1 : 2 })
    .timeout({ seconds: 3 })
    .toBuffer();
  // Small savings do not justify a different wire representation or cache entry.
  return encoded.byteLength < data.byteLength * 0.9
    ? { data: encoded, type: 'image/webp' }
    : null;
}

function isStaticPng(data: Buffer): boolean {
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  // Some PNG decoders expose only APNG's first frame. Never silently flatten it.
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    if (length > data.length - offset - 12) return false;
    const kind = data.toString('ascii', offset + 4, offset + 8);
    if (kind === 'acTL') return false;
    if (kind === 'IEND') return true;
    offset += length + 12;
  }
  return false;
}
