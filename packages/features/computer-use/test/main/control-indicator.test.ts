import { EventEmitter } from 'node:events';
import type { Rectangle } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputerFrame, ComputerTarget } from '../../src/contracts/index.js';
import { ComputerControlIndicator } from '../../src/main/control-indicator.js';
import { controlIndicatorStopUrl } from '../../src/main/control-indicator-page.js';

const native = vi.hoisted(() => ({ create: vi.fn(), getAllDisplays: vi.fn(), getDisplayMatching: vi.fn(), dipToScreenRect: vi.fn() }));
vi.mock('electron', () => ({
  BrowserWindow: function (options: unknown) { return native.create(options); },
  screen: { getAllDisplays: native.getAllDisplays, getDisplayMatching: native.getDisplayMatching, dipToScreenRect: native.dipToScreenRect },
}));

class NativeWindow extends EventEmitter {
  constructor(public bounds: Rectangle = { x: 0, y: 0, width: 584, height: 76 }) { super(); }
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
  loadURL = vi.fn(async () => { queueMicrotask(() => this.emit('ready-to-show')); });
  showInactive = vi.fn();
  setBounds = vi.fn((bounds: Rectangle) => { this.bounds = { ...bounds }; });
  getBounds = () => ({ ...this.bounds });
  setMenu = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  setContentProtection = vi.fn();
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setHiddenInMissionControl = vi.fn();
  isDestroyed = () => this.destroyed;
  destroy = vi.fn(() => { this.destroyed = true; this.emit('closed'); });
}

const display = { id: 42, bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 680 } };
const target: Extract<ComputerTarget, { scope: 'primary-desktop' }> = { scope: 'primary-desktop', display: { ...display, scaleFactor: 2,
  inputBounds: { x: 0, y: 0, width: 2560, height: 1440 }, inputCoordinateSpace: 'windows-physical-pixels' } };
const instances: NativeWindow[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  instances.length = 0;
  native.getAllDisplays.mockReturnValue([display]);
  native.getDisplayMatching.mockReturnValue(display);
  native.create.mockImplementation((options: Rectangle) => { const window = new NativeWindow(options); instances.push(window); return window; });
});

function fixture() {
  const stopped = vi.fn();
  const indicator = new ComputerControlIndicator(() => 'zh-CN', stopped);
  const abort = new AbortController();
  return { indicator, abort, stopped, show: () => indicator.show(target, abort.signal) };
}

