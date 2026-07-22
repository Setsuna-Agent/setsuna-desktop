import { ExternalLink } from 'lucide-react';

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
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onNavigate();
      }}
    >
      <span className="desktop-browser-address-bar">
        <input
          aria-label="网址或搜索内容"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
        {externalUrl ? (
          <button
            aria-label="在系统浏览器中打开"
            className="desktop-browser-address-bar__external"
            title="在系统浏览器中打开"
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
