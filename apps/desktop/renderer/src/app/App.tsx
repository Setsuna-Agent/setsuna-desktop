import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
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
      <ShellFrame status={<StatusBadge tone="danger">{t('app.error.runtime')}</StatusBadge>}>
        <EmptyState
          title={t('app.error.runtimeTitle')}
          body={controller.runtime.error ?? t('common.unknownError')}
          action={<Button variant="primary" onClick={() => void controller.runtime.refresh().catch(() => undefined)}>{t('common.retry')}</Button>}
        />
      </ShellFrame>
    );
  }

  return <AppReadyLayout controller={controller} />;
}

function AppBlankSurface() {
  return <div className="app-blank-surface" aria-hidden="true" />;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <AppErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

function AppErrorFallback({ error }: { error: Error }) {
  const { t } = useI18n();
  return (
    <ShellFrame status={<StatusBadge tone="danger">{t('app.error.renderer')}</StatusBadge>}>
      <EmptyState title={t('app.error.rendererTitle')} body={error.message} />
    </ShellFrame>
  );
}
