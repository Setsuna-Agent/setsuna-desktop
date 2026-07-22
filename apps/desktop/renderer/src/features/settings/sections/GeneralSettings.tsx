import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import {
  Bold,
  Code2,
  Globe2,
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
import { SelectField } from '../../../shared/ui/primitives.js';
import { markdownLinkOpenModeFromConfig } from '../../chat/markdown/markdownLinkPreference.js';
import { SettingsChoiceGroup, type SettingsChoiceOption } from '../components/SettingsControls.js';
import type { RuntimePreferenceInput } from '../settings-types.js';

const themeModeOptions: Array<SettingsChoiceOption<ThemeMode>> = [
  { value: 'light', label: '浅色', icon: <Sun size={14} /> },
  { value: 'dark', label: '深色', icon: <Moon size={14} /> },
  { value: 'system', label: '系统', icon: <Monitor size={14} /> },
];

const accentColorChoiceOptions: Array<SettingsChoiceOption<AccentColor>> = accentColorOptions.map((option) => ({
  value: option.value,
  label: option.label,
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
  label: option.label,
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

export function GeneralSettings({
  config,
  onSave,
}: {
  config: RuntimeConfigState | null;
  onSave: (input: RuntimePreferenceInput) => Promise<void>;
}) {
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

  return (
    <div className="chat-user-settings__section chat-user-settings__section--stacked chat-user-settings__section--general">
      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">字体</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Type size={14} />
              <span>界面字体</span>
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
              <span>界面字重</span>
            </span>
            <SelectField aria-label="界面字重" className="settings-local-control" value={fontWeight} onValueChange={(nextValue) => setFontWeight(nextValue as FontWeightMode)}>
              {fontWeightOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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
                <p>普通文本预览：观察中文、英文、数字和标点的字重与间距。</p>
              </div>
            </div>
            <div className="chat-user-settings__font-preview-pane">
              <span className="chat-user-settings__font-preview-label">Markdown</span>
              <div className="chat-user-settings__font-preview-body chat-user-settings__font-preview-markdown">
                <strong>1. Markdown preview</strong>
                <p>
                  Use <code>inline code</code> with links, emphasis, and mixed 中文内容.
                </p>
                <ul>
                  <li>
                    <strong>Clean:</strong> headings, lists, and code stay balanced.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">代码</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Code2 size={14} />
              <span>代码字体</span>
            </span>
            <SelectField aria-label="代码字体" className="settings-local-control" value={selectedCodeFont.value} style={{ fontFamily: selectedCodeFont.css }} onValueChange={(nextValue) => setCodeFontFamily(nextValue as CodeFontFamilyMode)}>
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
              <span>高亮主题</span>
            </span>
            <SelectField aria-label="代码高亮主题" className="settings-local-control" value={codeHighlightTheme} onValueChange={(nextValue) => setCodeHighlightTheme(nextValue as CodeHighlightTheme)}>
              {codeHighlightThemeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Palette size={14} />
              <span>配色方案</span>
            </span>
            <SelectField aria-label="代码配色方案" className="settings-local-control" value={codeColorScheme} onValueChange={(nextValue) => setCodeColorScheme(nextValue as CodeColorScheme)}>
              {codeColorSchemeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>
          <CodeAppearancePreview
            colorSchemeLabel={selectedCodeColorScheme.label}
            fontFamily={selectedCodeFont.css}
            fontLabel={selectedCodeFont.label}
            themeLabel={selectedCodeHighlightTheme.label}
          />
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">外观</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <SlidersHorizontal size={14} />
              <span>页面缩放</span>
            </span>
            <div className="chat-user-settings__slider" style={{ '--settings-scale-progress': fontSizeProgress } as CSSProperties}>
              <div className="settings-scale-control__range">
                <input id="settings-page-scale" aria-label="页面缩放" type="range" min={0} max={fontSizeOptions.length - 1} step={1} value={fontSizeIndex} onChange={(event) => setFontSize(fontSizeOptions[Number(event.currentTarget.value)] ?? '100')} />
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
              <span>侧栏背景</span>
            </span>
            <SettingsChoiceGroup
              ariaLabel="侧栏背景"
              options={sidebarBackgroundChoiceOptions}
              value={sidebarBackgroundStyle}
              onChange={setSidebarBackgroundStyle}
            />
          </div>
          <div className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Sun size={14} />
              <span>外观模式</span>
            </span>
            <SettingsChoiceGroup ariaLabel="外观模式" options={themeModeOptions} value={mode} onChange={setThemeModeWithTransition} />
          </div>
          <div className="chat-user-settings__row chat-user-settings__accent-row">
            <span className="chat-user-settings__row-label">
              <Palette size={14} />
              <span>强调色</span>
            </span>
            <SettingsChoiceGroup ariaLabel="强调色" options={accentColorChoiceOptions} value={accentColor} onChange={setAccentColor} />
          </div>
        </div>
      </div>

      <div className="chat-user-settings__section-block">
        <div className="chat-user-settings__group-title">链接</div>
        <div className="chat-user-settings__group chat-user-settings__general-section">
          <label className="chat-user-settings__row">
            <span className="chat-user-settings__row-label">
              <Globe2 size={14} />
              <span>Markdown Web 链接</span>
            </span>
            <SelectField
              aria-label="Markdown Web 链接打开方式"
              className="settings-local-control"
              disabled={!config}
              value={markdownLinkOpenMode}
              onValueChange={setMarkdownLinkOpenMode}
            >
              <option value="in-app">内置浏览器</option>
              <option value="external">系统浏览器</option>
            </SelectField>
          </label>
        </div>
      </div>
    </div>
  );
}

function CodeAppearancePreview({ colorSchemeLabel, fontFamily, fontLabel, themeLabel }: { colorSchemeLabel: string; fontFamily: string; fontLabel: string; themeLabel: string }) {
  return (
    <div className="chat-user-settings__code-preview" aria-label="代码样式预览">
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
          <span className="is-comment">// 实时预览代码字体、高亮主题与配色方案</span>
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
