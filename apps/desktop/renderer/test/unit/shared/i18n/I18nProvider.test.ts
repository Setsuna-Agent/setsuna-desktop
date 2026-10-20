import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  interfaceLanguageFromConfig,
  normalizeAppLocale,
  translate,
} from '../../../../src/shared/i18n/I18nProvider.js';
import type { MessageKey } from '../../../../src/shared/i18n/messages.js';

describe('renderer i18n', () => {
  it('translates typed messages and interpolates values', () => {
    expect(translate('zh-CN', 'settings.title')).toBe('设置');
    expect(translate('en-US', 'settings.title')).toBe('Settings');
    expect(translate('en-US', 'chat.starter.projectTitle', { project: 'Setsuna' })).toBe(
      'What would you like to do in Setsuna?',
    );
  });

  it('keeps an unknown runtime key from crashing interpolation', () => {
    const unknownKey = 'chat.goal.exit.future' as MessageKey;

    expect(translate('zh-CN', unknownKey, { duration: '1m' })).toBe(unknownKey);
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

});
