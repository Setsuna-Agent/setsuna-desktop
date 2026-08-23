import { Terminal } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { TerminalPaneProps } from './TerminalPane.js';

const TerminalPane = lazy(async () => {
  const module = await import('./TerminalPane.js');
  return { default: module.TerminalPane };
});

export function LazyTerminalPane(props: TerminalPaneProps) {
  return (
    <Suspense fallback={(
      <div data-feature-id="terminal" className="feature-terminal__placeholder" role="status">
        <Terminal size={15} />
        <span>{props.translate('feature.terminal.starting')}</span>
      </div>
    )}>
      <TerminalPane {...props} />
    </Suspense>
  );
}
