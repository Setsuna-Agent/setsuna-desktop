import { Button } from '@setsuna-desktop/renderer-ui';
import {
  BROWSER_HOME_URL,
  BROWSER_WEB_STORE_URL,
  DEFAULT_BROWSER_URL,
  DESKTOP_BROWSER_PARTITION,
  type BrowserDesktopBridge,
  type BrowserExtension,
  type BrowserPanelDescriptor,
  type BrowserPanelMetadataPatch,
  type BrowserReloadShortcutBindings,
} from '../contracts/index.js';
import { ArrowLeft, ArrowRight, House, RefreshCw, SquareDashedMousePointer, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { BrowserAddressBar } from './BrowserAddressBar.js';
import { BrowserContextMenu } from './BrowserContextMenu.js';
import { BrowserDeviceToolbar } from './BrowserDeviceToolbar.js';
import { BrowserDeviceViewport } from './BrowserDeviceViewport.js';
import { BrowserHomePage } from './BrowserHomePage.js';
import { BrowserLoadErrorPage } from './load-error/BrowserLoadErrorPage.js';
import { BrowserWindowMenu } from './BrowserWindowMenu.js';
import { BrowserPasswords } from './passwords/BrowserPasswords.js';
import { BrowserExtensions } from './extensions/BrowserExtensions.js';
import { useBrowserExtensions } from './extensions/useBrowserExtensions.js';
import { isExtensionNewTab, useBrowserNewTab } from './extensions/useBrowserNewTab.js';
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
import { useBrowserBackgroundViewport } from './useBrowserBackgroundViewport.js';
import { useBrowserHistory } from './useBrowserHistory.js';
import { useBrowserScreenshot } from './useBrowserScreenshot.js';
import { BrowserAnnotationPanel } from './annotations/BrowserAnnotationPanel.js';
import { useBrowserAnnotations } from './annotations/useBrowserAnnotations.js';
import type { BrowserAnnotationSendHandler } from '../contracts/index.js';
import './browser.css';
import { useBrowserPreferences } from './settings/useBrowserPreferences.js';
import { useBrowserSettingsNavigation } from './settings/context.js';
import { BrowserRecordsToolbar } from './records/BrowserRecordsToolbar.js';
import { BrowserRecordsManager } from './records/BrowserRecordsManager.js';
import { useBrowserRecordsPanel } from './records/useBrowserRecordsPanel.js';
import { BrowserFavoritesIcon } from './records/recordIcons.js';
import { BrowserFindBar } from './find/BrowserFindBar.js';
import { useBrowserFind, type BrowserFindWebview } from './find/useBrowserFind.js';

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

type BrowserWebviewElement = BrowserFindWebview & {
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getBoundingClientRect(): DOMRect;
  getWebContentsId(): number;
  getZoomFactor(): number;
  goBack(): void;
  goForward(): void;
  loadURL(url: string): Promise<void>;
  openDevTools(): void;
  print(): Promise<void>;
  reload(): void;
  setZoomFactor(value: number): void;
  stop(): void;
};

type BrowserDidFailLoadEvent = {
  errorCode: number;
  errorDescription: string;
  isMainFrame?: boolean;
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
  onSendAnnotations,
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
  onSendAnnotations?: BrowserAnnotationSendHandler;
  resizeHandle?: ReactNode;
  selectField?: BrowserSelectFieldComponent;
  translate: BrowserTranslate;
}) {
  const panelRef = useBrowserBackgroundViewport(hidden);
  const annotationSurfaceRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const registeredTabIdRef = useRef<string | null>(null);
  const menuButtonRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<BrowserTab>(() => createBrowserTab(panel, translate));
  const [extensionWebContentsId, setExtensionWebContentsId] = useState<number>();
  const extensions = useBrowserExtensions(bridge, notify, translate, extensionWebContentsId);
  const { preferences, ready: preferencesReady } = useBrowserPreferences(bridge);
  const settingsNavigation = useBrowserSettingsNavigation();
  const records = useBrowserRecordsPanel(hidden);
  const showingNewTab = tab.showingHome || isExtensionNewTab(tab.url, extensions.newTabUrl);
  const resolveNewTab = useCallback((extension: BrowserExtension | null) => {
    const url = extension?.newTabUrl ?? BROWSER_HOME_URL;
    setTab((current) => ({
      ...current, url, initialUrl: url, showingHome: !extension,
      draftUrl: current.showingHome ? current.draftUrl : '',
      title: extension?.name ?? translate('feature.browser.newTab'), faviconUrl: extension?.icon ?? null,
      loading: Boolean(extension), error: null, canGoBack: false, canGoForward: false, zoomFactor: 1,
    }));
  }, [translate]);
  useBrowserNewTab({ ready: extensions.ready && (preferencesReady || !bridge?.getBrowserPreferences), enabled: preferences.useExtensionNewTab,
    extensions: extensions.extensions, showingHome: tab.showingHome, url: tab.url, onResolve: resolveNewTab });
  const {
    entries: browserHistory,
    recordVisit: recordBrowserVisit,
    refresh: refreshBrowserHistory,
    removeEntry: removeBrowserHistoryEntry,
  } = useBrowserHistory();
  const recordVisit = useCallback((visit: BrowserHistoryVisit, updateOnly = false) => {
    // Defaults are only for rendering; they cannot authorize writes before the saved preference arrives.
    if (preferencesReady && preferences.rememberHistory) recordBrowserVisit(visit, updateOnly);
  }, [preferencesReady, preferences.rememberHistory, recordBrowserVisit]);
  const {
    entries: browserBookmarks,
    refresh: refreshBrowserBookmarks,
    toggle: toggleBrowserBookmark,
  } = useBrowserBookmarks();
  const activePageBookmarked = !showingNewTab && isBrowserBookmarked(browserBookmarks, tab.url);
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
  const annotations = useBrowserAnnotations({
    bridge, tabId: tab.id, url: tab.url, available: !tab.showingHome && !tab.loading,
    hidden, notify, translate, onSend: onSendAnnotations,
  });
  const find = useBrowserFind({ available: !hidden && !tab.showingHome, bridge, notify, tabId: tab.id, translate, webviewRef });
  const pageChanged = useCallback(() => { annotations.clear(); find.reset(); }, [annotations.clear, find.reset]);

  const updateTab = useCallback((tabId: string, patch: Partial<BrowserTab>) => {
    setTab((current) => (current.id === tabId ? { ...current, ...patch } : current));
  }, []);
  useEffect(() => { updateTab(tab.id, { zoomFactor: preferences.defaultZoom }); }, [preferences.defaultZoom, tab.id, updateTab]);
  const setWebview = useCallback((node: BrowserWebviewElement | null) => {
    webviewRef.current = node;
  }, []);
  const updateBrowserRegistration = useCallback((tabId: string, registered: boolean) => {
    if (registered) {
      registeredTabIdRef.current = tabId;
      setExtensionWebContentsId(webviewRef.current?.getWebContentsId());
    } else if (registeredTabIdRef.current === tabId) {
      registeredTabIdRef.current = null;
      setExtensionWebContentsId(undefined);
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
        url: showingNewTab ? BROWSER_HOME_URL : tab.url,
      },
      title: tab.title,
    });
  }, [onPanelMetadataChange, panel.id, showingNewTab, tab.faviconUrl, tab.loading, tab.title, tab.url]);

  const showBrowserHome = () => {
    if (preferences.homeUrl) { navigateToUrl(preferences.homeUrl); return; }
    if (preferences.useExtensionNewTab && extensions.newTabUrl) {
      navigateToUrl(extensions.newTabUrl);
      return;
    }
    pageChanged();
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

  const toggleActivePageBookmark = () => {
    if (tab.showingHome) return;
    const saved = toggleBrowserBookmark({
      title: tab.title || browserHostLabel(tab.url, translate),
      url: tab.url,
    });
    if (!saved) notify('warning', translate('feature.browser.settings.failed'));
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
    void bridge.showReloadMenu(webContentsId, reloadShortcutBindings, { x: event.clientX, y: event.clientY }).then((shown) => {
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
    const nextZoomFactor = direction === 'reset' ? preferences.defaultZoom : nextBrowserZoomFactor(currentZoomFactor, direction);
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
      ref={panelRef}
      className={`desktop-workspace-panel desktop-browser-panel${placement === 'bottom' ? ' desktop-workspace-panel--bottom-floating' : ''}`}
      aria-label={translate('feature.browser.label')}
      data-browser-tab-id={tab.id}
      onKeyDownCapture={find.onKeyDown}
      aria-hidden={hidden || undefined}
      hidden={hidden}
      {...(hidden ? { inert: '' } : {})}
    >
      {placement === 'side' ? (
        resizeHandle
      ) : null}
      <div className="desktop-browser-navigation">
        <Button variant="ghost" className="desktop-browser-navigation__button" type="button" disabled={!tab.canGoBack} aria-label={translate('feature.browser.back')} onClick={() => navigateHistory('back')}>
          <ArrowLeft size={14} />
        </Button>
        <Button variant="ghost" className="desktop-browser-navigation__button" type="button" disabled={!tab.canGoForward} aria-label={translate('feature.browser.forward')} onClick={() => navigateHistory('forward')}>
          <ArrowRight size={14} />
        </Button>
        <Button variant="ghost" className="desktop-browser-navigation__button" type="button" disabled={tab.showingHome} aria-label={translate(tab.loading ? 'feature.browser.stop' : 'feature.browser.refresh')} onClick={reload} onContextMenu={showReloadMenu}>
          {tab.loading ? <X size={13} /> : <RefreshCw size={13} />}
        </Button>
        {preferences.showHomeButton ? <Button variant="ghost"
          aria-label={translate('feature.browser.home')}
          aria-pressed={showingNewTab}
          className={`desktop-browser-navigation__button ${showingNewTab ? 'is-active' : ''}`}
          title={translate('feature.browser.home')}
          type="button"
          onClick={showBrowserHome}
        >
          <House size={13} />
        </Button> : null}
        <BrowserAddressBar
          showFullUrl={preferences.showFullUrl}
          searchEngine={preferences.searchEngine}
          externalUrl={showingNewTab || tab.url.startsWith('chrome-extension:') ? null : tab.url}
          hidden={hidden}
          history={browserHistory}
          value={tab.draftUrl}
          translate={translate}
          onChange={(value) => updateTab(tab.id, { draftUrl: value })}
          onNavigate={navigateToUrl}
          onOpenExternal={(url) => openExternal?.(url)}
          onRefreshHistory={refreshBrowserHistory}
          onRemoveHistory={removeBrowserHistoryEntry}
        />
        <Button variant="ghost"
          aria-label={translate(activePageBookmarked ? 'feature.browser.removeBookmark' : 'feature.browser.addBookmark')}
          aria-pressed={activePageBookmarked}
          className={`desktop-browser-navigation__button ${activePageBookmarked ? 'is-active' : ''}`}
          disabled={showingNewTab}
          title={translate(activePageBookmarked ? 'feature.browser.removeBookmark' : 'feature.browser.addBookmark')}
          type="button"
          onClick={toggleActivePageBookmark}
        >
          <BrowserFavoritesIcon aria-hidden="true" fill={activePageBookmarked ? 'currentColor' : 'none'} size={13} />
        </Button>
        <Button variant="ghost" type="button" className={`desktop-browser-navigation__button${annotations.open ? ' is-active' : ''}`}
          aria-label={translate('feature.browser.annotation.label')} title={translate('feature.browser.annotation.label')}
          aria-pressed={annotations.open} disabled={tab.showingHome || tab.loading || annotations.sending}
          onClick={annotations.toggle}><SquareDashedMousePointer size={13} /></Button>
        <BrowserPasswords bridge={bridge} tabId={tab.id} active={!tab.showingHome} hidden={hidden} notify={notify} translate={translate} />
        <BrowserExtensions extensions={extensions} hidden={hidden} translate={translate}
          onOpenSettings={settingsNavigation?.openExtensionSettings} onOpenStore={() => navigateToUrl(BROWSER_WEB_STORE_URL)} />
        <BrowserRecordsToolbar state={records} hidden={hidden} menuButtonRef={menuButtonRef}
          translate={translate} onNavigate={navigateToUrl}
          currentPage={showingNewTab ? undefined : { title: tab.title, url: tab.url }} />
        <BrowserWindowMenu
          hidden={hidden}
          menuButtonRef={menuButtonRef}
          onOpenRecords={records.open}
          onOpenSettings={settingsNavigation ? () => settingsNavigation.openSettings('browser') : undefined}
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
      <div className="desktop-browser-page" ref={annotationSurfaceRef}>
        {find.open ? <BrowserFindBar find={find} translate={translate} /> : null}
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
              newTabUrl={extensions.newTabUrl}
              onDeviceEmulationFailure={reportDeviceEmulationFailure}
              onPageChange={pageChanged}
              onRegistrationChange={updateBrowserRegistration}
              onRef={setWebview}
              onUpdate={updateTab}
              onVisit={recordVisit}
              translate={translate}
            />
          )}
          {tab.error ? <BrowserLoadErrorPage error={tab.error} url={tab.url} onReload={reload} translate={translate} /> : null}
        </div>
        <BrowserAnnotationPanel state={annotations} translate={translate} bridge={bridge} tabId={tab.id}
          hidden={hidden} surfaceRef={annotationSurfaceRef} webviewRef={webviewRef} />
        {records.kind && records.pinned ? <aside className="browser-records__sidebar">
          <BrowserRecordsManager key={records.kind} kind={records.kind} pinned translate={translate}
            currentPage={showingNewTab ? undefined : { title: tab.title, url: tab.url }}
            onClose={records.close} onTogglePinned={records.togglePinned} onNavigate={navigateToUrl} />
        </aside> : null}
      </div>
      <BrowserContextMenu bridge={bridge} active={!hidden && !tab.showingHome} webviewRef={webviewRef} />
    </aside>
  );
}

