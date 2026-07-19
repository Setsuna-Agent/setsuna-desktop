import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveDesktopWindowState,
  trackDesktopWindowState,
  type DesktopWindowStateOptions,
} from './desktop-window-state.js';

const options: DesktopWindowStateOptions = {
  defaultHeight: 860,
  defaultWidth: 1320,
  minHeight: 640,
  minWidth: 880,
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('desktop window state', () => {
  it('restores valid bounds on the display that contains them', () => {
    const state = resolveDesktopWindowState({
      version: 1,
      bounds: { x: 2140, y: 120, width: 1180, height: 760 },
      maximized: true,
    }, [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: 1920, y: 0, width: 1920, height: 1040 },
    ], options);

    expect(state).toEqual({
      bounds: { x: 2140, y: 120, width: 1180, height: 760 },
      maximized: true,
    });
  });

  it('recenters an off-screen window and clamps it to the current primary work area', () => {
    const state = resolveDesktopWindowState({
      version: 1,
      bounds: { x: 5000, y: -3000, width: 2400, height: 1600 },
      maximized: false,
    }, [
      { x: 0, y: 0, width: 1920, height: 1040 },
    ], options);

    expect(state).toEqual({
      bounds: { x: 0, y: 0, width: 1920, height: 1040 },
      maximized: false,
    });
  });

  it('uses a centered default for missing or malformed state', () => {
    const state = resolveDesktopWindowState({ version: 1, bounds: { width: 'bad' } }, [
      { x: 100, y: 40, width: 1920, height: 1040 },
    ], options);

    expect(state.bounds).toEqual({ x: 400, y: 130, width: 1320, height: 860 });
    expect(state.maximized).toBe(false);
  });

  it('flushes the latest normal bounds when the window closes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-window-state-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'window-state.json');
    const events = new EventEmitter();
    const window = Object.assign(events, {
      getNormalBounds: () => ({ x: 140, y: 90, width: 1460, height: 920 }),
      isDestroyed: () => false,
      isMaximized: () => true,
    }) as unknown as BrowserWindow;
    trackDesktopWindowState(window, filePath, 10_000);

    events.emit('resize');
    events.emit('close');
    events.emit('closed');

    await expect(readFile(filePath, 'utf8')).resolves.toContain('"width": 1460');
    await expect(readFile(filePath, 'utf8')).resolves.toContain('"maximized": true');
  });
});
