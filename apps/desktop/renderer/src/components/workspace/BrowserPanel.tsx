import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw, X } from 'lucide-react';
import type { DidFailLoadEvent, PageFaviconUpdatedEvent, PageTitleUpdatedEvent, WebviewTag } from 'electron';
import { DESKTOP_BROWSER_PARTITION } from '@setsuna-desktop/contracts';
import { BrowserTabStrip } from './BrowserTabStrip.js';
import { useBrowserTabsHeaderPortal } from './BrowserTabsHeaderPortal.js';
import { WorkspaceResizeHandle } from './WorkspaceResizeHandle.js';
import type { BrowserOpenRequest } from '../../utils/runtimeBrowserActions.js';

const browserHomeUrl = 'https://www.bing.com/';
// Electron parses webview boolean attributes by presence, while React only emits
// custom-element attributes reliably when their runtime value is a string.
const enabledWebviewBooleanAttribute = 'true' as unknown as boolean;

type BrowserTab = {
  canGoBack: boolean;
  canGoForward: boolean;
  draftUrl: string;
  error: string | null;
  faviconUrl: string | null;
  id: string;
  initialUrl: string;
  loading: boolean;
  title: string;
  url: string;
};

export function BrowserPanel({
  hidden,
  openRequest,
  onResizeStep,
  onResizeStart,
  resizeMax,
  resizeMin,
  resizeValue,
}: {
  hidden: boolean;
  openRequest?: BrowserOpenRequest | null;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}) {
  const tabSequenceRef = useRef(1);
  const handledOpenRequestIdRef = useRef(openRequest?.id ?? null);
  const webviewsRef = useRef<Map<string, WebviewTag>>(new Map());
  const { host: tabsHeaderHost } = useBrowserTabsHeaderPortal();
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [createBrowserTab(1, openRequest?.url)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? '');
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const updateTab = useCallback((tabId: string, patch: Partial<BrowserTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const openTab = useCallback((url = browserHomeUrl) => {
    tabSequenceRef.current += 1;
    const tab = createBrowserTab(tabSequenceRef.current, url);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }, []);

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

  const navigate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      void webview.loadURL(url).catch((error) => {
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
    else webview.reload();
  };

  return (
    <>
      {tabsHeaderHost
        ? createPortal(
            <BrowserTabStrip
              activeTabId={activeTabId}
              tabs={tabs}
              onAddTab={openTab}
              onCloseTab={closeTab}
              onSelectTab={selectTab}
            />,
            tabsHeaderHost,
          )
        : null}
      <aside className="desktop-workspace-panel desktop-browser-panel" aria-label="浏览器" hidden={hidden}>
        <WorkspaceResizeHandle max={resizeMax} min={resizeMin} value={resizeValue} onResizeStart={onResizeStart} onResizeStep={onResizeStep} />
        <div className="desktop-browser-navigation">
          <button type="button" disabled={!activeTab?.canGoBack} aria-label="后退" onClick={() => navigateHistory('back')}>
            <ArrowLeft size={14} />
          </button>
          <button type="button" disabled={!activeTab?.canGoForward} aria-label="前进" onClick={() => navigateHistory('forward')}>
            <ArrowRight size={14} />
          </button>
          <button type="button" aria-label={activeTab?.loading ? '停止加载' : '刷新'} onClick={reload}>
            {activeTab?.loading ? <X size={13} /> : <RefreshCw size={13} />}
          </button>
          <form onSubmit={navigate}>
            <input
              aria-label="网址或搜索内容"
              value={activeTab?.draftUrl ?? ''}
              spellCheck={false}
              onChange={(event) => activeTab && updateTab(activeTab.id, { draftUrl: event.currentTarget.value })}
              onFocus={(event) => event.currentTarget.select()}
            />
          </form>
          <button
            type="button"
            aria-label="在系统浏览器中打开"
            disabled={!activeTab?.url}
            onClick={() => activeTab?.url && void window.setsunaDesktop?.links.openExternal(activeTab.url)}
          >
            <ExternalLink size={13} />
          </button>
        </div>
        <div className="desktop-browser-content">
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
        void window.setsunaDesktop?.browser.registerTab(tab.id, webContentsId);
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

  return (
    <webview
      allowpopups={enabledWebviewBooleanAttribute}
      ref={(node) => {
        const webview = node as unknown as WebviewTag | null;
        nodeRef.current = webview;
        onRef(webview);
      }}
      className={`desktop-browser-webview ${active ? 'is-active' : ''}`}
      partition={DESKTOP_BROWSER_PARTITION}
      src={tab.initialUrl}
    />
  );
}

function createBrowserTab(sequence: number, url = browserHomeUrl): BrowserTab {
  return {
    canGoBack: false,
    canGoForward: false,
    draftUrl: url,
    error: null,
    faviconUrl: null,
    id: `browser-tab-${Date.now()}-${sequence}`,
    initialUrl: url,
    loading: true,
    title: '新标签页',
    url,
  };
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
