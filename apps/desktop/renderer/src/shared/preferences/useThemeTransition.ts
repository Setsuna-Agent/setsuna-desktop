import type { DesktopThemeMode } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { readBrowserStorageValue, writeBrowserStorageValue } from './browserStorage.js';

export type ThemeMode = DesktopThemeMode;
export type ResolvedThemeMode = 'light' | 'dark';

const storageKey = 'setusna-theme-mode';
export const THEME_CHANGE_EVENT_NAME = 'setsuna-theme-change';
let nativeThemeSync: { key: string; result: Promise<ResolvedThemeMode | null> } | undefined;
// matchMedia reflects explicit native overrides; keep the last actual system result separately.
let systemTheme: ResolvedThemeMode | undefined;

type AnimatedDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
};

export function useThemeTransition() {
  const [mode, setMode] = useState<ThemeMode>(() => getInitialThemeMode());

  useEffect(() => {
    applyThemeModePreference(mode);
  }, [mode]);

  useEffect(() => {
    const handleThemeChange = () => setMode(getInitialThemeMode());
    window.addEventListener(THEME_CHANGE_EVENT_NAME, handleThemeChange);
    window.addEventListener('storage', handleThemeChange);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT_NAME, handleThemeChange);
      window.removeEventListener('storage', handleThemeChange);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      if (getInitialThemeMode() === 'system') {
        systemTheme = media.matches ? 'dark' : 'light';
        applyThemeModePreference('system');
      }
    };
    media.addEventListener('change', handleSystemThemeChange);
    return () => media.removeEventListener('change', handleSystemThemeChange);
  }, []);

  const setThemeMode = useCallback((nextMode: ThemeMode) => {
    const apply = () => {
      setMode(nextMode);
      applyThemeModePreference(nextMode);
      window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT_NAME));
    };
    if (nextMode === 'system') {
      // Resolve after releasing Electron's override; a newer choice must win over this reply.
      writeBrowserStorageValue(storageKey, nextMode);
      void syncNativeTheme(nextMode, readResolvedThemeMode()).then(() => {
        if (getInitialThemeMode() === nextMode) apply();
      });
      return;
    }
    apply();
  }, []);

  const setThemeModeWithTransition = useCallback((nextMode: ThemeMode, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    const root = document.documentElement;
    // Settings and the sidebar share one root transition; ignore overlapping requests.
    if (root.dataset.themeTransition) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animatedDocument = document as AnimatedDocument;
    const apply = () => setThemeMode(nextMode);

    // System appearance resolves asynchronously; avoid blending snapshots over a changing native backing.
    if (nextMode === 'system' || resolveThemeMode(nextMode) === readResolvedThemeMode()
      || !animatedDocument.startViewTransition || prefersReducedMotion) {
      apply();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    // Button coordinates also give keyboard activation the correct reveal origin.
    root.style.setProperty('--desktop-theme-transition-origin', `${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px`);
    root.dataset.themeTransition = 'circle';
    const transition = animatedDocument.startViewTransition(async () => {
      flushSync(apply);
      // The opaque old dark snapshot covers the native backing change before light is revealed.
      if (readResolvedThemeMode() === 'light') await syncNativeTheme(nextMode, 'light');
    });
    const cleanup = () => {
      delete root.dataset.themeTransition;
      root.style.removeProperty('--desktop-theme-transition-origin');
      // Entering dark mode updates the backing only after the opaque new view covers it.
      applyThemeModePreference(getInitialThemeMode());
    };
    // A skipped transition can reject; both outcomes must release the shared guard.
    void transition.finished.then(cleanup, cleanup);
  }, [setThemeMode]);

  const toggleWithTransition = useCallback((event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    setThemeModeWithTransition(resolveThemeMode(mode) === 'dark' ? 'light' : 'dark', event);
  }, [mode, setThemeModeWithTransition]);

  return { mode, setThemeMode, setThemeModeWithTransition, toggleWithTransition };
}

export function initializeThemePreference(): void {
  // 首次绘制前解析系统模式，使 CSS 只有一个主题真源。
  applyThemeModePreference(getInitialThemeMode());
}

/** Keep consumers synchronized even when the settings page is not mounted. */
export function useResolvedThemeMode(): ResolvedThemeMode {
  const [resolvedMode, setResolvedMode] = useState<ResolvedThemeMode>(() => readResolvedThemeMode());

  useEffect(() => {
    const syncFromPreference = () => {
      applyThemeModePreference(getInitialThemeMode());
      setResolvedMode(readResolvedThemeMode());
    };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncFromSystem = () => {
      if (getInitialThemeMode() === 'system') {
        systemTheme = media.matches ? 'dark' : 'light';
        syncFromPreference();
      }
    };
    window.addEventListener(THEME_CHANGE_EVENT_NAME, syncFromPreference);
    window.addEventListener('storage', syncFromPreference);
    media.addEventListener('change', syncFromSystem);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT_NAME, syncFromPreference);
      window.removeEventListener('storage', syncFromPreference);
      media.removeEventListener('change', syncFromSystem);
    };
  }, []);

  return resolvedMode;
}

function getInitialThemeMode(): ThemeMode {
  const saved = readBrowserStorageValue(storageKey);
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'system';
}

function applyThemeModePreference(mode: ThemeMode): void {
  const resolved = resolveThemeMode(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = mode;
  writeBrowserStorageValue(storageKey, mode);

  if (document.documentElement.dataset.themeTransition && resolved === 'dark') return;
  // Initialization stays non-blocking; user-triggered synchronization is awaited by its caller.
  void syncNativeTheme(mode, resolved);
}

function syncNativeTheme(mode: ThemeMode, resolved: ResolvedThemeMode): Promise<ResolvedThemeMode | null> {
  const controls = window.setsunaDesktop?.windowControls;
  if (!controls?.setThemeMode) return Promise.resolve(null);
  const key = `${mode}:${resolved}`;
  if (nativeThemeSync?.key === key) return nativeThemeSync.result;
  // Preserve "system" instead of locking native appearance to the current resolved color.
  const result = controls.setThemeMode(mode).then((nativeResolved) => {
    if (mode === 'system' && nativeResolved && nativeThemeSync?.key === key) {
      nativeThemeSync.key = `${mode}:${nativeResolved}`;
      systemTheme = nativeResolved;
      if (getInitialThemeMode() === 'system' && readResolvedThemeMode() !== nativeResolved) {
        applyThemeModePreference('system');
        window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT_NAME));
      }
    }
    return nativeResolved;
  }).catch(() => {
    if (nativeThemeSync?.key === key) nativeThemeSync = undefined;
    return null;
  });
  nativeThemeSync = { key, result };
  return result;
}

function resolveThemeMode(mode: ThemeMode): ResolvedThemeMode {
  if (mode === 'system') {
    return systemTheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  return mode;
}

function readResolvedThemeMode(): ResolvedThemeMode {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