function BrowserWebview({
  active,
  bridge,
  onDeviceEmulationFailure,
  onPageChange,
  onRegistrationChange,
  onRef,
  onUpdate,
  onVisit,
  tab,
  newTabUrl,
  translate,
}: {
  active: boolean;
  bridge: BrowserDesktopBridge | null;
  onDeviceEmulationFailure: (error?: unknown) => void;
  onPageChange: () => void;
  onRegistrationChange: (tabId: string, registered: boolean) => void;
  onRef: (node: BrowserWebviewElement | null) => void;
  onUpdate: (tabId: string, patch: Partial<BrowserTab>) => void;
  onVisit: (visit: BrowserHistoryVisit, updateOnly?: boolean) => void;
  tab: BrowserTab;
  newTabUrl: string | null;
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
        draftUrl: isExtensionNewTab(url, newTabUrl) ? '' : url,
        url,
        zoomFactor: node.getZoomFactor(),
      });
    };
    const recordCurrentPage = (updateOnly = false) => onVisit({
      title: currentTitle,
      url: currentUrl,
      visitedAt: currentVisitedAt,
    }, updateOnly);
    const faviconCoordinator = createBrowserFaviconCoordinator({
      onChange: (faviconUrl) => onUpdate(tab.id, { faviconUrl }),
      resolve: (faviconUrls) => requestBrowserFavicon(bridge, node, faviconUrls),
    });
    const handleNavigationStart = (event: BrowserDidStartNavigationEvent) => {
      // Main disposes the annotation session on every top-level navigation, including reloads.
      if (event.isMainFrame !== false) onPageChange();
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
      currentVisitedAt = Date.now();
      recordCurrentPage();
    };
    const handleTitle = (event: BrowserPageTitleUpdatedEvent) => {
      syncNavigation();
      currentTitle = event.title || browserHostLabel(currentUrl, translate);
      onUpdate(tab.id, { title: currentTitle });
      recordCurrentPage(true);
    };
    const handleFavicon = (event: BrowserPageFaviconUpdatedEvent) => faviconCoordinator.faviconUpdated(resolveBrowserFaviconUrls(event.favicons));
    const handleFailure = (event: BrowserDidFailLoadEvent) => {
      if (event.errorCode === -3 || event.isMainFrame === false) return;
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
  }, [bridge, newTabUrl, onPageChange, onUpdate, onVisit, tab.id, tab.initialUrl, translate]);

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
