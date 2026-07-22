import type { BrowserWindow, Rectangle } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const desktopWindowStateVersion = 1;
const defaultSaveDebounceMs = 200;

export interface DesktopWindowState {
  bounds: Rectangle;
  maximized: boolean;
}

export interface DesktopWindowStateOptions {
  defaultHeight: number;
  defaultWidth: number;
  minHeight: number;
  minWidth: number;
}

export function loadDesktopWindowState(
  filePath: string,
  workAreas: Rectangle[],
  options: DesktopWindowStateOptions,
): DesktopWindowState {
  let storedValue: unknown;
  try {
    storedValue = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    storedValue = null;
  }
  return resolveDesktopWindowState(storedValue, workAreas, options);
}

export function resolveDesktopWindowState(
  storedValue: unknown,
  workAreas: Rectangle[],
  options: DesktopWindowStateOptions,
): DesktopWindowState {
  const displays = workAreas.filter(isUsableRectangle);
  const primaryWorkArea = displays[0] ?? {
    x: 0,
    y: 0,
    width: Math.max(options.defaultWidth, options.minWidth),
    height: Math.max(options.defaultHeight, options.minHeight),
  };
  const storedRecord = objectRecord(storedValue);
  const storedBounds = storedRecord?.version === desktopWindowStateVersion
    ? rectangleValue(storedRecord.bounds)
    : null;
  const targetWorkArea = storedBounds
    ? displayWithLargestIntersection(storedBounds, displays) ?? primaryWorkArea
    : primaryWorkArea;
  const requestedBounds = storedBounds ?? centeredDefaultBounds(primaryWorkArea, options);
  const width = clampDimension(requestedBounds.width, options.minWidth, targetWorkArea.width);
  const height = clampDimension(requestedBounds.height, options.minHeight, targetWorkArea.height);
  const shouldCenter = storedBounds !== null && intersectionArea(storedBounds, targetWorkArea) === 0;
  const x = shouldCenter
    ? targetWorkArea.x + Math.round((targetWorkArea.width - width) / 2)
    : clamp(requestedBounds.x, targetWorkArea.x, targetWorkArea.x + targetWorkArea.width - width);
  const y = shouldCenter
    ? targetWorkArea.y + Math.round((targetWorkArea.height - height) / 2)
    : clamp(requestedBounds.y, targetWorkArea.y, targetWorkArea.y + targetWorkArea.height - height);

  return {
    bounds: { x, y, width, height },
    maximized: storedRecord?.version === desktopWindowStateVersion && storedRecord.maximized === true,
  };
}

export function trackDesktopWindowState(
  window: BrowserWindow,
  filePath: string,
  debounceMs = defaultSaveDebounceMs,
): () => void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    saveTimer = null;
    if (window.isDestroyed()) return;
    const state = {
      version: desktopWindowStateVersion,
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    };
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.warn('[window-state] failed to persist desktop window bounds', error);
    }
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, Math.max(0, debounceMs));
    saveTimer.unref?.();
  };
  const flush = () => {
    if (saveTimer) clearTimeout(saveTimer);
    save();
  };
  const dispose = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    window.off('move', scheduleSave);
    window.off('resize', scheduleSave);
    window.off('maximize', scheduleSave);
    window.off('unmaximize', scheduleSave);
    window.off('close', flush);
    window.off('closed', dispose);
  };

  window.on('move', scheduleSave);
  window.on('resize', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', flush);
  window.once('closed', dispose);
  return dispose;
}

function centeredDefaultBounds(workArea: Rectangle, options: DesktopWindowStateOptions): Rectangle {
  const width = clampDimension(options.defaultWidth, options.minWidth, workArea.width);
  const height = clampDimension(options.defaultHeight, options.minHeight, workArea.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

function displayWithLargestIntersection(bounds: Rectangle, workAreas: Rectangle[]): Rectangle | null {
  let best: Rectangle | null = null;
  let bestArea = 0;
  for (const workArea of workAreas) {
    const area = intersectionArea(bounds, workArea);
    if (area <= bestArea) continue;
    best = workArea;
    bestArea = area;
  }
  return best;
}

function intersectionArea(left: Rectangle, right: Rectangle): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function rectangleValue(value: unknown): Rectangle | null {
  const record = objectRecord(value);
  if (!record) return null;
  const values = [record.x, record.y, record.width, record.height];
  if (!values.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  const [x, y, width, height] = values as number[];
  if (width <= 0 || height <= 0) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function isUsableRectangle(value: Rectangle): boolean {
  return Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

function clampDimension(value: number, minimum: number, available: number): number {
  return Math.min(Math.max(Math.round(value), minimum), Math.max(1, Math.round(available)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.round(value), minimum), Math.max(minimum, maximum));
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
