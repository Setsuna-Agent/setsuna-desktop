import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { createContext, useContext, type ReactNode } from 'react';
import type { WebDavSyncDesktopBridge } from '../contracts/index.js';

type WebDavSyncViewContextValue = Readonly<{
  bridge: WebDavSyncDesktopBridge | null;
  locale: string;
  t: RendererTranslate;
  ui: SettingsViewUi;
}>;

const WebDavSyncViewContext = createContext<WebDavSyncViewContextValue | null>(null);

export function WebDavSyncViewProvider({
  bridge,
  children,
  locale,
  translate,
  ui,
}: Readonly<{
  bridge: WebDavSyncDesktopBridge | null;
  children: ReactNode;
  locale: string;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  return (
    <WebDavSyncViewContext.Provider value={{ bridge, locale, t: translate, ui }}>
      {children}
    </WebDavSyncViewContext.Provider>
  );
}

export function useWebDavSyncView(): WebDavSyncViewContextValue {
  const value = useContext(WebDavSyncViewContext);
  if (!value) throw new Error('WebDAV sync view must be rendered inside its Feature provider.');
  return value;
}
