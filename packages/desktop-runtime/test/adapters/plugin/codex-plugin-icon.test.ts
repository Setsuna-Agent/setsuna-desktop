import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { normalizePluginIconImage, readCodexPluginIcon } from '../../../src/adapters/plugin/codex-plugin-icon.js';
import { createTestTempDirectory } from '../../support/test-temp-directory.js';
import { ONE_PIXEL_PNG } from './support/file-plugin-bundle-store-fixture.js';

it('projects local light and dark artwork as image data and excludes external or oversized inputs', async () => {
  const root = await createTestTempDirectory('setsuna-plugin-icon-');
  const bundle = path.join(root, 'bundle');
  await mkdir(bundle);
  await writeFile(path.join(bundle, 'logo.png'), ONE_PIXEL_PNG);
  await writeFile(path.join(bundle, 'dark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="M0 0h24v24H0z"/></svg>');
  const icon = await readCodexPluginIcon(bundle, { logo: './logo.png', logoDark: './dark.svg' });
  expect(icon?.light).toBe(`data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`);
  expect(icon?.dark).toMatch(/^data:image\/svg\+xml;base64,/u);
  expect(normalizePluginIconImage(icon)).toEqual(icon);
  await writeFile(path.join(root, 'outside.png'), ONE_PIXEL_PNG);
  expect(await readCodexPluginIcon(bundle, { logo: '../outside.png' })).toBeUndefined();
  expect(await readCodexPluginIcon(bundle, { logo: 'https://example.com/icon.svg' })).toBeUndefined();
  await writeFile(path.join(bundle, 'large.png'), Buffer.concat([ONE_PIXEL_PNG, Buffer.alloc(97 * 1024)]));
  expect(await readCodexPluginIcon(bundle, { logo: './large.png', composerIcon: './logo.png' })).toEqual({ light: icon!.light });
  expect(normalizePluginIconImage({ light: 'data:text/html;base64,PHNjcmlwdD4=' })).toBeUndefined();
});
