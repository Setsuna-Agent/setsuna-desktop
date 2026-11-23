import { isValidWorkspaceEntryName } from '@setsuna-desktop/contracts';
import { isDesignDocumentPath, parseDesignWorkspace, type DesignWorkspace } from '@setsuna-desktop/feature-design/contracts';
import { useEffect, useMemo, useState } from 'react';
import type { DesignWorkspaceLocation } from '../../composition/design/DesignFeatureBoundary.js';
import { getDesktopPlatform } from '../../shared/lib/desktopPlatform.js';
import { readSessionRecord, writeSessionRecord } from '../../shared/preferences/sessionStorage.js';
import type { MainView } from '../types.js';

function parseScope(value: unknown): DesignWorkspace | undefined {
  try { return parseDesignWorkspace(value); } catch { return undefined; }
}

function restoredDraftPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !isDesignDocumentPath(value) || value.includes('\0')) return;
  const windows = getDesktopPlatform() === 'win32';
  const path = windows ? value.replace(/\\/gu, '/') : value;
  // An existing macOS entry can contain backslashes, colons and Windows device names.
  if (path.split('/').every((part) => windows ? isValidWorkspaceEntryName(part) : part.length > 0 && part !== '.' && part !== '..')) return path;
}

function readDesignSession(windowKey: string | null) {
  const value = readSessionRecord(windowKey, 'selection', 'design');
  if (!value || typeof value !== 'object') return;
  const { active, location } = value as { active?: unknown; location?: Partial<Record<keyof DesignWorkspaceLocation, unknown>> | null };
  const scope = parseScope(location);
  const { path, homeFilter } = location ?? {};
  const draftPath = restoredDraftPath(path);
  const filter = parseScope(homeFilter);
  const restoredLocation: DesignWorkspaceLocation | null = draftPath && scope ? { ...scope, path: draftPath, ...(filter ? { homeFilter: filter } : {}) }
    : path === undefined ? scope ?? null : filter ?? null;
  return { active: active === true, location: restoredLocation };
}

/** Restore one local record after window identity is available, without waiting for any design files. */
export function useDesignWindowSession(windowKey: string | null, viewOverride: MainView | undefined, explicitThread: boolean) {
  const saved = useMemo(() => readDesignSession(windowKey), [windowKey]);
  const [locationOverride, setDesignLocation] = useState<DesignWorkspaceLocation | null>();
  const designLocation: DesignWorkspaceLocation | null = locationOverride === undefined ? saved?.location ?? null : locationOverride;
  const activeView = viewOverride ?? (saved?.active && !explicitThread ? 'design' : 'chat');
  const designActive = activeView === 'design';
  useEffect(() => {
    if (windowKey) writeSessionRecord(windowKey, 'selection', 'design', { active: designActive, location: designLocation });
  }, [designActive, designLocation, windowKey]);
  return { activeView, designLocation, setDesignLocation };
}
