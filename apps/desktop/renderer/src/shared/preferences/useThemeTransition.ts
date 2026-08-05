import { useCallback, useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = 'light' | 'dark';

const storageKey = 'setusna-theme-mode';
export const THEME_CHANGE_EVENT_NAME = 'setsuna-theme-change';

type AnimatedDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
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
        applyThemeModePreference('system');
      }
    };
    media.addEventListener('change', handleSystemThemeChange);
    return () => media.removeEventListener('change', handleSystemThemeChange);
  }, []);

  const setThemeMode = useCallback((nextMode: ThemeMode) => {
    setMode(nextMode);
    applyThemeModePreference(nextMode);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT_NAME));
  }, []);

  const setThemeModeWithTransition = useCallback((nextMode: ThemeMode, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animatedDocument = document as AnimatedDocument;
    const apply = () => setThemeMode(nextMode);

    if (!animatedDocument.startViewTransition || prefersReducedMotion) {
      apply();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const clientX = 'clientX' in event ? event.clientX : rect.left + rect.width / 2;
    const clientY = 'clientY' in event ? event.clientY : rect.top + rect.height / 2;
    document.documentElement.style.setProperty('--desktop-theme-transition-x', `${clientX}px`);
    document.documentElement.style.setProperty('--desktop-theme-transition-y', `${clientY}px`);
    const transition = animatedDocument.startViewTransition(() => {
      flushSync(apply);
    });
    transition.finished.finally(() => {
      document.documentElement.style.removeProperty('--desktop-theme-transition-x');
      document.documentElement.style.removeProperty('--desktop-theme-transition-y');
    });
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
      if (getInitialThemeMode() === 'system') syncFromPreference();
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
  const saved = window.localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'system';
}

function applyThemeModePreference(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveThemeMode(mode);
  document.documentElement.dataset.themePreference = mode;
  window.localStorage.setItem(storageKey, mode);
}

function resolveThemeMode(mode: ThemeMode): ResolvedThemeMode {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

function readResolvedThemeMode(): ResolvedThemeMode {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
