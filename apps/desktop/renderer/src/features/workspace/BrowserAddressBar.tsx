import { ExternalLink } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function BrowserAddressBar({
  externalUrl,
  onChange,
  onNavigate,
  onOpenExternal,
  value,
}: {
  externalUrl: string | null;
  onChange: (value: string) => void;
  onNavigate: () => void;
  onOpenExternal: (url: string) => void;
  value: string;
}) {
  const { t } = useI18n();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onNavigate();
      }}
    >
      <span className="desktop-browser-address-bar">
        <input
          aria-label={t('workspace.browser.address')}
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
        {externalUrl ? (
          <button
            aria-label={t('workspace.browser.openExternal')}
            className="desktop-browser-address-bar__external"
            title={t('workspace.browser.openExternal')}
            type="button"
            onClick={() => onOpenExternal(externalUrl)}
          >
            <ExternalLink size={13} />
          </button>
        ) : null}
      </span>
    </form>
  );
}
