import { describe, expect, it } from 'vitest';
import { localizedPluginCopy } from '../../../../src/features/capabilities/pluginLocalization.js';
import type { Translate } from '../../../../src/shared/i18n/I18nProvider.js';

const returnKey: Translate = (key) => key;

describe('built-in plugin localization', () => {
  it('routes every built-in plugin id to its own localized copy', () => {
    const pluginIds = [
      'audit-file-mutations',
      'compact-warning',
      'context7-docs',
      'documents',
      'guard-dangerous-shell',
      'openai-docs',
      'openai-image-generation',
      'openai-vision-recognition',
      'web-search',
      'pdf',
      'prompt-secret-detector',
      'protect-generated-folders',
      'protect-secret-paths',
      'session-start-project-guidance',
      'stop-todo-continuation',
    ];

    for (const id of pluginIds) {
      expect(localizedPluginCopy({ id, name: 'Source', description: 'Source' }, returnKey)).toEqual({
        name: `capabilities.plugin.${id}.name`,
        description: `capabilities.plugin.${id}.description`,
      });
    }
  });

  it('preserves third-party plugin copy', () => {
    expect(localizedPluginCopy({ id: 'third-party', name: 'Third Party', description: 'Custom copy' }, returnKey)).toEqual({
      name: 'Third Party',
      description: 'Custom copy',
    });
  });
});
