import { describe, expect, it } from 'vitest';
import { localizedPluginCopy } from '../../../../src/features/capabilities/pluginLocalization.js';
import { translate, type Translate } from '../../../../src/shared/i18n/I18nProvider.js';

const en: Translate = (key, params) => translate('en-US', key, params);

describe('built-in plugin localization', () => {
  it.each([
    ['audit-file-mutations', 'File Change Audit Reminder'],
    ['compact-warning', 'Pre-Compaction Status'],
    ['context7-docs', 'Context7 Documentation'],
    ['documents', 'Word Document Processing'],
    ['guard-dangerous-shell', 'Block Dangerous Shell Commands'],
    ['openai-docs', 'OpenAI Official Documentation'],
    ['openai-image-generation', 'Image Generation'],
    ['pdf', 'PDF Document Processing'],
    ['prompt-secret-detector', 'Secret Detection in User Messages'],
    ['protect-generated-folders', 'Protect Generated Directories'],
    ['protect-secret-paths', 'Protect Secret File Paths'],
    ['session-start-project-guidance', 'Load Project Guidance at Session Start'],
    ['stop-todo-continuation', 'Check Unfinished TODOs Before Stopping'],
  ])('maps %s through its stable plugin id', (id, expectedName) => {
    const copy = localizedPluginCopy({ id, name: '原始名称', description: '原始描述' }, en);

    expect(copy.name).toBe(expectedName);
    expect(copy.description).not.toBe('原始描述');
  });

  it('preserves third-party plugin copy', () => {
    expect(localizedPluginCopy({ id: 'third-party', name: 'Third Party', description: 'Custom copy' }, en)).toEqual({
      name: 'Third Party',
      description: 'Custom copy',
    });
  });
});
