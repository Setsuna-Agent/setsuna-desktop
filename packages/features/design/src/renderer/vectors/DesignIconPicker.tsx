import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button } from '@setsuna-desktop/renderer-ui';
import { DesignLucidePicker } from './DesignLucidePicker.js';
import { clipboardDesignSvg, designSvgAccept, type DesignSvgSource } from './design-svg-source.js';

export function DesignIconPicker({ onInsert, onClose, translate: t }: Readonly<{
  onInsert(source: DesignSvgSource): Promise<boolean>;
  onClose(): void;
  translate: RendererTranslate;
}>) {
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function insert(source: DesignSvgSource) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      if (await onInsert(source)) onClose();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <div className="design-icon-picker-panel"
    onPaste={(event) => {
      const source = clipboardDesignSvg(event.clipboardData);
      if (!source) return;
      event.preventDefault();
      event.stopPropagation();
      void insert(source);
    }}>
    <input ref={fileInput} type="file" accept={designSvgAccept} hidden onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void insert({ file });
    }} />
    <div className="design-icon-picker">
      <DesignLucidePicker disabled={busy} onPick={(source) => void insert(source)} translate={t}
        searchAction={<Button size="small" icon={<Upload size={14} />} disabled={busy} onClick={() => fileInput.current?.click()}>
          {t('feature.design.importSvg')}
        </Button>} />
    </div>
  </div>;
}
