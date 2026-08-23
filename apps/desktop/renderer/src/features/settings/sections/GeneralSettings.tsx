import type {
  DesktopWindowCloseBehavior,
  RuntimeConfigState,
  RuntimeInterfaceLanguage,
} from '@setsuna-desktop/contracts';
import {
  Bold,
  Code2,
  Globe2,
  Languages,
  Monitor,
  Moon,
  Paintbrush,
  Palette,
  PanelLeft,
  Power,
  SlidersHorizontal,
  Sun,
  Type,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { CodeFileView } from '../../../shared/code/PierreCode.js';
import { useCodeAppearance } from '../../../shared/code/CodeAppearanceProvider.js';
import {
  accentColorOptions,
  useAccentColorPreference,
  type AccentColor,
} from '../../../shared/preferences/useAccentColorPreference.js';
import {
  fontFamilyOptions,
  fontSizeOptions,
  fontWeightOptions,
  getFontFamilyOptionsForPlatform,
  useAppearancePreferences,
  type FontFamilyMode,
  type FontWeightMode,
} from '../../../shared/preferences/useAppearancePreferences.js';
import {
  codeFontFamilyOptions,
  codeThemeOptions,
  getCodeFontFamilyOptionsForPlatform,
  type CodeFontFamilyMode,
  type CodeTheme,
} from '../../../shared/preferences/useCodeAppearancePreferences.js';
import {
  sidebarBackgroundOptions,
  useSidebarBackgroundPreference,
  type SidebarBackgroundStyle,
} from '../../../shared/preferences/useSidebarBackgroundPreference.js';
import { useThemeTransition, type ThemeMode } from '../../../shared/preferences/useThemeTransition.js';
import { normalizeAppLocale, useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../../shared/i18n/messages.js';
import { SelectField } from '../../../shared/ui/primitives.js';
import { markdownLinkOpenModeFromConfig } from '../../chat/markdown/markdownLinkPreference.js';
import { SettingsChoiceGroup, type SettingsChoiceOption } from '../components/SettingsControls.js';
import type { RuntimePreferenceInput } from '../settings-types.js';
import { useDesktopWindowCloseBehavior } from './useDesktopWindowCloseBehavior.js';

const themeModeLabelKeys: Record<ThemeMode, MessageKey> = {
  light: 'settings.general.theme.light',
  dark: 'settings.general.theme.dark',
  system: 'settings.general.theme.system',
};

const accentColorLabelKeys: Record<AccentColor, MessageKey> = {
  neutral: 'settings.general.accent.default',
  blue: 'settings.general.accent.blue',
  purple: 'settings.general.accent.purple',
  green: 'settings.general.accent.green',
  orange: 'settings.general.accent.orange',
};

const sidebarBackgroundLabelKeys: Record<SidebarBackgroundStyle, MessageKey> = {
  soft: 'settings.general.sidebar.soft',
  plain: 'settings.general.sidebar.plain',
  contrast: 'settings.general.sidebar.contrast',
};

const fontWeightLabelKeys: Record<FontWeightMode, MessageKey> = {
  '400': 'settings.general.fontWeight.light',
  '500': 'settings.general.fontWeight.regular',
  '600': 'settings.general.fontWeight.semibold',
};

export function GeneralSettings({
  config,
  onSave,
}: {
  config: RuntimeConfigState | null;
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
}) {
  const { locale, setLocale, t } = useI18n();
  const { fontFamily, fontSize, fontWeight, setFontFamily, setFontSize, setFontWeight } = useAppearancePreferences();
  const { codeFontFamily, codeTheme, setCodeFontFamily, setCodeTheme } = useCodeAppearance();
  const { sidebarBackgroundStyle, setSidebarBackgroundStyle } = useSidebarBackgroundPreference();
  const { mode, setThemeModeWithTransition } = useThemeTransition();
  const { accentColor, setAccentColor } = useAccentColorPreference();
  const supportsWindowCloseBehavior = typeof window !== 'undefined'
    && window.setsunaDesktop?.desktop.platform === 'win32';
  const windowCloseBehavior = useDesktopWindowCloseBehavior(supportsWindowCloseBehavior);
  const availableFontFamilyOptions = getFontFamilyOptionsForPlatform();
  const availableCodeFontFamilyOptions = getCodeFontFamilyOptionsForPlatform();
  const selectedFont = availableFontFamilyOptions.find((item) => item.value === fontFamily) ?? fontFamilyOptions.find((item) => item.value === fontFamily) ?? availableFontFamilyOptions[0] ?? fontFamilyOptions[0];
  const selectedCodeFont = availableCodeFontFamilyOptions.find((item) => item.value === codeFontFamily) ?? codeFontFamilyOptions.find((item) => item.value === codeFontFamily) ?? availableCodeFontFamilyOptions[0] ?? codeFontFamilyOptions[0];
  const selectedCodeTheme = codeThemeOptions.find((item) => item.value === codeTheme) ?? codeThemeOptions[0];
  const fontFamilySelectOptions = availableFontFamilyOptions.some((item) => item.value === selectedFont.value) ? availableFontFamilyOptions : [selectedFont, ...availableFontFamilyOptions];
  const codeFontFamilySelectOptions = availableCodeFontFamilyOptions.some((item) => item.value === selectedCodeFont.value) ? availableCodeFontFamilyOptions : [selectedCodeFont, ...availableCodeFontFamilyOptions];
  const themeModeOptions: Array<SettingsChoiceOption<ThemeMode>> = [
    { value: 'light', label: t(themeModeLabelKeys.light), icon: <Sun size={14} /> },
    { value: 'dark', label: t(themeModeLabelKeys.dark), icon: <Moon size={14} /> },
    { value: 'system', label: t(themeModeLabelKeys.system), icon: <Monitor size={14} /> },
  ];
  const accentColorChoiceOptions: Array<SettingsChoiceOption<AccentColor>> = accentColorOptions.map((option) => ({
    value: option.value,
    label: t(accentColorLabelKeys[option.value]),
    icon: (
      <span
        className="chat-user-settings__accent-swatch"
        style={{
          '--settings-accent-swatch-light': option.lightSwatch,
          '--settings-accent-swatch-dark': option.darkSwatch,
        } as CSSProperties}
      />
    ),
  }));
  const sidebarBackgroundChoiceOptions: Array<SettingsChoiceOption<SidebarBackgroundStyle>> = sidebarBackgroundOptions.map((option) => ({
    value: option.value,
    label: t(sidebarBackgroundLabelKeys[option.value]),
    icon: (
      <span
        className="chat-user-settings__sidebar-background-swatch"
        style={{
          '--settings-sidebar-background-swatch-light': option.lightSwatch,
          '--settings-sidebar-background-swatch-dark': option.darkSwatch,
        } as CSSProperties}
      />
    ),
  }));
  const fontSizeIndex = Math.max(0, fontSizeOptions.indexOf(fontSize));
  const scaleMarkMaxIndex = Math.max(fontSizeOptions.length - 1, 1);
  const fontSizeProgress = `${(fontSizeIndex / scaleMarkMaxIndex) * 100}%`;
  const markdownLinkOpenMode = markdownLinkOpenModeFromConfig(config);
  const setMarkdownLinkOpenMode = (nextValue: string) => {
    if (!config || (nextValue !== 'in-app' && nextValue !== 'external')) return;
    void onSave({
      desktopSettings: {
        ...(config.desktopSettings ?? {}),
        markdownLinkOpenMode: nextValue,
      },
    });
  };
  const setInterfaceLanguage = (nextValue: string) => {
    const nextLocale = normalizeAppLocale(nextValue);
    if (!config || !nextLocale) return;
    const previousLocale = locale;
    setLocale(nextLocale);
    void onSave({
      desktopSettings: {
        ...(config.desktopSettings ?? {}),
        interfaceLanguage: nextLocale,
      },
    }).catch(() => setLocale(previousLocale));
  };

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__section--general">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.general.language')}</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Languages size={14} />
              <span>{t('settings.general.interfaceLanguage')}</span>
            </span>
            <SelectField
              aria-label={t('settings.general.interfaceLanguage')}
              className="settings-local-control"
              disabled={!config}
              value={locale}
              onValueChange={setInterfaceLanguage}
            >
              <option value={'zh-CN' satisfies RuntimeInterfaceLanguage}>{t('settings.general.languageChinese')}</option>
              <option value={'en-US' satisfies RuntimeInterfaceLanguage}>{t('settings.general.languageEnglish')}</option>
            </SelectField>
          </label>
        </div>
      </div>

      {supportsWindowCloseBehavior ? (
        <div className="chat-user-settings__section-block">
          <div className="chat-user-settings__group-title">{t('settings.general.window')}</div>
          <div className="chat-user-settings__group chat-user-settings__general-section">
            <label className="chat-user-settings__row">
              <span className="chat-user-settings__row-label">
                <Power size={14} />
                <span>{t('settings.general.closeBehavior')}</span>
              </span>
              <span className="settings-window-close-behavior__control">
                <SelectField
                  aria-label={t('settings.general.closeBehavior')}
                  className="settings-local-control"
                  disabled={windowCloseBehavior.pending}
                  value={windowCloseBehavior.closeBehavior ?? 'quit'}
                  onValueChange={(nextValue) => {
                    if (!isDesktopWindowCloseBehavior(nextValue)) return;
                    void windowCloseBehavior.setCloseBehavior(nextValue);
                  }}
                >
                  <option value="quit">{t('settings.general.closeQuit')}</option>
                  <option value="hide-to-tray">{t('settings.general.closeHideToTray')}</option>
                </SelectField>
                {windowCloseBehavior.error ? (
                  <small className="settings-window-close-behavior__error" role="alert">
                    {t('settings.general.closeBehaviorError')}
                  </small>
                ) : null}
              </span>
            </label>
          </div>
        </div>
      ) : null}

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.general.font')}</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Type size={14} />
              <span>{t('settings.general.interfaceFont')}</span>
            </span>
            <SelectField className="settings-local-control" value={selectedFont.value} style={{ fontFamily: selectedFont.css }} onValueChange={(nextValue) => setFontFamily(nextValue as FontFamilyMode)}>
              {fontFamilySelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Bold size={14} />
              <span>{t('settings.general.interfaceFontWeight')}</span>
            </span>
            <SelectField aria-label={t('settings.general.interfaceFontWeight')} className="settings-local-control" value={fontWeight} onValueChange={(nextValue) => setFontWeight(nextValue as FontWeightMode)}>
              {fontWeightOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(fontWeightLabelKeys[option.value])}
                </option>
              ))}
            </SelectField>
          </label>
          <div className="chat-user-settings__font-preview" style={{ fontFamily: selectedFont.css, fontWeight }}>
            <div className="chat-user-settings__font-preview-pane">
              <span className="chat-user-settings__font-preview-label">Plain Text</span>
              <div className="chat-user-settings__font-preview-body">
                <strong>Setsuna Agent</strong>
                <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
                <p>abcdefghijklmnopqrstuvwxyz</p>
                <p>Readable interface text, numbers 1234567890, and punctuation .,;!?()[]</p>
                <p>{t('settings.general.fontPreviewText')}</p>
              </div>
            </div>
            <div className="chat-user-settings__font-preview-pane">
              <span className="chat-user-settings__font-preview-label">Markdown</span>
              <div className="chat-user-settings__font-preview-body chat-user-settings__font-preview-markdown">
                <strong>1. Markdown preview</strong>
                <p>{t('settings.general.fontPreviewMarkdown')}</p>
                <ul>
                  <li>
                    {t('settings.general.fontPreviewClean')}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.general.code')}</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Code2 size={14} />
              <span>{t('settings.general.codeFont')}</span>
            </span>
            <SelectField aria-label={t('settings.general.codeFont')} className="settings-local-control" value={selectedCodeFont.value} style={{ fontFamily: selectedCodeFont.css }} onValueChange={(nextValue) => setCodeFontFamily(nextValue as CodeFontFamilyMode)}>
              {codeFontFamilySelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Paintbrush size={14} />
              <span>{t('settings.general.codeTheme')}</span>
            </span>
            <SelectField aria-label={t('settings.general.codeTheme')} className="settings-local-control" value={codeTheme} onValueChange={(nextValue) => setCodeTheme(nextValue as CodeTheme)}>
              {codeThemeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === 'pierre' ? t('settings.general.codeTheme.recommended') : option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <CodeAppearancePreview
            fontLabel={selectedCodeFont.label}
            themeLabel={selectedCodeTheme.value === 'pierre' ? t('settings.general.codeTheme.recommended') : selectedCodeTheme.label}
          />
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.general.appearance')}</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <SlidersHorizontal size={14} />
              <span>{t('settings.general.pageScale')}</span>
            </span>
            <div className="chat-user-settings__slider" style={{ '--settings-scale-progress': fontSizeProgress } as CSSProperties}>
              <div className="settings-scale-control__range">
                <input id="settings-page-scale" aria-label={t('settings.general.pageScale')} type="range" min={0} max={fontSizeOptions.length - 1} step={1} value={fontSizeIndex} onChange={(event) => setFontSize(fontSizeOptions[Number(event.currentTarget.value)] ?? '100')} />
                <div className="settings-scale-control__marks" aria-hidden="true">
                  {fontSizeOptions.map((option, index) => Number(option) % 10 === 0 ? (
                    <span
                      key={option}
                      className={`${index === 0 ? 'is-first' : ''} ${index === fontSizeOptions.length - 1 ? 'is-last' : ''} ${option === fontSize ? 'is-current' : ''}`}
                      style={{ '--settings-scale-mark-left': `${(index / scaleMarkMaxIndex) * 100}%` } as CSSProperties}
                    >
                      {option}%
                    </span>
                  ) : null)}
                </div>
              </div>
              <output htmlFor="settings-page-scale">{fontSize}%</output>
            </div>
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <PanelLeft size={14} />
              <span>{t('settings.general.sidebarBackground')}</span>
            </span>
            <SettingsChoiceGroup
              ariaLabel={t('settings.general.sidebarBackground')}
              options={sidebarBackgroundChoiceOptions}
              value={sidebarBackgroundStyle}
              onChange={setSidebarBackgroundStyle}
            />
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Sun size={14} />
              <span>{t('settings.general.appearanceMode')}</span>
            </span>
            <SettingsChoiceGroup ariaLabel={t('settings.general.appearanceMode')} options={themeModeOptions} value={mode} onChange={setThemeModeWithTransition} />
          </div>
          <div className="chat-user-settings__row chat-user-settings__accent-row">
            <span className="chat-user-settings__row-label">
              <Palette size={14} />
              <span>{t('settings.general.accentColor')}</span>
            </span>
            <SettingsChoiceGroup ariaLabel={t('settings.general.accentColor')} options={accentColorChoiceOptions} value={accentColor} onChange={setAccentColor} />
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">{t('settings.general.links')}</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Globe2 size={14} />
              <span>{t('settings.general.markdownLinks')}</span>
            </span>
            <SelectField
              aria-label={t('settings.general.markdownLinksMode')}
              className="settings-local-control"
              disabled={!config}
              value={markdownLinkOpenMode}
              onValueChange={setMarkdownLinkOpenMode}
            >
              <option value="in-app">{t('settings.general.openInApp')}</option>
              <option value="external">{t('settings.general.openExternal')}</option>
            </SelectField>
          </label>
        </div>
      </div>
    </div>
  );
}

function isDesktopWindowCloseBehavior(value: string): value is DesktopWindowCloseBehavior {
  return value === 'quit' || value === 'hide-to-tray';
}

function CodeAppearancePreview({ fontLabel, themeLabel }: { fontLabel: string; themeLabel: string }) {
  const { t } = useI18n();
  const contents = [
    "import { useMemo } from 'react';",
    t('settings.general.codePreviewComment'),
    'const total = items.reduce((sum, item) => sum + item.price, 0);',
    'return formatCurrency(total);',
  ].join('\n');
  return (
    <div className="chat-user-settings__code-preview" aria-label={t('settings.general.codePreview')}>
      <div className="chat-user-settings__code-preview-frame">
        <div className="chat-user-settings__code-preview-header">
          <span><Code2 size={12} /> TypeScript</span>
          <span>{`${fontLabel} · ${themeLabel}`}</span>
        </div>
        <CodeFileView
          className="chat-user-settings__code-preview-body"
          contents={contents}
          language="typescript"
          name="settings-preview.ts"
        />
      </div>
    </div>
  );
}
