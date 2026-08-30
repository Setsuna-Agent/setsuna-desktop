import {
  BROWSER_HOME_URL,
  DEFAULT_BROWSER_URL,
  DESKTOP_BROWSER_PARTITION,
  type BrowserDesktopBridge,
  type BrowserPanelDescriptor,
  type BrowserPanelMetadataPatch,
  type BrowserReloadShortcutBindings,
} from '../contracts/index.js';
import { ArrowLeft, ArrowRight, House, RefreshCw, Star, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { BrowserAddressBar } from './BrowserAddressBar.js';
import { BrowserDeviceToolbar } from './BrowserDeviceToolbar.js';
import { BrowserDeviceViewport } from './BrowserDeviceViewport.js';
import { BrowserHomePage } from './BrowserHomePage.js';
import { BrowserWindowMenu } from './BrowserWindowMenu.js';
import { isBrowserBookmarked } from './browserBookmarks.js';
import type { BrowserHistoryVisit } from './browserHistory.js';
import {
  browserHostLabel,
  isAbortedNavigationError,
  isBrowserHomeUrl,
  nextBrowserZoomFactor,
  normalizeBrowserInput,
  type BrowserZoomDirection,
} from './browserNavigation.js';
import {
  createDefaultBrowserDeviceEmulation,
  toDesktopBrowserDeviceEmulation,
  type BrowserDeviceEmulationState,
} from './browserDeviceEmulation.js';
import {
  createBrowserFaviconCoordinator,
  resolveBrowserFaviconUrl,
  resolveBrowserFaviconUrls,
} from './browserFaviconCoordinator.js';
import type { BrowserTranslate } from './messages.js';
import type {
  BrowserNotify,
  BrowserScreenshotAttachmentHandler,
  BrowserSelectFieldComponent,
} from './types.js';
import { useBrowserBookmarks } from './useBrowserBookmarks.js';
import { useBrowserHistory } from './useBrowserHistory.js';
import { useBrowserScreenshot } from './useBrowserScreenshot.js';
import './browser.css';

export { resolveBrowserFaviconUrl, resolveBrowserFaviconUrls };
export { nextBrowserZoomFactor, normalizeBrowserInput };

// Electron 根据属性是否存在来解析 webview 布尔属性，而 React 只有在运行时值为字符串时
// 才能可靠地输出自定义元素属性。
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
  showingHome: boolean;
  title: string;
  url: string;
  zoomFactor: number;
};

type BrowserWebviewElement = {
  readonly isConnected: boolean;
  addEventListener(type: string, listener: (event: any) => void): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getWebContentsId(): number;
  getZoomFactor(): number;
  goBack(): void;
  goForward(): void;
  loadURL(url: string): Promise<void>;
  openDevTools(): void;
  print(): Promise<void>;
  reload(): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  setZoomFactor(value: number): void;
  stop(): void;
};

type BrowserDidFailLoadEvent = {
  errorCode: number;
  errorDescription: string;
};

type BrowserDidStartNavigationEvent = {
  isInPlace: boolean;
  isMainFrame: boolean;
};

type BrowserPageFaviconUpdatedEvent = { favicons: string[] };
type BrowserPageTitleUpdatedEvent = { title: string };

