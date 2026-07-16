import { useCallback, useEffect, useState } from 'react';

export const sidebarBackgroundOptions = [
  { value: 'soft', label: '柔和', lightSwatch: '#f7f7f7', darkSwatch: '#282b2e' },
  { value: 'plain', label: '素净', lightSwatch: '#ffffff', darkSwatch: '#202020' },
  { value: 'contrast', label: '层次', lightSwatch: '#edf1f5', darkSwatch: '#30343a' },
] as const;

export type SidebarBackgroundStyle = typeof sidebarBackgroundOptions[number]['value'];

const defaultSidebarBackgroundStyle: SidebarBackgroundStyle = 'soft';
const sidebarBackgroundStorageKey = 'setsuna-sidebar-background-style';
const sidebarBackgroundChangeEventName = 'setsuna-sidebar-background-change';
const legacySidebarOpacityStorageKey = 'setsuna-sidebar-opacity';

export function useSidebarBackgroundPreference() {
  const [sidebarBackgroundStyle, setSidebarBackgroundStyleState] = useState<SidebarBackgroundStyle>(() => getInitialSidebarBackgroundStyle());

  useEffect(() => {
    applySidebarBackgroundStyle(sidebarBackgroundStyle);
  }, [sidebarBackgroundStyle]);

  useEffect(() => {
    const handleSidebarBackgroundChange = () => setSidebarBackgroundStyleState(getInitialSidebarBackgroundStyle());
    window.addEventListener(sidebarBackgroundChangeEventName, handleSidebarBackgroundChange);
    window.addEventListener('storage', handleSidebarBackgroundChange);
    return () => {
      window.removeEventListener(sidebarBackgroundChangeEventName, handleSidebarBackgroundChange);
      window.removeEventListener('storage', handleSidebarBackgroundChange);
    };
  }, []);

  const setSidebarBackgroundStyle = useCallback((nextStyle: SidebarBackgroundStyle) => {
    window.localStorage.setItem(sidebarBackgroundStorageKey, nextStyle);
    setSidebarBackgroundStyleState(nextStyle);
    applySidebarBackgroundStyle(nextStyle);
    window.dispatchEvent(new CustomEvent(sidebarBackgroundChangeEventName));
  }, []);

  return { sidebarBackgroundStyle, setSidebarBackgroundStyle };
}

export function initializeSidebarBackgroundPreference(): void {
  applySidebarBackgroundStyle(getInitialSidebarBackgroundStyle());
  // Opacity is no longer part of the appearance model; remove it so old installs
  // cannot accidentally reintroduce a translucent window substrate.
  window.localStorage.removeItem(legacySidebarOpacityStorageKey);
}

function getInitialSidebarBackgroundStyle(): SidebarBackgroundStyle {
  const saved = window.localStorage.getItem(sidebarBackgroundStorageKey);
  return sidebarBackgroundOptions.some((option) => option.value === saved)
    ? saved as SidebarBackgroundStyle
    : defaultSidebarBackgroundStyle;
}

function applySidebarBackgroundStyle(style: SidebarBackgroundStyle): void {
  document.documentElement.dataset.sidebarBackgroundStyle = style;
}
