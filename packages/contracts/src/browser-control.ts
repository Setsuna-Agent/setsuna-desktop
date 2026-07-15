export const BROWSER_TABS_TOOL_NAME = 'browser_tabs';
export const BROWSER_SNAPSHOT_TOOL_NAME = 'browser_snapshot';
export const BROWSER_SCREENSHOT_TOOL_NAME = 'browser_screenshot';
export const BROWSER_CLICK_TOOL_NAME = 'browser_click';
export const BROWSER_TYPE_TOOL_NAME = 'browser_type';
export const BROWSER_SCROLL_TOOL_NAME = 'browser_scroll';
export const BROWSER_KEY_TOOL_NAME = 'browser_key';
export const BROWSER_NAVIGATE_TOOL_NAME = 'browser_navigate';
export const BROWSER_WAIT_TOOL_NAME = 'browser_wait';
export const DESKTOP_BROWSER_PARTITION = 'persist:setsuna-desktop-browser';

export type DesktopBrowserTab = {
  active: boolean;
  id: string;
  loading: boolean;
  title: string;
  url: string;
};

export type DesktopBrowserDeviceEmulation = {
  deviceScaleFactor: number;
  height: number;
  mobile: boolean;
  scale: number;
  userAgentProfile: DesktopBrowserDeviceUserAgentProfile;
  width: number;
};

export type DesktopBrowserDeviceUserAgentProfile =
  | 'android-phone'
  | 'desktop'
  | 'ios-phone'
  | 'ios-tablet'
  | 'windows-desktop';

export type DesktopBrowserScreenshot = {
  dataUrl: string;
  height: number;
  mimeType: 'image/png';
  size: number;
  width: number;
};

export type DesktopBrowserElement = {
  bounds?: DesktopBrowserBounds;
  checked?: boolean;
  clickable?: boolean;
  disabled?: boolean;
  href?: string;
  name: string;
  ref: string;
  role: string;
  selected?: boolean;
  tag: string;
  value?: string;
};

export type DesktopBrowserBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type DesktopBrowserKeyModifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export type DesktopBrowserSnapshot = {
  elements: DesktopBrowserElement[];
  text: string;
  title: string;
  url: string;
};

export type DesktopBrowserControlCommand =
  | { kind: 'open'; url: string }
  | { kind: 'tabs' }
  | { kind: 'snapshot'; maxElements?: number; tabId?: string }
  | { kind: 'screenshot'; tabId?: string }
  | { kind: 'click'; ref: string; tabId?: string }
  | { clear?: boolean; kind: 'type'; ref: string; submit?: boolean; tabId?: string; text: string }
  | { deltaY?: number; kind: 'scroll'; ref?: string; tabId?: string }
  | { key: string; kind: 'key'; modifiers?: DesktopBrowserKeyModifier[]; repeat?: number; tabId?: string }
  | { kind: 'navigate'; tabId?: string; url: string }
  | { kind: 'wait'; tabId?: string; text?: string; timeoutMs?: number };

export type DesktopBrowserControlResult =
  | { kind: 'tabs'; tabs: DesktopBrowserTab[] }
  | ({ kind: 'snapshot'; tabId: string } & DesktopBrowserSnapshot)
  | ({ kind: 'screenshot'; tabId: string; title: string; url: string } & DesktopBrowserScreenshot)
  | { kind: 'action'; message: string; tabId: string; url: string }
  | { kind: 'wait'; matched: boolean; tabId: string; url: string };
