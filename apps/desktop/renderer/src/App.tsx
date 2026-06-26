import { AppReadyLayout } from './components/app/AppReadyLayout.js';
import { ShellFrame } from './components/app/ShellFrame.js';
import { EmptyState, StatusBadge } from './components/primitives.js';
import { useDesktopAppController } from './hooks/useDesktopAppController.js';

export function App() {
  const controller = useDesktopAppController();

  if (controller.loadState === 'loading') {
    return <ShellFrame status={<StatusBadge>Starting runtime</StatusBadge>} />;
  }

  if (controller.loadState === 'error') {
    return (
      <ShellFrame status={<StatusBadge tone="danger">Runtime error</StatusBadge>}>
        <EmptyState title="Local runtime failed to start" body={controller.runtime.error ?? 'Unknown error'} />
      </ShellFrame>
    );
  }

  return <AppReadyLayout controller={controller} />;
}
