import type { WorkspaceProjectIcon } from '@setsuna-desktop/contracts';
import { Button, IconButton, Popover, Tooltip } from '@setsuna-desktop/renderer-ui';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconColorPicker } from '../../shared/ui/IconColorPicker.js';
import { ProjectIcon } from '../../shared/ui/ProjectIcon.js';
import { PROJECT_ICON_PRESET_KEYS } from '../../shared/ui/project-icon-presets.js';
import './project-icon-picker.css';

export function ProjectIconPicker({ value, disabled, onChange }: Readonly<{
  value: WorkspaceProjectIcon | null;
  disabled: boolean;
  onChange(icon: WorkspaceProjectIcon | null): void;
}>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const color = value?.color;

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen} placement="bottomLeft"
      className="desktop-project-icon-picker" contentLabel={t('sidebar.projectIcon')}
      content={(
        <>
          <div className="desktop-project-icon-picker__toolbar">
            <IconColorPicker value={color ?? 'text'} disabled={disabled}
              label={t('sidebar.projectIconColors')} colorLabel={(color) => t('sidebar.projectIconColor', { color })}
              onChange={(color) => onChange({ key: value?.key ?? 'folder', ...(color === 'text' ? {} : { color }) })} />
            <IconButton label={t('sidebar.resetProjectIcon')} disabled={disabled || !value}
              onClick={() => { onChange(null); setOpen(false); }}>
              <RotateCcw size={14} />
            </IconButton>
          </div>
          <div className="desktop-project-icon-picker__grid" role="group" aria-label={t('sidebar.projectIcon')}>
            {PROJECT_ICON_PRESET_KEYS.map((key) => (
              <Tooltip key={key} title={t(`sidebar.projectIcon.${key}`)}>
                <Button type="button" variant="ghost" className="desktop-project-icon-picker__choice"
                  disabled={disabled} aria-label={t(`sidebar.projectIcon.${key}`)} aria-pressed={(value?.key ?? 'folder') === key}
                  onClick={() => onChange(color ? { key, color } : { key })}>
                  <ProjectIcon icon={{ key, color }} size={16} />
                </Button>
              </Tooltip>
            ))}
          </div>
        </>
      )}>
      <IconButton label={t('sidebar.changeProjectIcon')} disabled={disabled}>
        <ProjectIcon icon={value} size={16} />
      </IconButton>
    </Popover>
  );
}
