import { describe, expect, it } from 'vitest';
import { settingsPathParts } from '../../../../src/features/settings/components/SettingsPathValue.js';

describe('settingsPathParts', () => {
  it('keeps the final file or folder name for macOS and Windows paths', () => {
    expect(settingsPathParts('/Users/setsuna/Data/runtime/config.json')).toEqual({
      directory: 'Users/setsuna/Data/runtime',
      name: 'config.json',
      separator: '/',
    });
    expect(settingsPathParts('C:\\Users\\setsuna\\Data\\')).toEqual({
      directory: 'Users\\setsuna',
      name: 'Data',
      separator: '\\',
    });
  });
});