describe('native control indicator lifecycle', () => {
  it.each([{ scale: 1, width: 1280 }, { scale: 1.25, width: 800 }, { scale: 2, width: 1920 }])(
    'moves a dragged toolbar clear of clicks and scrolls without disabling stop: %j', async ({ scale, width }) => {
      native.dipToScreenRect.mockImplementation((_window, bounds: Rectangle) => ({
        x: bounds.x * scale, y: bounds.y * scale, width: bounds.width * scale, height: bounds.height * scale,
      }));
      const f = fixture(); await f.show(); const toolbar = instances[1]!;
      const frame: ComputerFrame = { ...target, display: { ...target.display, scaleFactor: scale,
        inputBounds: { x: 0, y: 0, width: 1280 * scale, height: 720 * scale } },
        kind: 'frame', sessionId: 'session', observationId: 'observation', capturedAt: 0,
        coordinateSpace: 'screenshot-pixels', width, height: width * 720 / 1280,
        dataUrl: 'data:image/png;base64,YWJj', size: 3, capture: { backend: 'electron-desktop-capturer', sourceDisplayId: '42',
          nearBlackFraction: 0, transparentFraction: 0, contrast: 255, interiorContrast: 255 } };
      f.indicator.prepareInput({ kind: 'click', x: 0, y: frame.height - 1 }, frame);
      expect(toolbar.setBounds).not.toHaveBeenCalled();
      for (const action of [
        { kind: 'click', x: width / 2, y: width / 4 },
        { kind: 'scroll', x: width / 2, y: width / 4, direction: 'down', amount: 1 },
      ] as const) {
        // Simulate a user drag after the screenshot, then aim inside that region.
        toolbar.bounds = { x: 400, y: 300, width: 584, height: 76 };
        f.indicator.prepareInput(action, frame);
        const after = toolbar.getBounds();
        const clickY = action.y * 720 / frame.height;
        expect(clickY >= after.y && clickY < after.y + after.height).toBe(false);
        expect(toolbar.setIgnoreMouseEvents).toHaveBeenCalledExactlyOnceWith(false);
        expect(toolbar.destroyed).toBe(false);
      }
      expect(f.stopped).not.toHaveBeenCalled();
      f.indicator.hide();
    },
  );

  it('rejects input if the OS does not move the toolbar out of the click path', async () => {
    native.dipToScreenRect.mockImplementation((_window, bounds: Rectangle) => bounds);
    const f = fixture(); await f.show(); const toolbar = instances[1]!;
    toolbar.bounds = { x: 0, y: 0, width: 584, height: 76 };
    toolbar.setBounds.mockImplementation(() => undefined);
    const frame = { ...target, width: 2560, height: 1440 } as ComputerFrame;
    expect(() => f.indicator.prepareInput({ kind: 'click', x: 20, y: 20 }, frame)).toThrow('No input was dispatched');
    expect(toolbar.setIgnoreMouseEvents).toHaveBeenCalledExactlyOnceWith(false);
    f.indicator.hide();
  });

  it('establishes input isolation and capture exclusion before showing the indicator', async () => {
    const f = fixture(); await f.show(); const window = instances[0]!; const toolbar = instances[1]!;
    expect(native.create).toHaveBeenCalledWith(expect.objectContaining({ show: false, focusable: false,
      webPreferences: expect.objectContaining({ sandbox: true, nodeIntegration: false, javascript: false }) }));
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(toolbar.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
    expect(window.setContentProtection).toHaveBeenCalledWith(true);
    expect(toolbar.setContentProtection).toHaveBeenCalledWith(true);
    expect(window.setContentProtection.mock.invocationCallOrder[0]).toBeLessThan(window.showInactive.mock.invocationCallOrder[0]!);
    expect(window.setIgnoreMouseEvents.mock.invocationCallOrder[0]).toBeLessThan(window.showInactive.mock.invocationCallOrder[0]!);
    await f.show(); expect(native.create).toHaveBeenCalledTimes(2);
    expect(toolbar.setBounds).not.toHaveBeenCalled(); // Observations preserve the user's dragged position.
    f.indicator.hide(); f.indicator.hide();
    expect(window.destroy).toHaveBeenCalledOnce(); expect(toolbar.destroy).toHaveBeenCalledOnce();
    expect(f.stopped).not.toHaveBeenCalled();
  });

  it.each(['abort', 'stop', 'closed'] as const)('cancels pending startup on %s and ignores a late first paint', async (reason) => {
    const f = fixture(); let loaded!: () => void;
    const window = new NativeWindow();
    window.loadURL.mockImplementation(() => new Promise<void>((resolve) => { loaded = resolve; }));
    native.create.mockReturnValueOnce(window);
    const showing = f.show(); const rejected = expect(showing).rejects.toThrow();
    if (reason === 'abort') f.abort.abort();
    else if (reason === 'stop') f.indicator.hide();
    else window.destroy();
    await rejected;
    loaded(); window.emit('ready-to-show');
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(instances[0]!.showInactive).not.toHaveBeenCalled();
    expect(window.destroyed).toBe(true);
    expect(instances[0]!.destroyed).toBe(true);
    expect(f.stopped).toHaveBeenCalledTimes(reason === 'closed' ? 1 : 0);
  });

  it('cleans up a failed page load before allowing another session', async () => {
    const f = fixture(); const window = new NativeWindow();
    window.loadURL.mockRejectedValue(new Error('load failed'));
    native.create.mockReturnValueOnce(window);
    await expect(f.show()).rejects.toThrow('load failed');
    expect(window.destroyed).toBe(true); expect(window.showInactive).not.toHaveBeenCalled();
    expect(instances[0]!.destroyed).toBe(true);
    await f.show(); expect(instances[1]!.showInactive).toHaveBeenCalledOnce();
    f.indicator.hide();
  });

  it.each(['render-process-gone', 'unresponsive', 'hide'])('revokes control if the indicator becomes unavailable: %s', async (event) => {
    const f = fixture(); await f.show(); const window = instances[0]!;
    (event === 'render-process-gone' ? window.webContents : window).emit(event);
    expect(f.stopped).toHaveBeenCalledExactlyOnceWith('indicator-unavailable');
    expect(window.destroyed).toBe(true); expect(instances[1]!.destroyed).toBe(true);
    f.indicator.hide(); expect(f.stopped).toHaveBeenCalledOnce();
  });

  it('follows the captured target window to another display and retires the old indicator', async () => {
    const f = fixture();
    const windowTarget: ComputerTarget = { scope: 'window', window: { id: '4:5:6', pid: 4, windowNumber: 5,
      application: 'Fixture', title: '', bounds: { x: 40, y: 40, width: 400, height: 300 } } };
    await f.indicator.show(windowTarget, f.abort.signal);
    expect(native.getDisplayMatching).toHaveBeenCalledWith(windowTarget.window.bounds);
    native.getDisplayMatching.mockReturnValue({ ...display, id: 43 });
    await f.indicator.show(windowTarget, f.abort.signal);
    expect(instances[0]!.destroyed).toBe(true); expect(instances[1]!.destroyed).toBe(true);
    expect(instances[2]!.showInactive).toHaveBeenCalledOnce(); expect(instances[3]!.showInactive).toHaveBeenCalledOnce();
    expect(f.stopped).not.toHaveBeenCalled();
    f.indicator.hide();
  });

  it('does not fall back to a different screen when the controlled display disappears', async () => {
    const f = fixture(); native.getAllDisplays.mockReturnValue([{ ...display, id: 43 }]);
    await expect(f.show()).rejects.toThrow('display is no longer available');
    expect(native.create).not.toHaveBeenCalled();
  });

  it('accepts only the active toolbar stop action and rejects unrelated or late navigation', async () => {
    const f = fixture(); await f.show();
    const navigate = (index: number, url: string) => {
      const event = { url, preventDefault: vi.fn() };
      instances[index]!.webContents.emit('will-navigate', event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    };
    navigate(0, controlIndicatorStopUrl);
    navigate(1, 'https://example.com');
    navigate(1, `${controlIndicatorStopUrl}?command=start`);
    expect(f.stopped).not.toHaveBeenCalled();
    f.stopped.mockImplementation(() => f.indicator.hide());
    navigate(1, controlIndicatorStopUrl);
    expect(f.stopped).toHaveBeenCalledExactlyOnceWith('user-stop');
    expect(instances.every((window) => window.destroyed)).toBe(true);
    navigate(1, controlIndicatorStopUrl);
    expect(f.stopped).toHaveBeenCalledOnce();
  });

  it('closes both layers if the toolbar fails while the border is still loading', async () => {
    const f = fixture(); const border = new NativeWindow();
    border.loadURL.mockImplementation(() => new Promise<void>(() => undefined));
    native.create.mockReturnValueOnce(border);
    const pending = f.show(); const rejected = expect(pending).rejects.toThrow();
    instances[0]!.webContents.emit('render-process-gone');
    await rejected;
    expect(border.destroyed).toBe(true); expect(instances[0]!.destroyed).toBe(true);
    expect(f.stopped).toHaveBeenCalledExactlyOnceWith('indicator-unavailable');
  });
});
