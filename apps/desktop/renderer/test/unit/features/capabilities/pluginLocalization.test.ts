import { describe, expect, it } from 'vitest';
import { localizedPluginCopy } from '../../../../src/features/capabilities/pluginLocalization.js';
import { translate, type Translate } from '../../../../src/shared/i18n/I18nProvider.js';

const en: Translate = (key, params) => translate('en-US', key, params);

describe('built-in plugin localization', () => {
  it('uses localized copy for a built-in plugin id', () => {
    const copy = localizedPluginCopy({ id: 'openai-docs', name: '原始名称', description: '原始描述' }, en);

    expect(copy.name).toBe('OpenAI Official Documentation');
    expect(copy.description).not.toBe('原始描述');
  });

  it('preserves third-party plugin copy', () => {
    expect(localizedPluginCopy({ id: 'third-party', name: 'Third Party', description: 'Custom copy' }, en)).toEqual({
      name: 'Third Party',
      description: 'Custom copy',
    });
  });
});
