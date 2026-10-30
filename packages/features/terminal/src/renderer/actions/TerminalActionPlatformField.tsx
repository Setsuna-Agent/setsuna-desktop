import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useId } from 'react';
import { TERMINAL_ACTION_PLATFORMS, type TerminalActionPlatform } from '../../contracts/index.js';

export function TerminalActionPlatformField({ value, onChange, translate: t }: {
  value: TerminalActionPlatform;
  onChange(platform: TerminalActionPlatform): void;
  translate: RendererTranslate;
}) {
  const group = useId();
  return <fieldset className="feature-terminal-action-platform">
    <legend>{t('feature.terminal.actions.platform')}</legend>
    {TERMINAL_ACTION_PLATFORMS.map((platform) => <label key={platform}>
      <input className="sd-visually-hidden" type="radio" name={group} value={platform} checked={value === platform}
        onChange={() => onChange(platform)} />
      <span>{t(`feature.terminal.actions.platform.${platform}`)}</span>
    </label>)}
  </fieldset>;
}
