import { ExternalLink } from 'lucide-react';
import type { BrowserTranslate } from './messages.js';

export function BrowserAddressBar({
  externalUrl,
  onChange,
  onNavigate,
  onOpenExternal,
  translate,
  value,
}: {
  externalUrl: string | null;
  onChange: (value: string) => void;
  onNavigate: () => void;
  onOpenExternal: (url: string) => void;
  translate: BrowserTranslate;
  value: string;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onNavigate();
      }}
    >
      <span className="desktop-browser-address-bar">
        <input
          aria-label={translate('feature.browser.address')}
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
        {externalUrl ? (
          <button
            aria-label={translate('feature.browser.openExternal')}
            className="desktop-browser-address-bar__external"
            title={translate('feature.browser.openExternal')}
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
