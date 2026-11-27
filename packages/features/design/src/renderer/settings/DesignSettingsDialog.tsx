import { Check, Crosshair, Grid2X2, Grid3X3, Grip, Image as ImageIcon, Keyboard, LayoutTemplate, Magnet, Minus, Palette, Plug, Ruler, Settings } from 'lucide-react';
import { Suspense, useContext, useId, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, Dialog, SegmentedControl, Slider, Switch, Tabs, TabsList, TabsTrigger } from '@setsuna-desktop/renderer-ui';
import {
  designAppearances, designBackgrounds, designGrids, designGridSpacingRange, designToolbarPositions, useDesignCanvasSettings, useDesignShortcutSettings,
  type DesignCanvasPreferences, type DesignToolbarPosition,
} from '../context/design-canvas-settings.js';
import { designClipboardCommand } from '../context/design-layer-shortcuts.js';
import { DesignUiHostContext, type DesignShortcutSettingsProps } from '../context/design-ui-host.js';
import { DesignMcpSettings } from './DesignMcpSettings.js';
import { designShortcutCommands } from './design-shortcuts.js';
import '../styles/design-tabbed-dialog.css';
import './design-settings.css';

const sections = [
  { id: 'canvas', icon: LayoutTemplate },
  { id: 'appearance', icon: Palette },
  { id: 'shortcuts', icon: Keyboard },
  { id: 'mcp', icon: Plug },
] as const;
const canvasSwitches = [
  { setting: 'showPixelGrid', icon: Grid3X3 },
  { setting: 'snapToPixelGrid', icon: Crosshair },
  { setting: 'snapToObjects', icon: Magnet },
] as const;
const gridIcons = { dots: Grip, lines: Grid2X2, hidden: Minus } as const;
type Translated = Readonly<{ translate: RendererTranslate }>;

export default function DesignSettingsDialog({ onClose, translate: t }: Translated & Readonly<{ onClose(): void }>) {
  const host = useContext(DesignUiHostContext);
  const ShortcutSettings = host?.ShortcutSettings;
  const ScrollOverlay = host?.ScrollOverlay;
  const mcp = host?.mcp;
  const [section, setSection] = useState('canvas');
  const scrollRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const title = t('feature.design.settings.title');
  const tabs = <Tabs className="design-tabbed-dialog__nav" variant="segment" value={section} onValueChange={setSection}>
    <TabsList aria-label={title}>
      {sections.filter(({ id }) => (id !== 'shortcuts' || ShortcutSettings) && (id !== 'mcp' || mcp)).map(({ id: item, icon: Icon }) =>
        <TabsTrigger key={item} id={`${id}-${item}`} aria-controls={`${id}-panel`} value={item}>
          <Icon size={14} aria-hidden="true" />
          {t(`feature.design.settings.${item}`)}
        </TabsTrigger>,
      )}
    </TabsList>
  </Tabs>;
  return <Dialog title={<span className="design-tabbed-dialog__title">
    <Settings size={15} aria-hidden="true" />
    <span className="design-tabbed-dialog__title-text">{title}</span>
  </span>} headerActions={tabs} width={720} className="design-tabbed-dialog design-settings" onClose={onClose}>
    <div className="design-settings__scroll-area" key={section}>
      <div className="design-settings__panel" ref={scrollRef} id={`${id}-panel`} role="tabpanel"
        data-section={section} aria-labelledby={`${id}-${section}`}>
        {/* ScrollOverlay observes the content root as settings and shortcut results change. */}
        <div className="design-settings__content">
          {section === 'canvas' ? <CanvasSettings translate={t} />
            : section === 'appearance' ? <AppearanceSettings translate={t} />
              : section === 'mcp' && host?.mcp ? <DesignMcpSettings bridge={host.mcp} copyText={host.copyText} translate={t} />
                : ShortcutSettings ? <Suspense fallback={null}><ShortcutsPanel Editor={ShortcutSettings} /></Suspense> : null}
        </div>
      </div>
      {ScrollOverlay ? <ScrollOverlay scrollRef={scrollRef} /> : null}
    </div>
  </Dialog>;
}

