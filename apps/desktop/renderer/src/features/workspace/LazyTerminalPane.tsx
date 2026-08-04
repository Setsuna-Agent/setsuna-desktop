import { Terminal } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { DesktopTerminalSession } from './model.js';

const TerminalPane = lazy(async () => {
  const module = await import('./TerminalPane.js');
  return { default: module.TerminalPane };
});

export function LazyTerminalPane({ session }: { session: DesktopTerminalSession | null }) {
  const { t } = useI18n();
  return (
    <Suspense fallback={(
      <div className="terminal-placeholder" role="status">
        <Terminal size={15} />
        <span>{t('workspace.terminal.starting')}</span>
      </div>
    )}>
      <TerminalPane session={session} />
    </Suspense>
  );
}
