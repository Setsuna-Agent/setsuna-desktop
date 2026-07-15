import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { RotateCw } from 'lucide-react';
import { SelectField } from '../primitives.js';
import {
  browserDeviceProfiles,
  resizeBrowserDevice,
  rotateBrowserDevice,
  selectBrowserDeviceProfile,
  type BrowserDeviceEmulationState,
  type BrowserDeviceProfileId,
} from './browserDeviceEmulation.js';

const browserDeviceScales = [0.25, 0.5, 0.75, 0.9, 1, 1.25] as const;

export function BrowserDeviceToolbar({
  onChange,
  value,
}: {
  onChange: (value: BrowserDeviceEmulationState) => void;
  value: BrowserDeviceEmulationState;
}) {
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
    <div aria-label="设备工具栏" className="desktop-browser-device-toolbar" role="toolbar">
      <span className="desktop-browser-device-toolbar__label">尺寸:</span>
      <SelectField
        aria-label="设备预设"
        className="desktop-browser-device-toolbar__profile"
        value={value.profileId}
        onValueChange={(profileId) => onChange(selectBrowserDeviceProfile(value, profileId as BrowserDeviceProfileId))}
      >
        {browserDeviceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
      </SelectField>
      <span className="desktop-browser-device-toolbar__dimensions">
        <input
          aria-label="视口宽度"
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
          aria-label="视口高度"
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
        aria-label="旋转设备"
        className="desktop-browser-device-toolbar__rotate"
        title="旋转设备"
        type="button"
        onClick={() => onChange(rotateBrowserDevice(value))}
      >
        <RotateCw size={14} />
      </button>
      <SelectField
        aria-label="设备缩放"
        className="desktop-browser-device-toolbar__scale"
        value={String(value.scale)}
        onValueChange={(scale) => onChange({ ...value, scale: Number(scale) })}
      >
        {browserDeviceScales.map((scale) => <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>)}
      </SelectField>
    </div>
  );
}
