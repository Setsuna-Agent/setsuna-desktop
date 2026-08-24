import { Component, useCallback, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { CollaborationFeatureNavigationBoundary } from '../composition/CollaborationFeatureBoundary.js';
import { Button, EmptyState, StatusBadge } from '../shared/ui/primitives.js';
import { interfaceLanguageFromConfig, useI18n } from '../shared/i18n/I18nProvider.js';
import { useDesktopAppController } from './controller/useDesktopAppController.js';
import { AppReadyLayout } from './layout/AppReadyLayout.js';
import { DesktopDataRootGate } from './layout/DesktopDataRootGate.js';
import { ShellFrame } from './layout/ShellFrame.js';
import { DesktopDataRootProvider } from './providers/DesktopDataRootProvider.js';
import { ToastProvider } from './providers/ToastProvider.js';

export function App() {
  // 沙箱化的浏览器预览不会注入桌面 preload bridge；误打开 renderer 开发地址时只显示中性底色。
  if (!window.setsunaDesktop?.runtime) return <AppBlankSurface />;

  return (
    <ToastProvider>
      <AppErrorBoundary>
        <DesktopDataRootProvider>
          <DesktopDataRootGate>
            <AppContent />
          </DesktopDataRootGate>
        </DesktopDataRootProvider>
      </AppErrorBoundary>
    </ToastProvider>
  );
}

function AppContent() {
  const controller = useDesktopAppController();
  const { locale, setLocale, t } = useI18n();
  const runtimeConfig = controller.runtime?.config ?? null;

  useEffect(() => {
    if (runtimeConfig) {
      setLocale(interfaceLanguageFromConfig(runtimeConfig));
    }
  }, [runtimeConfig, setLocale]);

  useEffect(() => {
    const setInterfaceLanguage = window.setsunaDesktop?.desktop.setInterfaceLanguage;
    if (!setInterfaceLanguage) return;
    void setInterfaceLanguage(locale).catch(() => undefined);
  }, [locale]);

  if (controller.loadState === 'loading') {
    return <AppBlankSurface />;
  }

  if (controller.loadState === 'error') {
    return (
      <ShellFrame className="app-error-shell" inspectorOpen={false} showSidebarToggle={false} status={<StatusBadge tone="danger">{t('app.error.runtime')}</StatusBadge>}>
        <div className="app-error-fallback">
          <EmptyState
            title={t('app.error.runtimeTitle')}
            body={controller.runtime.error ?? t('common.unknownError')}
            action={<Button variant="primary" onClick={() => void controller.runtime.refresh().catch(() => undefined)}>{t('common.retry')}</Button>}
          />
        </div>
      </ShellFrame>
    );
  }

  return <ReadyAppContent controller={controller} />;
}

function ReadyAppContent({ controller }: Readonly<{
  controller: ReturnType<typeof useDesktopAppController>;
}>) {
  const openCollaborationTask = useCallback(
    (parentThreadId: string, task: Parameters<typeof controller.workspacePanels.openSubagentPanel>[1]) => {
      controller.workspacePanels.openSubagentPanel(parentThreadId, task);
    },
    [controller.workspacePanels.openSubagentPanel],
  );
  return (
    <CollaborationFeatureNavigationBoundary onOpenTask={openCollaborationTask}>
      <AppReadyLayout controller={controller} />
    </CollaborationFeatureNavigationBoundary>
  );
}

function AppBlankSurface() {
  return <div className="app-blank-surface" aria-hidden="true" />;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  private readonly retry = () => {
    // React.lazy caches rejected import promises, so remounting the same tree cannot recover them.
    window.location.reload();
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <AppErrorFallback error={this.state.error} onRetry={this.retry} />;
    }
    return this.props.children;
  }
}

function AppErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <ShellFrame className="app-error-shell" inspectorOpen={false} showSidebarToggle={false} status={<StatusBadge tone="danger">{t('app.error.renderer')}</StatusBadge>}>
      <div className="app-error-fallback">
        <EmptyState
          title={t('app.error.rendererTitle')}
          body={error.message}
          action={<Button variant="primary" onClick={onRetry}>{t('common.retry')}</Button>}
        />
      </div>
    </ShellFrame>
  );
}
