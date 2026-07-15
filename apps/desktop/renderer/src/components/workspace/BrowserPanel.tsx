import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, RefreshCw, X } from 'lucide-react';
import type { DidFailLoadEvent, PageFaviconUpdatedEvent, PageTitleUpdatedEvent, WebviewTag } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '@setsuna-desktop/contracts';
import { BrowserAddressBar } from './BrowserAddressBar.js';
import { BrowserDeviceToolbar } from './BrowserDeviceToolbar.js';
import { BrowserDeviceViewport } from './BrowserDeviceViewport.js';
import { BrowserTabStrip } from './BrowserTabStrip.js';
import { useBrowserTabCommands, useBrowserTabsHeaderPortal } from './BrowserTabsHeaderPortal.js';
import { BrowserWindowMenu } from './BrowserWindowMenu.js';
import { useBrowserScreenshot, type BrowserScreenshotAttachmentHandler } from './useBrowserScreenshot.js';
import { WorkspaceResizeHandle } from './WorkspaceResizeHandle.js';
import {
  createDefaultBrowserDeviceEmulation,
  toDesktopBrowserDeviceEmulation,
  type BrowserDeviceEmulationState,
} from './browserDeviceEmulation.js';
import type { BrowserOpenRequest } from '../../utils/runtimeBrowserActions.js';

const browserHomeUrl = 'https://www.bing.com/';
// Electron parses webview boolean attributes by presence, while React only emits
// custom-element attributes reliably when their runtime value is a string.
const enabledWebviewBooleanAttribute = 'true' as unknown as boolean;

type BrowserTab = {
  canGoBack: boolean;
  canGoForward: boolean;
  deviceEmulation: BrowserDeviceEmulationState;
  draftUrl: string;
  error: string | null;
  faviconUrl: string | null;
  id: string;
  initialUrl: string;
  loading: boolean;
  title: string;
  url: string;
  zoomFactor: number;
};

