import { LazyTerminalPane } from '@setsuna-desktop/feature-terminal/renderer';
import type { DesktopTerminalSession } from '@setsuna-desktop/feature-terminal/contracts';
import { CODE_APPEARANCE_CHANGE_EVENT_NAME } from '../shared/preferences/useCodeAppearancePreferences.js';
import { useI18n } from '../shared/i18n/I18nProvider.js';

export function TerminalFeaturePane({
  session,
  onTitleChange,
}: Readonly<{
  session: DesktopTerminalSession | null;
  onTitleChange?: (title: string) => void;
}>) {
  const { t } = useI18n();
  return (
    <LazyTerminalPane
      bridge={window.setsunaDesktop?.terminal ?? null}
      session={session}
      translate={t}
      onTitleChange={onTitleChange}
      openExternal={window.setsunaDesktop?.links?.openExternal}
      subscribeAppearanceChange={subscribeCodeAppearanceChange}
    />
  );
}

function subscribeCodeAppearanceChange(listener: () => void): () => void {
  window.addEventListener(CODE_APPEARANCE_CHANGE_EVENT_NAME, listener);
  return () => window.removeEventListener(CODE_APPEARANCE_CHANGE_EVENT_NAME, listener);
}