function CanvasSettings({ translate: t }: Translated) {
  const { settings, setSetting, setGridSpacing } = useDesignCanvasSettings();
  const { grid, gridSpacing } = settings;
  const id = useId();
  const gridLabel = t('feature.design.settings.grid');
  const spacing = grid === 'hidden' ? designGridSpacingRange.initial : gridSpacing[grid];
  const spacingText = `${spacing} px`;
  return <>
    <PreviewChoices label={t('feature.design.settings.background')} choices={designBackgrounds} value={settings.background}
      name={(background) => t(`feature.design.settings.background.${background}`)} onChange={(background) => setSetting('background', background)}
      preview={(background) => <span className="design-settings__preview design-settings__sample" data-design-background={background}
        data-design-appearance={settings.appearance} data-design-grid={grid} style={{ '--design-preview-grid-spacing': spacing } as CSSProperties} />} />
    <div className="design-settings__controls">
      <div className="design-settings__row">
        <span className="design-settings__row-label"><Grid2X2 size={16} aria-hidden="true" />{gridLabel}</span>
        <SegmentedControl label={gridLabel} value={grid}
          options={designGrids.map((value) => {
            const Icon = gridIcons[value];
            return { value, label: t(`feature.design.settings.grid.${value}`), icon: <Icon size={13} aria-hidden="true" /> };
          })}
          onChange={(grid) => setSetting('grid', grid)} />
      </div>
      {grid !== 'hidden' ? <div className="design-settings__row">
        <label className="design-settings__row-label" htmlFor={`${id}-grid-spacing`}>
          <Ruler size={16} aria-hidden="true" />{t('feature.design.settings.gridSpacing')}
        </label>
        <div className="design-settings__spacing-control">
          <Slider id={`${id}-grid-spacing`} min={designGridSpacingRange.min} max={designGridSpacingRange.max} step={designGridSpacingRange.step}
            value={spacing} aria-valuetext={spacingText} onChange={(event) => setGridSpacing(grid, event.currentTarget.valueAsNumber)} />
          <span aria-hidden="true">{spacingText}</span>
        </div>
      </div> : null}
      {canvasSwitches.map(({ setting, icon: Icon }) => {
        const label = t(`feature.design.${setting}`);
        return <div className="design-settings__row" key={setting}>
          <label className="design-settings__row-label" htmlFor={`${id}-${setting}`}>
            <Icon size={16} aria-hidden="true" />{label}
          </label>
          <Switch id={`${id}-${setting}`} label={label} checked={settings[setting]}
            onCheckedChange={(value) => setSetting(setting, value)} />
        </div>;
      })}
    </div>
  </>;
}

function AppearanceSettings({ translate: t }: Translated) {
  const { settings, setSetting } = useDesignCanvasSettings();
  const thumbnailsId = useId();
  const thumbnailsLabel = t('feature.design.settings.layerThumbnails');
  return <>
    <PreviewChoices label={t('feature.design.settings.canvasTheme')} choices={designAppearances} value={settings.appearance}
      name={(appearance) => t(`feature.design.settings.theme.${appearance}`)} onChange={(appearance) => setSetting('appearance', appearance)}
      preview={(appearance) => <WorkspacePreview appearance={appearance} />} />
    <PreviewChoices label={t('feature.design.settings.toolbarPosition')} choices={designToolbarPositions} value={settings.toolbarPosition}
      name={(position) => t(`feature.design.settings.toolbar.${position}`)} onChange={(position) => setSetting('toolbarPosition', position)}
      preview={(position) => <WorkspacePreview appearance={settings.appearance} position={position} />} />
    <div className="design-settings__controls">
      <div className="design-settings__row">
        <label className="design-settings__row-label" htmlFor={thumbnailsId}><ImageIcon size={16} aria-hidden="true" />{thumbnailsLabel}</label>
        <Switch id={thumbnailsId} label={thumbnailsLabel} checked={settings.showLayerThumbnails}
          onCheckedChange={(value) => setSetting('showLayerThumbnails', value)} />
      </div>
    </div>
  </>;
}

function PreviewChoices<Value extends string>({ label, choices, value, name, preview, onChange }: Readonly<{
  label: string;
  choices: readonly Value[];
  value: Value;
  name(choice: Value): string;
  preview(choice: Value): ReactNode;
  onChange(choice: Value): void;
}>) {
  return <fieldset className="design-settings__field">
    <legend>{label}</legend>
    <div className="design-settings__choices">
      {choices.map((choice) => <Button key={choice} size="small" variant="ghost" className="design-settings__choice"
        aria-pressed={value === choice} onClick={() => onChange(choice)}>
        <span aria-hidden="true">{preview(choice)}</span>
        <span className="design-settings__choice-label">
          {name(choice)}
          {value === choice ? <span className="design-settings__selected" aria-hidden="true"><Check size={12} strokeWidth={2.5} /></span> : null}
        </span>
      </Button>)}
    </div>
  </fieldset>;
}

function WorkspacePreview({ appearance, position }: Readonly<{
  appearance: DesignCanvasPreferences['appearance'];
  position?: DesignToolbarPosition;
}>) {
  const modes = appearance === 'system' && !position ? ['light', 'dark'] : [appearance];
  return <span className="design-settings__preview design-settings__workspace-preview" data-toolbar-preview={position}>
    <span className="design-settings__mini-window">
      {modes.map((mode) => <span className="design-settings__mini-workspace" data-design-appearance={mode} key={mode}>
        {position ? <span className="design-settings__mini-toolbar" /> : null}
      </span>)}
    </span>
  </span>;
}

function ShortcutsPanel({ Editor }: { Editor: ComponentType<DesignShortcutSettingsProps> }) {
  const shortcuts = useDesignShortcutSettings();
  return <Editor {...shortcuts} commands={designShortcutCommands} isClipboardBinding={(binding) => Boolean(designClipboardCommand(binding))} />;
}