export function BrowserPanel({
  hidden,
  openRequest,
  onResizeStep,
  onResizeStart,
  onScreenshotAttachment,
  resizeMax,
  resizeMin,
  resizeValue,
}: {
  hidden: boolean;
  openRequest?: BrowserOpenRequest | null;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onScreenshotAttachment?: BrowserScreenshotAttachmentHandler;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}) {
  const tabSequenceRef = useRef(1);
  const handledOpenRequestIdRef = useRef(openRequest?.id ?? null);
  const webviewsRef = useRef<Map<string, WebviewTag>>(new Map());
  const { host: tabsHeaderHost } = useBrowserTabsHeaderPortal();
  const { registerNewTabHandler } = useBrowserTabCommands();
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [createBrowserTab(1, openRequest?.url)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '');
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const {
    captureScreenshot,
    capturing: screenshotCapturing,
    notice: screenshotNotice,
  } = useBrowserScreenshot({
    activeTabId: activeTab?.id ?? null,
    onAttachment: onScreenshotAttachment,
  });

  const updateTab = useCallback((tabId: string, patch: Partial<BrowserTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const openTab = useCallback((url = browserHomeUrl) => {
    tabSequenceRef.current += 1;
    const tab = createBrowserTab(tabSequenceRef.current, url);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }, []);

  useEffect(() => registerNewTabHandler(openTab), [openTab, registerNewTabHandler]);

  useEffect(() => {
    void window.setsunaDesktop?.browser.setActiveTab(activeTab?.id ?? null);
  }, [activeTab?.id]);

  useEffect(() => {
    if (!openRequest || handledOpenRequestIdRef.current === openRequest.id) return;
    handledOpenRequestIdRef.current = openRequest.id;
    openTab(openRequest.url);
  }, [openRequest, openTab]);

  const closeTab = useCallback((tabId: string) => {
    setTabs((current) => {
      const closingIndex = current.findIndex((tab) => tab.id === tabId);
      const remaining = current.filter((tab) => tab.id !== tabId);
      if (!remaining.length) {
        tabSequenceRef.current += 1;
        const replacement = createBrowserTab(tabSequenceRef.current);
        setActiveTabId(replacement.id);
        return [replacement];
      }
      if (activeTabId === tabId) {
        setActiveTabId(remaining[Math.min(Math.max(0, closingIndex), remaining.length - 1)]?.id ?? remaining[0]!.id);
      }
      return remaining;
    });
  }, [activeTabId]);

  const selectTab = useCallback((tabId: string) => setActiveTabId(tabId), []);

  const navigate = () => {
    if (!activeTab) return;
    const url = normalizeBrowserInput(activeTab.draftUrl);
    const webview = webviewsRef.current.get(activeTab.id);
    updateTab(activeTab.id, {
      draftUrl: url,
      error: null,
      ...(webview ? {} : { initialUrl: url }),
      loading: true,
      url,
    });
    if (webview) {
      void applyBrowserDeviceEmulation(activeTab.id, activeTab.deviceEmulation)
        .catch(() => false)
        .then(() => webview.loadURL(url))
        .catch((error) => {
          if (isAbortedNavigationError(error)) return;
          updateTab(activeTab.id, { error: error instanceof Error ? error.message : String(error), loading: false });
        });
    }
  };

  const navigateHistory = (direction: 'back' | 'forward') => {
    if (!activeTab) return;
    const webview = webviewsRef.current.get(activeTab.id);
    if (!webview) return;
    if (direction === 'back' && webview.canGoBack()) webview.goBack();
    if (direction === 'forward' && webview.canGoForward()) webview.goForward();
  };

  const reload = () => {
    if (!activeTab) return;
    const webview = webviewsRef.current.get(activeTab.id);
    if (!webview) return;
    if (activeTab.loading) webview.stop();
    else {
      // The UA/Client-Hints override is asynchronous. Apply it before navigation
      // so a refresh immediately after selecting a device cannot use desktop headers.
      void applyBrowserDeviceEmulation(activeTab.id, activeTab.deviceEmulation)
        .catch(() => false)
        .then(() => {
          try {
            webview.reload();
          } catch {
            // The guest may detach while the main-process override is being applied.
          }
        });
    }
  };

  const printActivePage = () => {
    if (!activeTab) return;
    const webview = webviewsRef.current.get(activeTab.id);
    if (!webview) return;
    try {
      void webview.print().catch(() => undefined);
    } catch {
      // The guest may detach between opening the menu and choosing print.
    }
  };

  const openActivePageDevTools = () => {
    if (!activeTab) return;
    try {
      webviewsRef.current.get(activeTab.id)?.openDevTools();
    } catch {
      // Ignore a guest that detached while its menu was open.
    }
  };

  const changeActivePageZoom = (direction: BrowserZoomDirection) => {
    if (!activeTab) return;
    const webview = webviewsRef.current.get(activeTab.id);
    let currentZoomFactor = activeTab.zoomFactor;
    try {
      currentZoomFactor = webview?.getZoomFactor() ?? currentZoomFactor;
    } catch {
      // Retain the tab's last known zoom if the guest is no longer attached.
    }
    const nextZoomFactor = nextBrowserZoomFactor(currentZoomFactor, direction);
    try {
      webview?.setZoomFactor(nextZoomFactor);
    } catch {
      // State still tracks the requested value for the next attached guest.
    }
    updateTab(activeTab.id, { zoomFactor: nextZoomFactor });
  };

  const updateActiveDeviceEmulation = (deviceEmulation: BrowserDeviceEmulationState) => {
    if (activeTab) updateTab(activeTab.id, { deviceEmulation });
  };

  const toggleActiveDeviceToolbar = () => {
    if (!activeTab) return;
    updateTab(activeTab.id, {
      deviceEmulation: {
        ...activeTab.deviceEmulation,
        enabled: !activeTab.deviceEmulation.enabled,
      },
    });
  };

  return (
    <>
      {tabsHeaderHost
        ? createPortal(
            <BrowserTabStrip
              activeTabId={activeTabId}
              tabs={tabs}
              onCloseTab={closeTab}
              onSelectTab={selectTab}
            />,
            tabsHeaderHost,
          )
        : null}
      <aside className="desktop-workspace-panel desktop-browser-panel" aria-label="浏览器" hidden={hidden}>
        <WorkspaceResizeHandle max={resizeMax} min={resizeMin} value={resizeValue} onResizeStart={onResizeStart} onResizeStep={onResizeStep} />
        <div className="desktop-browser-navigation">
          <button className="desktop-browser-navigation__button" type="button" disabled={!activeTab?.canGoBack} aria-label="后退" onClick={() => navigateHistory('back')}>
            <ArrowLeft size={14} />
          </button>
          <button className="desktop-browser-navigation__button" type="button" disabled={!activeTab?.canGoForward} aria-label="前进" onClick={() => navigateHistory('forward')}>
            <ArrowRight size={14} />
          </button>
          <button className="desktop-browser-navigation__button" type="button" aria-label={activeTab?.loading ? '停止加载' : '刷新'} onClick={reload}>
            {activeTab?.loading ? <X size={13} /> : <RefreshCw size={13} />}
          </button>
          <BrowserAddressBar
            externalUrl={activeTab?.url ?? null}
            value={activeTab?.draftUrl ?? ''}
            onChange={(value) => activeTab && updateTab(activeTab.id, { draftUrl: value })}
            onNavigate={navigate}
            onOpenExternal={(url) => void window.setsunaDesktop?.links.openExternal(url)}
          />
          <BrowserWindowMenu
            capturingScreenshot={screenshotCapturing}
            deviceToolbarVisible={Boolean(activeTab?.deviceEmulation.enabled)}
            disabled={!activeTab}
            key={activeTab?.id ?? 'browser-menu'}
            loading={Boolean(activeTab?.loading)}
            zoomFactor={activeTab?.zoomFactor ?? 1}
            onOpenDevTools={openActivePageDevTools}
            onCaptureScreenshot={() => void captureScreenshot()}
            onPrint={printActivePage}
            onReload={reload}
            onToggleDeviceToolbar={toggleActiveDeviceToolbar}
            onZoomIn={() => changeActivePageZoom('in')}
            onZoomOut={() => changeActivePageZoom('out')}
            onZoomReset={() => changeActivePageZoom('reset')}
          />
        </div>
        {activeTab?.deviceEmulation.enabled ? (
          <BrowserDeviceToolbar value={activeTab.deviceEmulation} onChange={updateActiveDeviceEmulation} />
        ) : null}
        <div className={`desktop-browser-content ${activeTab?.deviceEmulation.enabled ? 'is-device-emulation' : ''}`}>
          {tabs.map((tab) => (
            <BrowserWebview
              active={tab.id === activeTabId}
              key={tab.id}
              tab={tab}
              onRef={(node) => {
                if (node) webviewsRef.current.set(tab.id, node);
                else webviewsRef.current.delete(tab.id);
              }}
              onUpdate={updateTab}
            />
          ))}
          {activeTab?.error ? <div className="desktop-browser-error"><strong>网页加载失败</strong><span>{activeTab.error}</span></div> : null}
        </div>
        {screenshotNotice ? (
          <div
            className={`desktop-browser-capture-notice is-${screenshotNotice.kind}`}
            role={screenshotNotice.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {screenshotNotice.message}
          </div>
        ) : null}
      </aside>
    </>
  );
}

function BrowserWebview({
  active,
  onRef,
  onUpdate,
  tab,
}: {
  active: boolean;
  onRef: (node: WebviewTag | null) => void;
  onUpdate: (tabId: string, patch: Partial<BrowserTab>) => void;
  tab: BrowserTab;
}) {
  const nodeRef = useRef<WebviewTag | null>(null);
  const deviceEmulationRef = useRef(tab.deviceEmulation);
  deviceEmulationRef.current = tab.deviceEmulation;

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return undefined;
    const syncNavigation = () => {
      const url = node.getURL() || tab.initialUrl;
      onUpdate(tab.id, {
        canGoBack: node.canGoBack(),
        canGoForward: node.canGoForward(),
        draftUrl: url,
        url,
        zoomFactor: node.getZoomFactor(),
      });
    };
    const handleStart = () => onUpdate(tab.id, { faviconUrl: null, loading: true, error: null });
    const handleStop = () => {
      syncNavigation();
      onUpdate(tab.id, { loading: false });
    };
    const handleTitle = (event: PageTitleUpdatedEvent) => onUpdate(tab.id, { title: event.title || browserHostLabel(node.getURL()) });
    const handleFavicon = (event: PageFaviconUpdatedEvent) => onUpdate(tab.id, { faviconUrl: resolveBrowserFaviconUrl(event.favicons) });
    const handleFailure = (event: DidFailLoadEvent) => {
      if (event.errorCode === -3) return;
      onUpdate(tab.id, { error: event.errorDescription || '无法加载网页', loading: false });
    };
    node.addEventListener('did-start-loading', handleStart);
    node.addEventListener('did-stop-loading', handleStop);
    node.addEventListener('did-navigate', syncNavigation);
    node.addEventListener('did-navigate-in-page', syncNavigation);
    node.addEventListener('page-title-updated', handleTitle);
    node.addEventListener('page-favicon-updated', handleFavicon);
    node.addEventListener('did-fail-load', handleFailure);
    return () => {
      node.removeEventListener('did-start-loading', handleStart);
      node.removeEventListener('did-stop-loading', handleStop);
      node.removeEventListener('did-navigate', syncNavigation);
      node.removeEventListener('did-navigate-in-page', syncNavigation);
      node.removeEventListener('page-title-updated', handleTitle);
      node.removeEventListener('page-favicon-updated', handleFavicon);
      node.removeEventListener('did-fail-load', handleFailure);
    };
  }, [onUpdate, tab.id, tab.initialUrl]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return undefined;
    let registeredWebContentsId: number | null = null;
    const register = () => {
      try {
        const webContentsId = node.getWebContentsId();
        if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0) return;
        registeredWebContentsId = webContentsId;
        void window.setsunaDesktop?.browser.registerTab(tab.id, webContentsId).then((registered) => {
          if (!registered) return;
          return applyBrowserDeviceEmulation(tab.id, deviceEmulationRef.current);
        }).catch(() => undefined);
      } catch {
        // The webview may not have attached yet; dom-ready retries registration.
      }
    };
    node.addEventListener('dom-ready', register);
    register();
    return () => {
      node.removeEventListener('dom-ready', register);
      if (registeredWebContentsId !== null) {
        void window.setsunaDesktop?.browser.unregisterTab(tab.id, registeredWebContentsId);
      }
    };
  }, [tab.id]);

  useEffect(() => {
    void applyBrowserDeviceEmulation(tab.id, tab.deviceEmulation).catch(() => undefined);
  }, [
    tab.deviceEmulation.deviceScaleFactor,
    tab.deviceEmulation.enabled,
    tab.deviceEmulation.height,
    tab.deviceEmulation.mobile,
    tab.deviceEmulation.scale,
    tab.deviceEmulation.userAgentProfile,
    tab.deviceEmulation.width,
    tab.id,
  ]);

  return (
    <BrowserDeviceViewport
      active={active}
      deviceEmulation={tab.deviceEmulation}
      onChange={(deviceEmulation) => onUpdate(tab.id, { deviceEmulation })}
    >
      <webview
        allowpopups={enabledWebviewBooleanAttribute}
        ref={(node) => {
          const webview = node as unknown as WebviewTag | null;
          nodeRef.current = webview;
          onRef(webview);
        }}
        className="desktop-browser-webview"
        partition={DESKTOP_BROWSER_PARTITION}
        src={tab.initialUrl}
      />
    </BrowserDeviceViewport>
  );
}

