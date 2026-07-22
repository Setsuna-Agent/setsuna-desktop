import { RotateCw } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../shared/i18n/messages.js';
import { SelectField } from '../../shared/ui/primitives.js';
import {
  browserDeviceProfiles,
  resizeBrowserDevice,
  rotateBrowserDevice,
  selectBrowserDeviceProfile,
  type BrowserDeviceEmulationState,
  type BrowserDeviceProfileId,
} from './browserDeviceEmulation.js';

const browserDeviceScales = [0.25, 0.5, 0.75, 0.9, 1, 1.25] as const;
const browserDeviceProfileLabelKeys: Partial<Record<BrowserDeviceProfileId, MessageKey>> = {
  responsive: 'workspace.browser.device.responsive',
  laptop: 'workspace.browser.device.laptop',
};

export function BrowserDeviceToolbar({
  onChange,
  value,
}: {
  onChange: (value: BrowserDeviceEmulationState) => void;
  value: BrowserDeviceEmulationState;
}) {
  const { t } = useI18n();
  const [heightDraft, setHeightDraft] = useState(() => String(value.height));
  const [widthDraft, setWidthDraft] = useState(() => String(value.width));

  useEffect(() => setWidthDraft(String(value.width)), [value.width]);
  useEffect(() => setHeightDraft(String(value.height)), [value.height]);

  const commitDimension = (dimension: 'height' | 'width') => {
    const draft = dimension === 'width' ? widthDraft : heightDraft;
    const next = resizeBrowserDevice(value, dimension, draft.trim() ? Number(draft) : Number.NaN);
    if (dimension === 'width') setWidthDraft(String(next.width));
    else setHeightDraft(String(next.height));
    onChange(next);
  };

  const blurOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  return (
    <div aria-label={t('workspace.browser.deviceToolbar')} className="desktop-browser-device-toolbar" role="toolbar">
      <span className="desktop-browser-device-toolbar__label">{t('workspace.browser.size')}</span>
      <SelectField
        aria-label={t('workspace.browser.devicePreset')}
        className="desktop-browser-device-toolbar__profile"
        value={value.profileId}
        onValueChange={(profileId) => onChange(selectBrowserDeviceProfile(value, profileId as BrowserDeviceProfileId))}
      >
        {browserDeviceProfiles.map((profile) => {
          const labelKey = browserDeviceProfileLabelKeys[profile.id];
          return (
            <option key={profile.id} value={profile.id}>
              {labelKey ? t(labelKey) : profile.label}
            </option>
          );
        })}
      </SelectField>
      <span className="desktop-browser-device-toolbar__dimensions">
        <input
          aria-label={t('workspace.browser.viewportWidth')}
          inputMode="numeric"
          max={5120}
          min={240}
          type="number"
          value={widthDraft}
          onBlur={() => commitDimension('width')}
          onChange={(event) => setWidthDraft(event.currentTarget.value)}
          onKeyDown={blurOnEnter}
        />
        <span aria-hidden="true">×</span>
        <input
          aria-label={t('workspace.browser.viewportHeight')}
          inputMode="numeric"
          max={5120}
          min={240}
          type="number"
          value={heightDraft}
          onBlur={() => commitDimension('height')}
          onChange={(event) => setHeightDraft(event.currentTarget.value)}
          onKeyDown={blurOnEnter}
        />
      </span>
      <button
        aria-label={t('workspace.browser.rotateDevice')}
        className="desktop-browser-device-toolbar__rotate"
        title={t('workspace.browser.rotateDevice')}
        type="button"
        onClick={() => onChange(rotateBrowserDevice(value))}
      >
        <RotateCw size={14} />
      </button>
      <SelectField
        aria-label={t('workspace.browser.deviceZoom')}
        className="desktop-browser-device-toolbar__scale"
        value={String(value.scale)}
        onValueChange={(scale) => onChange({ ...value, scale: Number(scale) })}
      >
        {browserDeviceScales.map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}
      </SelectField>
    </div>
  );
}
