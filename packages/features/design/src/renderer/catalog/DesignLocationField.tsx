import { useState } from 'react';
import { ChevronDown, Folder } from 'lucide-react';
import { workspaceRootName } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dropdown, useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignDirectory } from '../../contracts/index.js';

export type DesignLocationPicker = () => Promise<DesignDirectory | null>;

export function DesignLocationField({ directory, choose, onChange, disabled, translate: t }: Readonly<{
  directory: DesignDirectory | null; choose: DesignLocationPicker; onChange(value: DesignDirectory | null): void;
  disabled: boolean; translate: RendererTranslate;
}>) {
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  async function pick() {
    setPicking(true);
    try {
      const selected = await choose();
      if (selected) onChange(selected);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setPicking(false); }
  }
  const local = t('feature.design.localDesigns');
  const chooseLabel = t('feature.design.chooseLocation');
  return <Dropdown disabled={disabled || picking} placement="bottomLeft" menu={{
    selectedKeys: directory ? [] : ['local'],
    items: [
      { key: 'local', label: local, onClick: () => onChange(null) },
      { key: 'choose', label: chooseLabel, onClick: () => void pick() },
    ],
  }}>
    <Button size="small" variant="ghost" className="design-location-field" icon={<Folder size={14} />}
      aria-label={chooseLabel} title={directory?.path ?? chooseLabel} disabled={disabled || picking}>
      <span className="design-location-field__name">{directory ? workspaceRootName(directory) : local}</span>
      <ChevronDown size={12} aria-hidden="true" />
    </Button>
  </Dropdown>;
}
