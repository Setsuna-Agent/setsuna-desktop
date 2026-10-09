export type ExtensionApiResult = { ok: true; result?: unknown } | { ok: false; error: string };

export const EXTENSION_UI_CHANNELS = {
  bootstrap: 'browser-extension-ui:bootstrap',
  call: 'browser-extension-ui:call',
  event: 'browser-extension-ui:event',
} as const;

export type ExtensionUiBootstrap = { sidePanel: boolean; browserAction: boolean };

export type ExtensionUiEvent =
  | { kind: 'actionClicked'; tab: ExtensionTab }
  | { kind: 'windowFocusChanged'; windowId: number }
  | { kind: 'panelOpened' | 'panelClosed'; windowId: number; tabId?: number; path: string };

export const EXTENSION_TABS_CHANNELS = {
  bootstrap: 'browser-extension-tabs:bootstrap',
  call: 'browser-extension-tabs:call',
  event: 'browser-extension-tabs:event',
} as const;

/** Native WebContents IDs are also Chromium's extension tab IDs. */
export interface ExtensionTab {
  id: number;
  windowId: number;
  index: number;
  active: boolean;
  highlighted: boolean;
  pinned: boolean;
  incognito: boolean;
  status: 'loading' | 'complete';
  url?: string;
  pendingUrl?: string;
  title?: string;
}

export type ExtensionTabReadQuery = {
  url?: string | string[]; title?: string; active?: boolean; highlighted?: boolean;
  currentWindow?: boolean; lastFocusedWindow?: boolean; windowId?: number;
};
/** Host selection overrides native focus only for owned browser guests. */
export type ExtensionTabReadDetails = Pick<ExtensionTab, 'id' | 'url' | 'title'>
  & Partial<Pick<ExtensionTab, 'windowId' | 'active' | 'highlighted'>>;

export type ExtensionTabEvent =
  | { kind: 'updated'; tabId: number; changeInfo: { status?: ExtensionTab['status']; url?: string }; tab: ExtensionTab }
  | { kind: 'removed'; tabId: number; removeInfo: { windowId: number; isWindowClosing: boolean } };

export const EXTENSION_SYSTEM_CHANNELS = {
  bootstrap: 'browser-extension-system:bootstrap',
  call: 'browser-extension-system:call',
  event: 'browser-extension-system:event',
} as const;

export type ExtensionSystemBootstrap = {
  debugger: boolean; contextMenus: boolean; downloads: boolean; webNavigation: boolean;
  nativeMessaging: boolean; scripting: boolean; cookies: boolean; bookmarks: boolean; storage: boolean;
  faviconUrl?: string;
  privacy?: boolean;
};
export type ExtensionPermissions = { permissions: string[]; origins: string[] };
export type ExtensionCookie = {
  name: string; value: string; domain: string; hostOnly: boolean; path: string;
  secure: boolean; httpOnly: boolean; session: boolean; expirationDate?: number;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'; storeId: string;
};
export type ExtensionCookieChange = {
  cookie: ExtensionCookie; removed: boolean;
  cause: 'explicit' | 'overwrite' | 'expired' | 'evicted' | 'expired_overwrite';
};
export type ExtensionDebuggee = { tabId: number; sessionId?: string };
export type ExtensionSystemEvent =
  | { kind: 'startup' }
  | { kind: 'debuggerEvent'; source: ExtensionDebuggee; method: string; params: unknown }
  | { kind: 'debuggerDetach'; source: ExtensionDebuggee; reason: 'target_closed' | 'canceled_by_user' }
  | { kind: 'command'; command: string; tab: ExtensionTab }
  | { kind: 'contextMenuClicked'; info: Record<string, unknown>; tab: ExtensionTab }
  | { kind: 'downloadCreated'; item: Record<string, unknown> }
  | { kind: 'downloadChanged'; delta: Record<string, unknown> }
  | { kind: 'navigationTargetCreated'; details: Record<string, unknown> }
  | { kind: 'navigationCommitted'; details: Record<string, unknown> }
  | { kind: 'cookieChanged'; changeInfo: ExtensionCookieChange }
  | { kind: 'permissionsAdded'; permissions: ExtensionPermissions }
  | { kind: 'permissionsRemoved'; permissions: ExtensionPermissions }
  | { kind: 'nativeMessage'; portId: string; message: unknown }
  | { kind: 'nativeDisconnect'; portId: string; error?: string };
