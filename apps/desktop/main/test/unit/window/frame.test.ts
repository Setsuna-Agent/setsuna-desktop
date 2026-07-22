import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerWindowsTitlebarDoubleClick, toggleWindowMaximized } from '../../../src/window/frame.js';

describe('window frame interactions', () => {
  it('toggles between maximized and restored states', () => {
    let maximized = false;
    const window = {
      isMaximized: vi.fn(() => maximized),
      maximize: vi.fn(() => { maximized = true; }),
      unmaximize: vi.fn(() => { maximized = false; }),
    };

    expect(toggleWindowMaximized(window)).toBe(true);
    expect(window.maximize).toHaveBeenCalledOnce();

    expect(toggleWindowMaximized(window)).toBe(false);
    expect(window.unmaximize).toHaveBeenCalledOnce();
  });

  it('maximizes a transparent Windows window for its titlebar system command', async () => {
    let callback: ((wParam: Buffer, lParam: Buffer) => void) | undefined;
    const window = {
      hookWindowMessage: vi.fn((message, nextCallback) => {
        if (message === 0x0112) callback = nextCallback;
      }),
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
    } as unknown as BrowserWindow;

    registerWindowsTitlebarDoubleClick(window, 'win32');
    expect(window.hookWindowMessage).toHaveBeenCalledWith(0x0112, expect.any(Function));

    // Windows 保留 wParam 的低四位，因此必须忽略这些位。
    callback?.(windowsParameter(0xf032), Buffer.alloc(8));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(window.maximize).toHaveBeenCalledOnce();
  });

  it('restores a maximized transparent Windows window for its titlebar system command', async () => {
    let callback: ((wParam: Buffer, lParam: Buffer) => void) | undefined;
    const window = {
      hookWindowMessage: vi.fn((message, nextCallback) => {
        if (message === 0x0112) callback = nextCallback;
      }),
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => true),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
    } as unknown as BrowserWindow;

    registerWindowsTitlebarDoubleClick(window, 'win32');
    callback?.(windowsParameter(0xf122), Buffer.alloc(8));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(window.unmaximize).toHaveBeenCalledOnce();
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it('treats a repeated maximize command as a titlebar restore toggle', async () => {
    let callback: ((wParam: Buffer, lParam: Buffer) => void) | undefined;
    const window = {
      hookWindowMessage: vi.fn((message, nextCallback) => {
        if (message === 0x0112) callback = nextCallback;
      }),
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => true),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
    } as unknown as BrowserWindow;

    registerWindowsTitlebarDoubleClick(window, 'win32');
    callback?.(windowsParameter(0xf032), Buffer.alloc(8));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(window.unmaximize).toHaveBeenCalledOnce();
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it('falls back to a native caption double click when Windows omits the restore command', async () => {
    let callback: ((wParam: Buffer, lParam: Buffer) => void) | undefined;
    const window = {
      hookWindowMessage: vi.fn((message, nextCallback) => {
        if (message === 0x00a3) callback = nextCallback;
      }),
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => true),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
    } as unknown as BrowserWindow;

    registerWindowsTitlebarDoubleClick(window, 'win32');
    callback?.(windowsParameter(2), Buffer.alloc(8));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(window.unmaximize).toHaveBeenCalledOnce();
  });

  it('ignores unrelated Windows system commands', async () => {
    let callback: ((wParam: Buffer, lParam: Buffer) => void) | undefined;
    const window = {
      hookWindowMessage: vi.fn((message, nextCallback) => {
        if (message === 0x0112) callback = nextCallback;
      }),
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
    } as unknown as BrowserWindow;

    registerWindowsTitlebarDoubleClick(window, 'win32');
    callback?.(windowsParameter(0xf060), Buffer.alloc(8));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(window.maximize).not.toHaveBeenCalled();
  });
});

function windowsParameter(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}
