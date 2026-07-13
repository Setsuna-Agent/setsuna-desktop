import { useCallback, useEffect, useState } from 'react';

const defaultSidebarOpacity = 100;
const translucentSidebarOpacity = 50;
const sidebarOpacityStorageKey = 'setsuna-sidebar-opacity';
const sidebarOpacityChangeEventName = 'setsuna-sidebar-opacity-change';

export function useSidebarOpacityPreference() {
  const [sidebarOpacity, setSidebarOpacityState] = useState(() => getInitialSidebarOpacity());

  useEffect(() => {
    applySidebarOpacity(sidebarOpacity);
  }, [sidebarOpacity]);

  useEffect(() => {
    const handleOpacityChange = () => setSidebarOpacityState(getInitialSidebarOpacity());
    window.addEventListener(sidebarOpacityChangeEventName, handleOpacityChange);
    window.addEventListener('storage', handleOpacityChange);
    return () => {
      window.removeEventListener(sidebarOpacityChangeEventName, handleOpacityChange);
      window.removeEventListener('storage', handleOpacityChange);
    };
  }, []);

  const setSidebarTransparencyEnabled = useCallback((enabled: boolean) => {
    const nextOpacity = enabled ? translucentSidebarOpacity : defaultSidebarOpacity;
    window.localStorage.setItem(sidebarOpacityStorageKey, String(nextOpacity));
    setSidebarOpacityState(nextOpacity);
    applySidebarOpacity(nextOpacity);
    window.dispatchEvent(new CustomEvent(sidebarOpacityChangeEventName));
  }, []);

  return {
    sidebarTransparencyEnabled: sidebarOpacity === translucentSidebarOpacity,
    setSidebarTransparencyEnabled,
  };
}

export function initializeSidebarOpacityPreference(): void {
  applySidebarOpacity(getInitialSidebarOpacity());
}

function getInitialSidebarOpacity(): number {
  if (typeof window === 'undefined') return defaultSidebarOpacity;
  const saved = window.localStorage.getItem(sidebarOpacityStorageKey);
  return saved === null ? defaultSidebarOpacity : normalizeSidebarOpacity(Number(saved));
}

function normalizeSidebarOpacity(value: number): number {
  if (!Number.isFinite(value)) return defaultSidebarOpacity;
  return value < defaultSidebarOpacity ? translucentSidebarOpacity : defaultSidebarOpacity;
}

function applySidebarOpacity(value: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--app-sidebar-opacity', `${value}%`);
}
