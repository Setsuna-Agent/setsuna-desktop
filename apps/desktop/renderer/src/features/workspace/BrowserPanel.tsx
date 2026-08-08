import { DESKTOP_BROWSER_PARTITION } from '@setsuna-desktop/contracts';
import type {
  DidFailLoadEvent,
  DidStartNavigationEvent,
  PageFaviconUpdatedEvent,
  PageTitleUpdatedEvent,
  WebviewTag,
} from 'electron';
import { ArrowLeft, ArrowRight, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useToast } from '../../app/providers/ToastProvider.js';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { BrowserAddressBar } from './BrowserAddressBar.js';
import { BrowserDeviceToolbar } from './BrowserDeviceToolbar.js';
import { BrowserDeviceViewport } from './BrowserDeviceViewport.js';
import { BrowserWindowMenu } from './BrowserWindowMenu.js';
import { WorkspaceResizeHandle } from './WorkspaceResizeHandle.js';
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
import { DEFAULT_BROWSER_URL, type DesktopPanelTab, type DesktopPanelTabPatch } from './model.js';
import { useBrowserScreenshot, type BrowserScreenshotAttachmentHandler } from './useBrowserScreenshot.js';

export { resolveBrowserFaviconUrl, resolveBrowserFaviconUrls };

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
  title: string;
  url: string;
  zoomFactor: number;
};

export function BrowserPanel({
  hidden,
  panel,
  onPanelMetadataChange,
  onResizeStep,
  onResizeStart,
  onScreenshotAttachment,
  resizeMax,
  resizeMin,
  resizeValue,
}: {
  hidden: boolean;
  panel: DesktopPanelTab;
  onPanelMetadataChange: (panelId: string, patch: DesktopPanelTabPatch) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onScreenshotAttachment?: BrowserScreenshotAttachmentHandler;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const webviewRef = useRef<WebviewTag | null>(null);
  const registeredTabIdRef = useRef<string | null>(null);
  const [tab, setTab] = useState<BrowserTab>(() => createBrowserTab(panel, t));
  const {
    captureScreenshot,
    capturing: screenshotCapturing,
  } = useBrowserScreenshot({
    activeTabId: tab.id,
    onAttachment: onScreenshotAttachment,
  });

  const updateTab = useCallback((tabId: string, patch: Partial<BrowserTab>) => {
    setTab((current) => (current.id === tabId ? { ...current, ...patch } : current));
  }, []);
  const setWebview = useCallback((node: WebviewTag | null) => {
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
    toast.warning(message);
  }, [toast]);
  const reportDeviceEmulationFailure = useCallback((error?: unknown) => {
    reportBrowserActionFailure(t('workspace.browser.deviceEmulationFailed'), error);
  }, [reportBrowserActionFailure, t]);

  const applyActiveDeviceEmulation = async () => {
    // A false result before registerTab completes means "not ready", not a
    // failed user action. Registration reapplies the latest settings.
    const shouldReportFailure = registeredTabIdRef.current === tab.id;
    try {
      const applied = await applyBrowserDeviceEmulation(tab.id, tab.deviceEmulation);
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
    void window.setsunaDesktop?.browser.setActiveTab(tab.id);
    return () => {
      void window.setsunaDesktop?.browser.setActiveTab(null);
    };
  }, [hidden, tab.id]);

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

  const navigate = () => {
    const url = normalizeBrowserInput(tab.draftUrl);
    const webview = webviewRef.current;
    updateTab(tab.id, {
      draftUrl: url,
      error: null,
      ...(webview ? {} : { initialUrl: url }),
      loading: true,
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
        reportBrowserActionFailure(t('workspace.browser.reloadFailed'));
      }
    } else {
      // UA 和客户端提示覆盖是异步操作。导航前先应用覆盖，防止选择设备后立即刷新时
      // 使用桌面端请求头。
      void (async () => {
        await applyActiveDeviceEmulation();
        if (!runAttachedWebviewAction(webview, (attachedWebview) => attachedWebview.reload())) {
          reportBrowserActionFailure(t('workspace.browser.reloadFailed'));
        }
      })();
    }
  };

  const printActivePage = () => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      void webview.print().catch((error) => {
        reportBrowserActionFailure(t('workspace.browser.printFailed'), error);
      });
    } catch (error) {
      reportBrowserActionFailure(t('workspace.browser.printFailed'), error);
    }
  };

  const openActivePageDevTools = () => {
    const webview = webviewRef.current;
    if (!runAttachedWebviewAction(webview, (attachedWebview) => attachedWebview.openDevTools())) {
      reportBrowserActionFailure(t('workspace.browser.devToolsFailed'));
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
      reportBrowserActionFailure(t('workspace.browser.zoomFailed'));
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
    <aside className="desktop-workspace-panel desktop-browser-panel" aria-label={t('workspace.browser.label')} hidden={hidden}>
      <WorkspaceResizeHandle max={resizeMax} min={resizeMin} value={resizeValue} onResizeStart={onResizeStart} onResizeStep={onResizeStep} />
      <div className="desktop-browser-navigation">
        <button className="desktop-browser-navigation__button" type="button" disabled={!tab.canGoBack} aria-label={t('workspace.browser.back')} onClick={() => navigateHistory('back')}>
          <ArrowLeft size={14} />
        </button>
        <button className="desktop-browser-navigation__button" type="button" disabled={!tab.canGoForward} aria-label={t('workspace.browser.forward')} onClick={() => navigateHistory('forward')}>
          <ArrowRight size={14} />
        </button>
        <button className="desktop-browser-navigation__button" type="button" aria-label={t(tab.loading ? 'workspace.browser.stop' : 'workspace.browser.refresh')} onClick={reload}>
          {tab.loading ? <X size={13} /> : <RefreshCw size={13} />}
        </button>
        <BrowserAddressBar
          externalUrl={tab.url}
          value={tab.draftUrl}
          onChange={(value) => updateTab(tab.id, { draftUrl: value })}
          onNavigate={navigate}
          onOpenExternal={(url) => void window.setsunaDesktop?.links.openExternal(url)}
        />
        <BrowserWindowMenu
          capturingScreenshot={screenshotCapturing}
          deviceToolbarVisible={tab.deviceEmulation.enabled}
          disabled={false}
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
        />
      </div>
      {tab.deviceEmulation.enabled ? (
        <BrowserDeviceToolbar value={tab.deviceEmulation} onChange={updateActiveDeviceEmulation} />
      ) : null}
      <div className={`desktop-browser-content ${tab.deviceEmulation.enabled ? 'is-device-emulation' : ''}`}>
        <BrowserWebview
          active={!hidden}
          tab={tab}
          onDeviceEmulationFailure={reportDeviceEmulationFailure}
          onRegistrationChange={updateBrowserRegistration}
          onRef={setWebview}
          onUpdate={updateTab}
        />
        {tab.error ? <div className="desktop-browser-error"><strong>{t('workspace.browser.loadFailed')}</strong><span>{tab.error}</span></div> : null}
      </div>
    </aside>
  );
}