function createBrowserTab(sequence: number, url = browserHomeUrl): BrowserTab {
  return {
    canGoBack: false,
    canGoForward: false,
    deviceEmulation: createDefaultBrowserDeviceEmulation(),
    draftUrl: url,
    error: null,
    faviconUrl: null,
    id: `browser-tab-${Date.now()}-${sequence}`,
    initialUrl: url,
    loading: true,
    title: '新标签页',
    url,
    zoomFactor: 1,
  };
}

function applyBrowserDeviceEmulation(
  tabId: string,
  deviceEmulation: BrowserDeviceEmulationState,
): Promise<boolean> {
  return window.setsunaDesktop?.browser.setDeviceEmulation(
    tabId,
    toDesktopBrowserDeviceEmulation(deviceEmulation),
  ) ?? Promise.resolve(false);
}

const browserZoomFactors = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export type BrowserZoomDirection = 'in' | 'out' | 'reset';

export function nextBrowserZoomFactor(current: number, direction: BrowserZoomDirection): number {
  if (direction === 'reset') return 1;
  if (direction === 'in') return browserZoomFactors.find((factor) => factor > current + 0.001) ?? browserZoomFactors.at(-1)!;
  for (let index = browserZoomFactors.length - 1; index >= 0; index -= 1) {
    const factor = browserZoomFactors[index];
    if (factor < current - 0.001) return factor;
  }
  return browserZoomFactors[0];
}

const maxBrowserFaviconUrlLength = 512_000;

export function resolveBrowserFaviconUrl(favicons: readonly string[]): string | null {
  for (const favicon of favicons) {
    if (!favicon || favicon.length > maxBrowserFaviconUrlLength) continue;
    if (/^data:image\//i.test(favicon)) return favicon;
    try {
      const url = new URL(favicon);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // Ignore malformed and unsupported favicon URLs from untrusted pages.
    }
  }
  return null;
}

function isAbortedNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ERR_ABORTED|\(-3\)/.test(message);
}

export function normalizeBrowserInput(input: string): string {
  const value = input.trim();
  if (!value) return browserHomeUrl;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:\/|$)/i.test(value)) return `http://${value}`;
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/|$)/i.test(value)) return `https://${value}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
}

function browserHostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname || '新标签页';
  } catch {
    return '新标签页';
  }
}
