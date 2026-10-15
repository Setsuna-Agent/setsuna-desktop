import { ThemeProvider } from '@openuidev/react-ui';
import { openUiTheme } from '@setsuna-desktop/renderer-ui/openui-theme';
import type { ReactNode } from 'react';
import { useAppThemeMode } from './bridge.js';
import '@openuidev/react-ui/components.css';

/** Optional entry: only apps that select OpenUI load its components and styles. */
export function OpenUiProvider({ children }: { children: ReactNode }) {
  const mode = useAppThemeMode();
  return <ThemeProvider mode={mode} lightTheme={openUiTheme}>{children}</ThemeProvider>;
}
