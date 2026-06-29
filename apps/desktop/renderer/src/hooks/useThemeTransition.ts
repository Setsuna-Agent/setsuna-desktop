import { useCallback, useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';

export type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedThemeMode = 'light' | 'dark';

const storageKey = 'setusna-theme-mode';
const themeChangeEventName = 'setsuna-theme-change';

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
    window.addEventListener(themeChangeEventName, handleThemeChange);
    window.addEventListener('storage', handleThemeChange);
    return () => {
      window.removeEventListener(themeChangeEventName, handleThemeChange);
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
    window.dispatchEvent(new CustomEvent(themeChangeEventName));
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
