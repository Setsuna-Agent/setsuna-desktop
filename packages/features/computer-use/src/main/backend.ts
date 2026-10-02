import type { ComputerAction, ComputerDisplay, ComputerFrame, ComputerImage, ComputerTarget, ComputerWindows } from '../contracts/index.js';

/** Raised only before any input is dispatched; the session can safely capture again. */
export class StaleComputerObservationError extends Error {}

export interface ComputerBackend {
  windows(signal: AbortSignal): Promise<ComputerWindows>;
  start(sessionId: string, windowId: string | undefined, signal: AbortSignal): Promise<ComputerTarget>;
  capture(target: ComputerTarget, signal: AbortSignal): Promise<ComputerImage & ComputerTarget>;
  action(action: ComputerAction, frame: ComputerFrame, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}
export type DesktopInputFrame = { display: ComputerDisplay; width: number; height: number };
export interface ComputerDriver {
  start(sessionId: string, signal: AbortSignal): Promise<void>;
  action(action: ComputerAction, frame: DesktopInputFrame, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}
export interface ComputerCapture {
  capture(display: ComputerDisplay, signal: AbortSignal): Promise<ComputerImage>;
}

/** Windows retains its desktop input adapter. macOS never enters this backend. */
export class DesktopComputerBackend implements ComputerBackend {
  constructor(private readonly driver: ComputerDriver, private readonly images: ComputerCapture, private readonly display: () => ComputerDisplay) {}
  async windows(): Promise<ComputerWindows> { return { kind: 'windows', mode: 'foreground-desktop', windows: [] }; }
  async start(sessionId: string, windowId: string | undefined, signal: AbortSignal): Promise<ComputerTarget> {
    if (windowId !== undefined) throw new Error('Window background control is currently available on macOS only.');
    const display = this.display();
    await this.driver.start(sessionId, signal);
    return { scope: 'primary-desktop', display };
  }
  private check(target: ComputerTarget): asserts target is Extract<ComputerTarget, { scope: 'primary-desktop' }> {
    if (target.scope !== 'primary-desktop' || JSON.stringify(this.display()) !== JSON.stringify(target.display)) throw new Error('Display geometry changed; start a new desktop session.');
  }
  async capture(target: ComputerTarget, signal: AbortSignal): Promise<ComputerImage & ComputerTarget> {
    this.check(target);
    const image = await this.images.capture(target.display, signal);
    this.check(target);
    return { ...image, ...target };
  }
  async action(action: ComputerAction, frame: ComputerFrame, signal: AbortSignal): Promise<void> {
    this.check(frame);
    await this.driver.action(action, frame, signal);
  }
  stop(): Promise<void> { return this.driver.stop(); }
}
