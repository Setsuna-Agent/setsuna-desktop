import { designBundledFontFamilies as families, type DesignBundledFontFamily, type DesignCustomFont } from '../../contracts/design-fonts.js';

type FontAsset = Readonly<{ id: string; load(): Promise<{ default: string }> }>;

function fontFamily(family: DesignBundledFontFamily, minWeight: number, maxWeight: number, upright: FontAsset, italic: FontAsset) {
  return [
    { ...upright, font: { id: upright.id, family, name: family, minWeight, maxWeight, format: 'woff2', style: 'normal', embeddable: true } },
    { ...italic, font: { id: italic.id, family, name: family + ' Italic', minWeight, maxWeight, format: 'woff2', style: 'italic', embeddable: true } },
  ] satisfies readonly (FontAsset & { font: DesignCustomFont })[];
}

const assets = [
  ...fontFamily(families.geist, 100, 900, {
    id: '19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1',
    load: () => import('./fonts/geist-latin-wght-normal.woff2?inline'),
  }, {
    id: '9b10496762af92659f3b05d2b084b0c8f962c3ecdf637aa764e3b7fd17f5acaf',
    load: () => import('./fonts/geist-latin-wght-italic.woff2?inline'),
  }),
  ...fontFamily(families.geistMono, 100, 900, {
    id: '684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc',
    load: () => import('./fonts/geist-mono-latin-wght-normal.woff2?inline'),
  }, {
    id: '7842d88c32207514dd03ddb9abc6c84b032d6fef58af1177e0b23f6554c80c75',
    load: () => import('./fonts/geist-mono-latin-wght-italic.woff2?inline'),
  }),
  ...fontFamily(families.inter, 100, 900, {
    id: '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62',
    load: () => import('./fonts/inter-latin-wght-normal.woff2?inline'),
  }, {
    id: '7291b5970da2237441273c03b424a504b70b18f09791473fab99687dcc314720',
    load: () => import('./fonts/inter-latin-wght-italic.woff2?inline'),
  }),
  ...fontFamily(families.dmSans, 100, 1000, {
    id: '9fea608a947e67020c33cad9a6fe3d60c54119dfb8cff87768a8117a15ed7543',
    load: () => import('./fonts/dm-sans-latin-wght-normal.woff2?inline'),
  }, {
    id: 'f1a235db5bcb8730707844188d35201ecdf63e56c5dcce97bab24a9c7066091d',
    load: () => import('./fonts/dm-sans-latin-wght-italic.woff2?inline'),
  }),
  ...fontFamily(families.sourceSerif, 200, 900, {
    id: '382475f38242c52d42a3e5ff8dc69b5d73f10d0d21e4550b5fe232984688779a',
    load: () => import('./fonts/source-serif-4-latin-wght-normal.woff2?inline'),
  }, {
    id: 'b4f56ddc9873487f1c9a3ad5bbce31982fe89b951f57e4604f62b4c8a540fb19',
    load: () => import('./fonts/source-serif-4-latin-wght-italic.woff2?inline'),
  }),
  ...fontFamily(families.jetBrainsMono, 100, 800, {
    id: '18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e',
    load: () => import('./fonts/jetbrains-mono-latin-wght-normal.woff2?inline'),
  }, {
    id: 'a8afa085e9ca5e53434e2ee918ba6b65c7dd4dda56509976b36591478c99d62e',
    load: () => import('./fonts/jetbrains-mono-latin-wght-italic.woff2?inline'),
  }),
];

const assetsById = new Map(assets.map((asset) => [asset.font.id, asset]));
export const bundledDesignFonts: readonly DesignCustomFont[] = assets.map(({ font }) => font);

export function mergeDesignFontCatalog(imported: readonly DesignCustomFont[]): readonly DesignCustomFont[] {
  return imported.length ? [...bundledDesignFonts, ...imported.filter((font) => !assetsById.has(font.id))] : bundledDesignFonts;
}

export function readBundledDesignFont(id: string, signal?: AbortSignal): Promise<{ base64: string }> | undefined {
  const asset = assetsById.get(id);
  if (!asset) return;
  signal?.throwIfAborted();
  // Each Vite chunk carries one face so the canvas and export can share it offline.
  return asset.load().then(({ default: url }) => {
    signal?.throwIfAborted();
    const marker = ';base64,';
    const offset = url.indexOf(marker);
    if (!url.startsWith('data:') || offset < 0) throw new Error('Invalid bundled design font.');
    return { base64: url.slice(offset + marker.length) };
  });
}
