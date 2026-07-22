import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  I18nProvider,
  interfaceLanguageFromConfig,
  normalizeAppLocale,
  translate,
  useI18n,
} from '../../../../src/shared/i18n/I18nProvider.js';

describe('renderer i18n', () => {
  it('translates typed messages and interpolates values', () => {
    expect(translate('zh-CN', 'settings.title')).toBe('设置');
    expect(translate('en-US', 'settings.title')).toBe('Settings');
    expect(translate('en-US', 'chat.starter.projectTitle', { project: 'Setsuna' })).toBe(
      'What should we build in Setsuna?',
    );
    expect(translate('en-US', 'settings.general.fontWeight.light')).toBe('Light');
    expect(translate('en-US', 'settings.general.fontWeight.regular')).toBe('Regular (default)');
    expect(translate('en-US', 'settings.general.fontWeight.semibold')).toBe('Semibold');
  });

  it('normalizes supported locales and reads the persisted config value', () => {
    expect(normalizeAppLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeAppLocale('en-US')).toBe('en-US');
    expect(normalizeAppLocale('fr-FR')).toBeNull();
    expect(
      interfaceLanguageFromConfig({
        desktopSettings: { interfaceLanguage: 'en-US' },
      } as RuntimeConfigState),
    ).toBe('en-US');
  });

  it('provides an explicit initial locale for server rendering', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, { initialLocale: 'en-US' }, createElement(LocaleProbe)),
    );

    expect(html).toContain('lang="en-US"');
    expect(html).toContain('New chat');
  });
});

function LocaleProbe() {
  const { locale, t } = useI18n();
  return createElement('span', { lang: locale }, t('app.newChat'));
}
