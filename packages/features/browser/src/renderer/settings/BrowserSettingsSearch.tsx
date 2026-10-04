import { Search } from 'lucide-react';
import { TextField } from '@setsuna-desktop/renderer-ui';

export function BrowserSettingsSearch({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <div className="browser-settings-page__search">
    <Search size={14} aria-hidden="true" />
    <TextField aria-label={label} placeholder={label} value={value} onChange={(event) => onChange(event.target.value)} />
  </div>;
}
