import type { RuntimeConfigState, RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
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
  SlidersHorizontal,
  Sun,
  Type,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
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
  codeColorSchemeOptions,
  codeFontFamilyOptions,
  codeHighlightThemeOptions,
  getCodeFontFamilyOptionsForPlatform,
  useCodeAppearancePreferences,
  type CodeColorScheme,
  type CodeFontFamilyMode,
  type CodeHighlightTheme,
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
  const { codeColorScheme, codeFontFamily, codeHighlightTheme, setCodeColorScheme, setCodeFontFamily, setCodeHighlightTheme } = useCodeAppearancePreferences();
  const { sidebarBackgroundStyle, setSidebarBackgroundStyle } = useSidebarBackgroundPreference();
  const { mode, setThemeModeWithTransition } = useThemeTransition();
  const { accentColor, setAccentColor } = useAccentColorPreference();
  const availableFontFamilyOptions = getFontFamilyOptionsForPlatform();
  const availableCodeFontFamilyOptions = getCodeFontFamilyOptionsForPlatform();
  const selectedFont = availableFontFamilyOptions.find((item) => item.value === fontFamily) ?? fontFamilyOptions.find((item) => item.value === fontFamily) ?? availableFontFamilyOptions[0] ?? fontFamilyOptions[0];
  const selectedCodeFont = availableCodeFontFamilyOptions.find((item) => item.value === codeFontFamily) ?? codeFontFamilyOptions.find((item) => item.value === codeFontFamily) ?? availableCodeFontFamilyOptions[0] ?? codeFontFamilyOptions[0];
  const selectedCodeHighlightTheme = codeHighlightThemeOptions.find((item) => item.value === codeHighlightTheme) ?? codeHighlightThemeOptions[0];
  const selectedCodeColorScheme = codeColorSchemeOptions.find((item) => item.value === codeColorScheme) ?? codeColorSchemeOptions[0];
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
              <span>{t('settings.general.codeHighlightTheme')}</span>
            </span>
            <SelectField aria-label={t('settings.general.codeHighlightTheme')} className="settings-local-control" value={codeHighlightTheme} onValueChange={(nextValue) => setCodeHighlightTheme(nextValue as CodeHighlightTheme)}>
              {codeHighlightThemeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === 'chatgpt' ? t('settings.general.codeTheme.recommended') : option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Palette size={14} />
              <span>{t('settings.general.codeColorScheme')}</span>
            </span>
            <SelectField aria-label={t('settings.general.codeColorScheme')} className="settings-local-control" value={codeColorScheme} onValueChange={(nextValue) => setCodeColorScheme(nextValue as CodeColorScheme)}>
              {codeColorSchemeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === 'theme' ? t('settings.general.codeScheme.theme') : option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <CodeAppearancePreview
            colorSchemeLabel={selectedCodeColorScheme.value === 'theme' ? t('settings.general.codeScheme.theme') : selectedCodeColorScheme.label}
            fontFamily={selectedCodeFont.css}
            fontLabel={selectedCodeFont.label}
            themeLabel={selectedCodeHighlightTheme.value === 'chatgpt' ? t('settings.general.codeTheme.recommended') : selectedCodeHighlightTheme.label}
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

function CodeAppearancePreview({ colorSchemeLabel, fontFamily, fontLabel, themeLabel }: { colorSchemeLabel: string; fontFamily: string; fontLabel: string; themeLabel: string }) {
  const { t } = useI18n();
  return (
    <div className="chat-user-settings__code-preview" aria-label={t('settings.general.codePreview')}>
      <div className="chat-user-settings__code-preview-header">
        <span><Code2 size={12} /> TypeScript</span>
        <span>{`${fontLabel} · ${themeLabel} · ${colorSchemeLabel}`}</span>
      </div>
      <code className="chat-user-settings__code-preview-body" style={{ fontFamily }}>
        <CodePreviewLine number={1}>
          <span className="is-keyword">import</span>
          <span className="is-meta"> {'{'} </span>
          <span className="is-function">useMemo</span>
          <span className="is-meta"> {'}'} </span>
          <span className="is-keyword">from</span>
          <span> </span>
          <span className="is-string">'react'</span>
          <span className="is-meta">;</span>
        </CodePreviewLine>
        <CodePreviewLine number={2}>
          <span className="is-comment">{t('settings.general.codePreviewComment')}</span>
        </CodePreviewLine>
        <CodePreviewLine number={3}>
          <span className="is-keyword">const</span>
          <span className="is-variable"> total </span>
          <span className="is-meta">=</span>
          <span className="is-variable"> items.</span>
          <span className="is-function">reduce</span>
          <span className="is-meta">((</span>
          <span className="is-variable">sum, item</span>
          <span className="is-meta">) =&gt;</span>
          <span className="is-variable"> sum </span>
          <span className="is-meta">+</span>
          <span className="is-variable"> item.</span>
          <span className="is-attribute">price</span>
          <span className="is-meta">, </span>
          <span className="is-number">0</span>
          <span className="is-meta">);</span>
        </CodePreviewLine>
        <CodePreviewLine number={4}>
          <span className="is-keyword">return</span>
          <span> </span>
          <span className="is-function">formatCurrency</span>
          <span className="is-meta">(</span>
          <span className="is-variable">total</span>
          <span className="is-meta">);</span>
        </CodePreviewLine>
      </code>
    </div>
  );
}

function CodePreviewLine({ children, number }: { children: ReactNode; number: number }) {
  return (
    <span className="chat-user-settings__code-preview-line">
      <span aria-hidden="true">{number}</span>
      <span>{children}</span>
    </span>
  );
}