export function BrowserPanel({
  bridge,
  hidden,
  notify,
  openExternal,
  panel,
  placement = 'side',
  reloadShortcutBindings,
  onPanelMetadataChange,
  onScreenshotAttachment,
  resizeHandle,
  selectField,
  translate,
}: {
  bridge: BrowserDesktopBridge | null;
  hidden: boolean;
  notify: BrowserNotify;
  openExternal?: (url: string) => void;
  panel: BrowserPanelDescriptor;
  placement?: 'bottom' | 'side';
  reloadShortcutBindings?: BrowserReloadShortcutBindings;
  onPanelMetadataChange: (panelId: string, patch: BrowserPanelMetadataPatch) => void;
  onScreenshotAttachment?: BrowserScreenshotAttachmentHandler;
  resizeHandle?: ReactNode;
  selectField?: BrowserSelectFieldComponent;
  translate: BrowserTranslate;
}) {
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const registeredTabIdRef = useRef<string | null>(null);
  const [tab, setTab] = useState<BrowserTab>(() => createBrowserTab(panel, translate));
  const {
    entries: browserHistory,
    recordVisit: recordBrowserVisit,
    refresh: refreshBrowserHistory,
    removeEntry: removeBrowserHistoryEntry,
  } = useBrowserHistory();
  const {
    entries: browserBookmarks,
    refresh: refreshBrowserBookmarks,
    toggle: toggleBrowserBookmark,
  } = useBrowserBookmarks();
  const activePageBookmarked = !tab.showingHome && isBrowserBookmarked(browserBookmarks, tab.url);
  const {
    captureScreenshot,
    capturing: screenshotCapturing,
  } = useBrowserScreenshot({
    activeTabId: tab.id,
    bridge,
    notify,
    onAttachment: onScreenshotAttachment,
    translate,
  });

  const updateTab = useCallback((tabId: string, patch: Partial<BrowserTab>) => {
    setTab((current) => (current.id === tabId ? { ...current, ...patch } : current));
  }, []);
  const setWebview = useCallback((node: BrowserWebviewElement | null) => {
    webviewRef.current = node;
  }, []);
  const updateBrowserRegistration = useCallback((tabId: string, registered: boolean) => {
    if (registered) {
      registeredTabIdRef.current = tabId;
    } else if (registeredTabIdRef.current === tabId) {
      registeredTabIdRef.current = null;
    }
  }, []);
  const reportBrowserActionFailure = useCallback((message: string, error?: unknown) => {
    console.warn('[browser] embedded page action failed', error);
    notify('warning', message);
  }, [notify]);
  const reportDeviceEmulationFailure = useCallback((error?: unknown) => {
    reportBrowserActionFailure(translate('feature.browser.deviceEmulationFailed'), error);
  }, [reportBrowserActionFailure, translate]);

  const applyActiveDeviceEmulation = async () => {
    // A false result before registerTab completes means "not ready", not a
    // failed user action. Registration reapplies the latest settings.
    const shouldReportFailure = registeredTabIdRef.current === tab.id;
    try {
      const applied = await applyBrowserDeviceEmulation(bridge, tab.id, tab.deviceEmulation);
      if (shouldReportFailure && tab.deviceEmulation.enabled && !applied) {
        reportDeviceEmulationFailure();
      }
    } catch (error) {
      if (shouldReportFailure && tab.deviceEmulation.enabled) {
        reportDeviceEmulationFailure(error);
      }
    }
  };

  useEffect(() => {
    if (hidden) return undefined;
    void bridge?.setActiveTab(tab.showingHome ? null : tab.id);
    return () => {
      void bridge?.setActiveTab(null);
    };
  }, [bridge, hidden, tab.id, tab.showingHome]);

  useEffect(() => {
    if (hidden || !tab.showingHome) return;
    refreshBrowserBookmarks();
    refreshBrowserHistory();
  }, [hidden, refreshBrowserBookmarks, refreshBrowserHistory, tab.showingHome]);

  useEffect(() => {
    onPanelMetadataChange(panel.id, {
      browser: {
        faviconUrl: tab.faviconUrl,
        loading: tab.loading,
        url: tab.url,
      },
      title: tab.title,
    });
  }, [onPanelMetadataChange, panel.id, tab.faviconUrl, tab.loading, tab.title, tab.url]);

  const showBrowserHome = () => {
    refreshBrowserHistory();
    refreshBrowserBookmarks();
    updateTab(tab.id, {
      canGoBack: false,
      canGoForward: false,
      draftUrl: '',
      error: null,
      faviconUrl: null,
      initialUrl: BROWSER_HOME_URL,
      loading: false,
      showingHome: true,
      title: translate('feature.browser.newTab'),
      url: BROWSER_HOME_URL,
      zoomFactor: 1,
    });
  };

  const navigateToUrl = (url: string) => {
    if (isBrowserHomeUrl(url)) {
      showBrowserHome();
      return;
    }
    const webview = webviewRef.current;
    updateTab(tab.id, {
      draftUrl: url,
      error: null,
      ...(webview ? {} : { initialUrl: url }),
      loading: true,
      showingHome: false,
      url,
    });
    if (webview) {
      void (async () => {
        await applyActiveDeviceEmulation();
        try {
          await webview.loadURL(url);
        } catch (error) {
          if (isAbortedNavigationError(error)) return;
          updateTab(tab.id, { error: error instanceof Error ? error.message : String(error), loading: false });
        }
      })();
    }
  };

  const navigate = () => navigateToUrl(normalizeBrowserInput(tab.draftUrl));

  const toggleActivePageBookmark = () => {
    if (tab.showingHome) return;
    toggleBrowserBookmark({
      title: tab.title || browserHostLabel(tab.url, translate),
      url: tab.url,
    });
  };

  const navigateHistory = (direction: 'back' | 'forward') => {
    const webview = webviewRef.current;
    if (!webview) return;
    if (direction === 'back' && webview.canGoBack()) webview.goBack();
    if (direction === 'forward' && webview.canGoForward()) webview.goForward();
  };

  const reload = () => {
    const webview = webviewRef.current;
    if (!webview) return;
    if (tab.loading) {
      if (!runAttachedWebviewAction(webview, (attachedWebview) => attachedWebview.stop())) {
        reportBrowserActionFailure(translate('feature.browser.reloadFailed'));
      }
    } else {
      // UA 和客户端提示覆盖是异步操作。导航前先应用覆盖，防止选择设备后立即刷新时
      // 使用桌面端请求头。
      void (async () => {
        await applyActiveDeviceEmulation();
        if (!runAttachedWebviewAction(webview, (attachedWebview) => attachedWebview.reload())) {
          reportBrowserActionFailure(translate('feature.browser.reloadFailed'));
        }
      })();
    }
  };

  const showReloadMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (tab.loading || !bridge) return;
    const webview = webviewRef.current;
    let webContentsId = 0;
    if (!runAttachedWebviewAction(webview, (attachedWebview) => {
      webContentsId = attachedWebview.getWebContentsId();
    })) {
      reportBrowserActionFailure(translate('feature.browser.reloadFailed'));
      return;
    }
    void bridge.showReloadMenu(webContentsId, reloadShortcutBindings).then((shown) => {
      if (!shown) reportBrowserActionFailure(translate('feature.browser.reloadFailed'));
    }).catch((error) => {
      reportBrowserActionFailure(translate('feature.browser.reloadFailed'), error);
    });
  };

  const printActivePage = () => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      void webview.print().catch((error) => {
        reportBrowserActionFailure(translate('feature.browser.printFailed'), error);
      });
    } catch (error) {
      reportBrowserActionFailure(translate('feature.browser.printFailed'), error);
    }
  };

  const openActivePageDevTools = () => {
    const webview = webviewRef.current;
    if (!runAttachedWebviewAction(webview, (attachedWebview) => attachedWebview.openDevTools())) {
      reportBrowserActionFailure(translate('feature.browser.devToolsFailed'));
    }
  };

  const changeActivePageZoom = (direction: BrowserZoomDirection) => {
    const webview = webviewRef.current;
    let currentZoomFactor = tab.zoomFactor;
    try {
      currentZoomFactor = webview?.getZoomFactor() ?? currentZoomFactor;
    } catch (error) {
      console.warn('[browser] could not read embedded page zoom', error);
    }
    const nextZoomFactor = nextBrowserZoomFactor(currentZoomFactor, direction);
    if (!runAttachedWebviewAction(webview, (attachedWebview) => attachedWebview.setZoomFactor(nextZoomFactor))) {
      reportBrowserActionFailure(translate('feature.browser.zoomFailed'));
      return;
    }
    updateTab(tab.id, { zoomFactor: nextZoomFactor });
  };

  const updateActiveDeviceEmulation = (deviceEmulation: BrowserDeviceEmulationState) => {
    updateTab(tab.id, { deviceEmulation });
  };

  const toggleActiveDeviceToolbar = () => {
    updateTab(tab.id, {
      deviceEmulation: {
        ...tab.deviceEmulation,
        enabled: !tab.deviceEmulation.enabled,
      },
    });
  };

  return (
    <aside
      className={`desktop-workspace-panel desktop-browser-panel${placement === 'bottom' ? ' desktop-workspace-panel--bottom-floating' : ''}`}
      aria-label={translate('feature.browser.label')}
      hidden={hidden}
    >
      {placement === 'side' ? (
        resizeHandle
      ) : null}
      <div className="desktop-browser-navigation">
        <button className="desktop-browser-navigation__button" type="button" disabled={!tab.canGoBack} aria-label={translate('feature.browser.back')} onClick={() => navigateHistory('back')}>
          <ArrowLeft size={14} />
        </button>
        <button className="desktop-browser-navigation__button" type="button" disabled={!tab.canGoForward} aria-label={translate('feature.browser.forward')} onClick={() => navigateHistory('forward')}>
          <ArrowRight size={14} />
        </button>
        <button className="desktop-browser-navigation__button" type="button" disabled={tab.showingHome} aria-label={translate(tab.loading ? 'feature.browser.stop' : 'feature.browser.refresh')} onClick={reload} onContextMenu={showReloadMenu}>
          {tab.loading ? <X size={13} /> : <RefreshCw size={13} />}
        </button>
        <button
          aria-label={translate('feature.browser.home')}
          aria-pressed={tab.showingHome}
          className={`desktop-browser-navigation__button ${tab.showingHome ? 'is-active' : ''}`}
          title={translate('feature.browser.home')}
          type="button"
          onClick={showBrowserHome}
        >
          <House size={13} />
        </button>
        <BrowserAddressBar
          externalUrl={tab.showingHome ? null : tab.url}
          value={tab.draftUrl}
          translate={translate}
          onChange={(value) => updateTab(tab.id, { draftUrl: value })}
          onNavigate={navigate}
          onOpenExternal={(url) => openExternal?.(url)}
        />
        <button
          aria-label={translate(activePageBookmarked ? 'feature.browser.removeBookmark' : 'feature.browser.addBookmark')}
          aria-pressed={activePageBookmarked}
          className={`desktop-browser-navigation__button ${activePageBookmarked ? 'is-active' : ''}`}
          disabled={tab.showingHome}
          title={translate(activePageBookmarked ? 'feature.browser.removeBookmark' : 'feature.browser.addBookmark')}
          type="button"
          onClick={toggleActivePageBookmark}
        >
          <Star fill={activePageBookmarked ? 'currentColor' : 'none'} size={13} />
        </button>
        <BrowserWindowMenu
          capturingScreenshot={screenshotCapturing}
          deviceToolbarVisible={tab.deviceEmulation.enabled}
          disabled={tab.showingHome}
          key={tab.id}
          loading={tab.loading}
          zoomFactor={tab.zoomFactor}
          onOpenDevTools={openActivePageDevTools}
          onCaptureScreenshot={() => void captureScreenshot()}
          onPrint={printActivePage}
          onReload={reload}
          onToggleDeviceToolbar={toggleActiveDeviceToolbar}
          onZoomIn={() => changeActivePageZoom('in')}
          onZoomOut={() => changeActivePageZoom('out')}
          onZoomReset={() => changeActivePageZoom('reset')}
          translate={translate}
        />
      </div>
      {!tab.showingHome && tab.deviceEmulation.enabled ? (
        <BrowserDeviceToolbar
          selectField={selectField}
          translate={translate}
          value={tab.deviceEmulation}
          onChange={updateActiveDeviceEmulation}
        />
      ) : null}
      <div className={`desktop-browser-content${tab.showingHome ? ' is-home' : tab.deviceEmulation.enabled ? ' is-device-emulation' : ''}`}>
        {tab.showingHome ? (
          <BrowserHomePage
            bookmarks={browserBookmarks}
            entries={browserHistory}
            onNavigate={navigateToUrl}
            onRemoveHistory={removeBrowserHistoryEntry}
            translate={translate}
          />
        ) : (
          <BrowserWebview
            active={!hidden}
            bridge={bridge}
            tab={tab}
            onDeviceEmulationFailure={reportDeviceEmulationFailure}
            onRegistrationChange={updateBrowserRegistration}
            onRef={setWebview}
            onUpdate={updateTab}
            onVisit={recordBrowserVisit}
            translate={translate}
          />
        )}
        {tab.error ? <div className="desktop-browser-error"><strong>{translate('feature.browser.loadFailed')}</strong><span>{tab.error}</span></div> : null}
      </div>
    </aside>
  );
}

