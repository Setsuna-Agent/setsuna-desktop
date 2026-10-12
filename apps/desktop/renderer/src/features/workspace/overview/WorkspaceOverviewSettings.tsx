import { Button, IconButton, Popover, Slider, Switch } from '@setsuna-desktop/renderer-ui';
import { Blend, ImagePlus, PanelTop, RotateCcw, Settings } from 'lucide-react';
import { useId, useRef } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { WORKSPACE_BACKGROUND_ACCEPT } from './workspaceBackground.js';

export function WorkspaceOverviewSettings({ hasImage, busy, transparency, headerVisible, onHeaderVisibleChange, onTransparencyChange, onChange }: {
  hasImage: boolean;
  busy: boolean;
  transparency: number;
  headerVisible: boolean;
  onHeaderVisibleChange(visible: boolean): void;
  onTransparencyChange(value: number): void;
  onChange(file: File | null): Promise<void>;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const sliderId = useId();
  const transparencyLabel = t('workspace.overview.background.transparency');
  const settingsLabel = t('workspace.overview.settings');
  const headerLabel = t('workspace.overview.showHeader');

  return <div className="desktop-workspace-overview__toolbar">
    <input ref={input} type="file" hidden accept={WORKSPACE_BACKGROUND_ACCEPT} onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void onChange(file);
    }} />
    <Popover placement="bottomRight" contentLabel={settingsLabel}
      className="desktop-workspace-overview__settings-popover" content={
        <div className="desktop-workspace-overview__settings">
          <label className="desktop-workspace-overview__setting-row">
            <span className="desktop-workspace-overview__setting-label"><PanelTop size={14} aria-hidden="true" />{headerLabel}</span>
            <Switch label={headerLabel} checked={headerVisible} onCheckedChange={onHeaderVisibleChange} />
          </label>
          <div className="desktop-workspace-overview__background-settings">
            <Button variant="ghost" className="desktop-workspace-overview__setting-action" icon={<ImagePlus size={14} aria-hidden="true" />} disabled={busy}
              onClick={() => input.current?.click()}>{t('workspace.overview.background.choose')}</Button>
            {hasImage ? <>
              <div className="desktop-workspace-overview__transparency">
                <label htmlFor={sliderId} className="desktop-workspace-overview__setting-label"><Blend size={14} aria-hidden="true" />{transparencyLabel}</label>
                <output htmlFor={sliderId}>{transparency}%</output>
                <Slider id={sliderId} min={0} max={100} step={1} value={transparency}
                  onChange={(event) => onTransparencyChange(Number(event.currentTarget.value))} />
              </div>
              <Button variant="ghost" className="desktop-workspace-overview__setting-action" icon={<RotateCcw size={14} aria-hidden="true" />} disabled={busy}
                onClick={() => void onChange(null)}>{t('workspace.overview.background.reset')}</Button>
            </> : null}
          </div>
        </div>
      }>
      <IconButton className="desktop-workspace-overview__settings-trigger" label={settingsLabel}><Settings size={15} /></IconButton>
    </Popover>
  </div>;
}
