import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { localizedExtensionName } from '../../../src/main/extensions/localization.js';

const localized = (root: string) => ({
  id: 'a'.repeat(32), path: root, name: '__MSG_appName__', manifest: { default_locale: 'en' },
});

async function catalog(root: string, locale: string, messages: Record<string, unknown>) {
  const directory = path.join(root, '_locales', locale);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'messages.json'), JSON.stringify(messages));
}

it('resolves manifest names using the current locale, language fallback and extension default', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-localization-'));
  try {
    await catalog(root, 'en', { APPNAME: { message: 'iTab New Tab' } });
    await catalog(root, 'zh', { appName: { message: 'iTab 中文' } });
    await catalog(root, 'zh_CN', { appName: { message: 'iTab 新标签页' } });
    await catalog(root, 'zh_TW', { description: { message: 'A sparse catalog' } });
    expect(await localizedExtensionName(localized(root), 'zh-CN')).toBe('iTab 新标签页');
    expect(await localizedExtensionName(localized(root), 'zh-TW')).toBe('iTab 中文');
    expect(await localizedExtensionName(localized(root), 'en-GB')).toBe('iTab New Tab');
    expect(await localizedExtensionName(localized(root), 'fr-CA')).toBe('iTab New Tab');
    expect(await localizedExtensionName({ ...localized(root), name: 'React Developer Tools' }, 'zh-CN')).toBe('React Developer Tools');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('falls back safely for broken catalogs and never reads locales outside the extension', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-localization-'));
  const root = path.join(directory, 'extension');
  try {
    await catalog(root, 'en', { appName: { message: 'iTab New Tab' } });
    await catalog(root, 'fr', {});
    await writeFile(path.join(root, '_locales', 'fr', 'messages.json'), '{broken');
    expect(await localizedExtensionName(localized(root), 'fr')).toBe('iTab New Tab');
    if (process.platform !== 'win32') {
      const outside = path.join(directory, 'outside');
      await mkdir(outside);
      await writeFile(path.join(outside, 'messages.json'), JSON.stringify({ appName: { message: 'Private host data' } }));
      await symlink(outside, path.join(root, '_locales', 'zh_CN'));
      expect(await localizedExtensionName(localized(root), 'zh-CN')).toBe('iTab New Tab');
    }
    const invalid = { ...localized(root), manifest: { default_locale: '../../outside', short_name: 'iTab' } };
    expect(await localizedExtensionName(invalid, '../outside')).toBe('iTab');
    expect(await localizedExtensionName({ ...invalid, manifest: { default_locale: '../../outside' } })).toBe(invalid.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