function BrowserWebview({
  active,
  bridge,
  onDeviceEmulationFailure,
  onRegistrationChange,
  onRef,
  onUpdate,
  onVisit,
  tab,
  translate,
}: {
  active: boolean;
  bridge: BrowserDesktopBridge | null;
  onDeviceEmulationFailure: (error?: unknown) => void;
  onRegistrationChange: (tabId: string, registered: boolean) => void;
  onRef: (node: BrowserWebviewElement | null) => void;
  onUpdate: (tabId: string, patch: Partial<BrowserTab>) => void;
  onVisit: (visit: BrowserHistoryVisit) => void;
  tab: BrowserTab;
  translate: BrowserTranslate;
}) {
  const nodeRef = useRef<BrowserWebviewElement | null>(null);
  const registeredRef = useRef(false);
  const deviceEmulationRef = useRef(tab.deviceEmulation);
  deviceEmulationRef.current = tab.deviceEmulation;

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return undefined;
    let currentUrl = tab.initialUrl;
    let currentTitle = browserHostLabel(currentUrl, translate);
    let currentVisitedAt = Date.now();
    const syncNavigation = () => {
      const url = node.getURL() || tab.initialUrl;
      if (url !== currentUrl) {
        currentUrl = url;
        currentTitle = browserHostLabel(url, translate);
        currentVisitedAt = Date.now();
      }
      onUpdate(tab.id, {
        canGoBack: node.canGoBack(),
        canGoForward: node.canGoForward(),
        draftUrl: url,
        url,
        zoomFactor: node.getZoomFactor(),
      });
    };
    const recordCurrentPage = () => onVisit({
      title: currentTitle,
      url: currentUrl,
      visitedAt: currentVisitedAt,
    });
    const faviconCoordinator = createBrowserFaviconCoordinator({
      onChange: (faviconUrl) => onUpdate(tab.id, { faviconUrl }),
      resolve: (faviconUrls) => requestBrowserFavicon(bridge, node, faviconUrls),
    });
    const handleNavigationStart = (event: BrowserDidStartNavigationEvent) => {
      if (event.isMainFrame && !event.isInPlace) faviconCoordinator.navigationStarted();
    };
    const handleStart = () => onUpdate(tab.id, { loading: true, error: null });
    const handleStop = () => {
      syncNavigation();
      onUpdate(tab.id, { loading: false });
      faviconCoordinator.loadingStopped();
    };
    const handleNavigate = () => {
      syncNavigation();
      recordCurrentPage();
    };
    const handleTitle = (event: BrowserPageTitleUpdatedEvent) => {
      syncNavigation();
      currentTitle = event.title || browserHostLabel(currentUrl, translate);
      onUpdate(tab.id, { title: currentTitle });
      recordCurrentPage();
    };
    const handleFavicon = (event: BrowserPageFaviconUpdatedEvent) => faviconCoordinator.faviconUpdated(resolveBrowserFaviconUrls(event.favicons));
    const handleFailure = (event: BrowserDidFailLoadEvent) => {
      if (event.errorCode === -3) return;
      onUpdate(tab.id, { error: event.errorDescription || translate('feature.browser.cannotLoad'), loading: false });
    };
    node.addEventListener('did-start-navigation', handleNavigationStart);
    node.addEventListener('did-start-loading', handleStart);
    node.addEventListener('did-stop-loading', handleStop);
    node.addEventListener('did-navigate', handleNavigate);
    node.addEventListener('did-navigate-in-page', handleNavigate);
    node.addEventListener('page-title-updated', handleTitle);
    node.addEventListener('page-favicon-updated', handleFavicon);
    node.addEventListener('did-fail-load', handleFailure);
    return () => {
      faviconCoordinator.dispose();
      node.removeEventListener('did-start-navigation', handleNavigationStart);
      node.removeEventListener('did-start-loading', handleStart);
      node.removeEventListener('did-stop-loading', handleStop);
      node.removeEventListener('did-navigate', handleNavigate);
      node.removeEventListener('did-navigate-in-page', handleNavigate);
      node.removeEventListener('page-title-updated', handleTitle);
      node.removeEventListener('page-favicon-updated', handleFavicon);
      node.removeEventListener('did-fail-load', handleFailure);
    };
  }, [bridge, onUpdate, onVisit, tab.id, tab.initialUrl, translate]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return undefined;
    let disposed = false;
    let registeredWebContentsId: number | null = null;
    const register = () => {
      try {
        const webContentsId = node.getWebContentsId();
        if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0) return;
        registeredWebContentsId = webContentsId;
        void bridge?.registerTab(tab.id, webContentsId).then(async (registered) => {
          if (!registered || disposed) return;
          registeredRef.current = true;
          onRegistrationChange(tab.id, true);
          const deviceEmulation = deviceEmulationRef.current;
          try {
            const applied = await applyBrowserDeviceEmulation(bridge, tab.id, deviceEmulation);
            if (!disposed && deviceEmulation.enabled && !applied) {
              onDeviceEmulationFailure();
            }
          } catch (error) {
            if (!disposed && deviceEmulation.enabled) {
              onDeviceEmulationFailure(error);
            }
          }
        }).catch(() => undefined);
      } catch {
        // webview 可能尚未附加；dom-ready 时会重试注册。
      }
    };
    node.addEventListener('dom-ready', register);
    register();
    return () => {
      disposed = true;
      registeredRef.current = false;
      onRegistrationChange(tab.id, false);
      node.removeEventListener('dom-ready', register);
      if (registeredWebContentsId !== null) {
        void bridge?.unregisterTab(tab.id, registeredWebContentsId);
      }
    };
  }, [bridge, onDeviceEmulationFailure, onRegistrationChange, tab.id]);

  useEffect(() => {
    if (!registeredRef.current) return;
    void applyBrowserDeviceEmulation(bridge, tab.id, tab.deviceEmulation)
      .then((applied) => {
        if (tab.deviceEmulation.enabled && !applied) {
          onDeviceEmulationFailure();
        }
      })
      .catch((error) => {
        onDeviceEmulationFailure(error);
      });
  }, [
    onDeviceEmulationFailure,
    bridge,
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
      translate={translate}
      onChange={(deviceEmulation) => onUpdate(tab.id, { deviceEmulation })}
    >
      <webview
        allowpopups={enabledWebviewBooleanAttribute}
        ref={(node) => {
          const webview = node as unknown as BrowserWebviewElement | null;
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

function createBrowserTab(panel: BrowserPanelDescriptor, translate: BrowserTranslate): BrowserTab {
  const requestedUrl = panel.browser?.url?.trim();
  const url = requestedUrl || DEFAULT_BROWSER_URL;
  const showingHome = isBrowserHomeUrl(url);
  return {
    canGoBack: false,
    canGoForward: false,
    deviceEmulation: createDefaultBrowserDeviceEmulation(),
    draftUrl: showingHome ? '' : url,
    error: null,
    faviconUrl: showingHome ? null : panel.browser?.faviconUrl ?? null,
    id: panel.id,
    initialUrl: url,
    loading: showingHome ? false : panel.browser?.loading ?? true,
    showingHome,
    title: showingHome || !panel.title || panel.title === '新标签页'
      ? translate('feature.browser.newTab')
      : panel.title,
    url,
    zoomFactor: 1,
  };
}

function applyBrowserDeviceEmulation(
  bridge: BrowserDesktopBridge | null,
  tabId: string,
  deviceEmulation: BrowserDeviceEmulationState,
): Promise<boolean> {
  return bridge?.setDeviceEmulation(
    tabId,
    toDesktopBrowserDeviceEmulation(deviceEmulation),
  ) ?? Promise.resolve(false);
}

function runAttachedWebviewAction(
  webview: BrowserWebviewElement | null,
  action: (webview: BrowserWebviewElement) => void,
): boolean {
  if (!webview || webview.isConnected === false) return false;
  try {
    action(webview);
    return true;
  } catch {
    return false;
  }
}

function requestBrowserFavicon(
  bridge: BrowserDesktopBridge | null,
  webview: BrowserWebviewElement,
  faviconUrls: readonly string[],
): Promise<string | null> {
  const resolveFavicon = bridge?.resolveFavicon;
  if (!resolveFavicon) return Promise.resolve(resolveBrowserFaviconUrl(faviconUrls));
  try {
    return resolveFavicon(webview.getWebContentsId(), faviconUrls)
      .catch(() => resolveBrowserFaviconUrl(faviconUrls));
  } catch {
    return Promise.resolve(resolveBrowserFaviconUrl(faviconUrls));
  }
}
