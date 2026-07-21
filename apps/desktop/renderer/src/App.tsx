import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppReadyLayout } from './components/app/AppReadyLayout.js';
import { ShellFrame } from './components/app/ShellFrame.js';
import { Button, EmptyState, StatusBadge } from './components/primitives.js';
import { ToastProvider } from './components/ToastProvider.js';
import { useDesktopAppController } from './hooks/useDesktopAppController.js';

export function App() {
  return (
    <ToastProvider>
      <AppErrorBoundary>
        <AppContent />
      </AppErrorBoundary>
    </ToastProvider>
  );
}

function AppContent() {
  const controller = useDesktopAppController();

  if (controller.loadState === 'loading') {
    return <ShellFrame status={<StatusBadge>Starting runtime</StatusBadge>} />;
  }

  if (controller.loadState === 'error') {
    return (
      <ShellFrame status={<StatusBadge tone="danger">Runtime error</StatusBadge>}>
        <EmptyState
          title="Local runtime failed to start"
          body={controller.runtime.error ?? 'Unknown error'}
          action={<Button variant="primary" onClick={() => void controller.runtime.refresh().catch(() => undefined)}>重试</Button>}
        />
      </ShellFrame>
    );
  }

  return <AppReadyLayout controller={controller} />;
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
      return (
        <ShellFrame status={<StatusBadge tone="danger">Renderer error</StatusBadge>}>
          <EmptyState title="页面渲染异常" body={this.state.error.message} />
        </ShellFrame>
      );
    }
    return this.props.children;
  }
}