function BrowserWebview({
  active,
  onDeviceEmulationFailure,
  onRegistrationChange,
  onRef,
  onUpdate,
  tab,
}: {
  active: boolean;
  onDeviceEmulationFailure: (error?: unknown) => void;
  onRegistrationChange: (tabId: string, registered: boolean) => void;
  onRef: (node: WebviewTag | null) => void;
  onUpdate: (tabId: string, patch: Partial<BrowserTab>) => void;
  tab: BrowserTab;
}) {
  const { t } = useI18n();
  const nodeRef = useRef<WebviewTag | null>(null);
  const registeredRef = useRef(false);
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
    const faviconCoordinator = createBrowserFaviconCoordinator({
      onChange: (faviconUrl) => onUpdate(tab.id, { faviconUrl }),
      resolve: (faviconUrls) => requestBrowserFavicon(node, faviconUrls),
    });
    const handleNavigationStart = (event: DidStartNavigationEvent) => {
      if (event.isMainFrame && !event.isInPlace) faviconCoordinator.navigationStarted();
    };
    const handleStart = () => onUpdate(tab.id, { loading: true, error: null });
    const handleStop = () => {
      syncNavigation();
      onUpdate(tab.id, { loading: false });
      faviconCoordinator.loadingStopped();
    };
    const handleTitle = (event: PageTitleUpdatedEvent) => onUpdate(tab.id, { title: event.title || browserHostLabel(node.getURL(), t) });
    const handleFavicon = (event: PageFaviconUpdatedEvent) => faviconCoordinator.faviconUpdated(resolveBrowserFaviconUrls(event.favicons));
    const handleFailure = (event: DidFailLoadEvent) => {
      if (event.errorCode === -3) return;
      onUpdate(tab.id, { error: event.errorDescription || t('workspace.browser.cannotLoad'), loading: false });
    };
    node.addEventListener('did-start-navigation', handleNavigationStart);
    node.addEventListener('did-start-loading', handleStart);
    node.addEventListener('did-stop-loading', handleStop);
    node.addEventListener('did-navigate', syncNavigation);
    node.addEventListener('did-navigate-in-page', syncNavigation);
    node.addEventListener('page-title-updated', handleTitle);
    node.addEventListener('page-favicon-updated', handleFavicon);
    node.addEventListener('did-fail-load', handleFailure);
    return () => {
      faviconCoordinator.dispose();
      node.removeEventListener('did-start-navigation', handleNavigationStart);
      node.removeEventListener('did-start-loading', handleStart);
      node.removeEventListener('did-stop-loading', handleStop);
      node.removeEventListener('did-navigate', syncNavigation);
      node.removeEventListener('did-navigate-in-page', syncNavigation);
      node.removeEventListener('page-title-updated', handleTitle);
      node.removeEventListener('page-favicon-updated', handleFavicon);
      node.removeEventListener('did-fail-load', handleFailure);
    };
  }, [onUpdate, t, tab.id, tab.initialUrl]);

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
        void window.setsunaDesktop?.browser.registerTab(tab.id, webContentsId).then(async (registered) => {
          if (!registered || disposed) return;
          registeredRef.current = true;
          onRegistrationChange(tab.id, true);
          const deviceEmulation = deviceEmulationRef.current;
          try {
            const applied = await applyBrowserDeviceEmulation(tab.id, deviceEmulation);
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
        void window.setsunaDesktop?.browser.unregisterTab(tab.id, registeredWebContentsId);
      }
    };
  }, [onDeviceEmulationFailure, onRegistrationChange, tab.id]);

  useEffect(() => {
    if (!registeredRef.current) return;
    void applyBrowserDeviceEmulation(tab.id, tab.deviceEmulation)
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

function createBrowserTab(panel: DesktopPanelTab, t: Translate): BrowserTab {
  const url = panel.browser?.url ?? DEFAULT_BROWSER_URL;
  return {
    canGoBack: false,
    canGoForward: false,
    deviceEmulation: createDefaultBrowserDeviceEmulation(),
    draftUrl: url,
    error: null,
    faviconUrl: panel.browser?.faviconUrl ?? null,
    id: panel.id,
    initialUrl: url,
    loading: panel.browser?.loading ?? true,
    title: !panel.title || panel.title === '新标签页' ? t('workspace.panel.newTab') : panel.title,
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

function runAttachedWebviewAction(
  webview: WebviewTag | null,
  action: (webview: WebviewTag) => void,
): boolean {
  if (!webview || webview.isConnected === false) return false;
  try {
    action(webview);
    return true;
  } catch {
    return false;
  }
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

function isAbortedNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ERR_ABORTED|\(-3\)/.test(message);
}

function requestBrowserFavicon(webview: WebviewTag, faviconUrls: readonly string[]): Promise<string | null> {
  const resolveFavicon = window.setsunaDesktop?.browser.resolveFavicon;
  if (!resolveFavicon) return Promise.resolve(resolveBrowserFaviconUrl(faviconUrls));
  try {
    return resolveFavicon(webview.getWebContentsId(), faviconUrls)
      .catch(() => resolveBrowserFaviconUrl(faviconUrls));
  } catch {
    return Promise.resolve(resolveBrowserFaviconUrl(faviconUrls));
  }
}

export function normalizeBrowserInput(input: string): string {
  const value = input.trim();
  if (!value) return DEFAULT_BROWSER_URL;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:\/|$)/i.test(value)) return `http://${value}`;
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/|$)/i.test(value)) return `https://${value}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
}

function browserHostLabel(rawUrl: string, t: Translate): string {
  try {
    return new URL(rawUrl).hostname || t('workspace.panel.newTab');
  } catch {
    return t('workspace.panel.newTab');
  }
}
