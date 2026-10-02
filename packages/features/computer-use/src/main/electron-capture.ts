import { desktopCapturer, type DesktopCapturerSource } from 'electron';
import type { ComputerDisplay, ComputerCaptureMetadata } from '../contracts/index.js';
import type { ComputerCapture } from './backend.js';

// Keep the model-facing image within a predictable resolution. Input remains
// bound to the actual returned image and physical display geometry.
const MAX_SCREENSHOT_EDGE = 1920;
function screenshotSize(width: number, height: number) {
  const scale = Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Diagnostic heuristics only: pixel darkness cannot prove a permission failure. */
export function assessCapture(pixels: Buffer, width: number, height: number) {
  if (pixels.length !== width * height * 4 || !pixels.length) throw new Error('Invalid desktop sample.');
  let dark = 0; let transparent = 0; let min = 255; let max = 0; let innerMin = 255; let innerMax = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    min = Math.min(min, value); max = Math.max(max, value);
    if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 8) dark++;
    if (pixels[i + 3] < 240) transparent++;
    if (x >= width / 8 && x < width * 7 / 8 && y >= height / 8 && y < height * 7 / 8) {
      innerMin = Math.min(innerMin, value); innerMax = Math.max(innerMax, value);
    }
  }
  const metrics = { nearBlackFraction: dark / (width * height), transparentFraction: transparent / (width * height), contrast: max - min, interiorContrast: innerMax - innerMin };
  // Color statistics aid diagnosis; legitimate dark/blank applications must not
  // be mistaken for capture failure. Decoding and display geometry are checked below.
  return metrics;
}

/** Electron main captures in memory; the input helper has no capture protocol. */
export class ElectronComputerCapture implements ComputerCapture {
  private inFlight = false;
  async capture(display: ComputerDisplay, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.inFlight) throw new Error('Previous desktop capture is still completing.');
    this.inFlight = true;
    let abort: () => void = () => undefined;
    try {
      const capture = Promise.resolve().then(() => {
        signal.throwIfAborted();
        return desktopCapturer.getSources({
        types: ['screen'], fetchWindowIcons: false,
        thumbnailSize: screenshotSize(display.bounds.width * display.scaleFactor, display.bounds.height * display.scaleFactor),
        });
      }).finally(() => { this.inFlight = false; });
      const sources = await Promise.race([capture, new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason ?? new Error('Desktop capture cancelled.'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      })]);
      signal.throwIfAborted();
      return this.decode(sources, display);
    } catch (error) {
      // Electron can reject with a string when the desktop becomes unavailable
      // (for example during UAC). Preserve it across the JSON control bridge.
      throw error instanceof Error ? error : new Error(`Desktop capture failed: ${typeof error === 'string' ? error : 'Unknown capture error.'}`);
    } finally { signal.removeEventListener('abort', abort); }
  }
  private decode(sources: DesktopCapturerSource[], display: ComputerDisplay) {
    // Names, array positions and screen:ZZ:0 are not OS display identities.
    const matches = sources.filter((source) => source.display_id === String(display.id));
    if (matches.length !== 1) throw new Error('Desktop capture display identity is unavailable or changed.');
    const source = matches[0];
    let image = source.thumbnail;
    let { width, height } = image.getSize();
    if (image.isEmpty() || width <= 0 || height <= 0 || width > 32768 || height > 32768) throw new Error('Desktop image cannot be decoded.');
    // getSources does not guarantee the requested resolution. Accept uniform
    // resizing, bind actual dimensions, and reject cropped/distorted geometry.
    if (Math.abs(width / height - display.bounds.width / display.bounds.height) > 2 / height) throw new Error('Desktop capture aspect ratio does not match the authorized display.');
    // Electron may ignore thumbnailSize. Encode and report the same bounded image.
    if (Math.max(width, height) > MAX_SCREENSHOT_EDGE) {
      image = image.resize({ ...screenshotSize(width, height), quality: 'best' });
      ({ width, height } = image.getSize());
    }
    const sample = image.resize({ width: 64, height: 64, quality: 'good' });
    let metrics: ReturnType<typeof assessCapture>;
    try { metrics = assessCapture(sample.toBitmap(), 64, 64); }
    catch (error) { throw new Error(`electron-desktop-capturer display=${source.display_id} image=${width}x${height}: ${error instanceof Error ? error.message : 'Capture assessment failed.'}`); }
    const bytes = image.toPNG({ scaleFactor: 1 });
    if (!bytes.length || bytes.length > 18_000_000 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Desktop image encoding failed or exceeded the size limit.');
    const capture: ComputerCaptureMetadata = { backend: 'electron-desktop-capturer', sourceDisplayId: source.display_id, ...metrics };
    return { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width, height, size: bytes.length, capture };
  }
}
