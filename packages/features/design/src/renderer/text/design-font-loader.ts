import { designFontFormats, designFontNameKey, maxDesignFontBytes, type DesignCustomFont, type DesignFontStyle } from '../../contracts/design-fonts.js';
import type { DesignFontClient } from '../client.js';
import { bundledDesignFonts, mergeDesignFontCatalog, readBundledDesignFont } from './design-bundled-fonts.js';
import { designCustomFontFamily } from './design-typography.js';

type Registration = {
  request: AbortController;
  loaded: Promise<boolean>;
  face?: FontFace;
  settled: boolean;
};

export type DesignFontRequest = Readonly<{ family: string; weight: number; style: DesignFontStyle }>;
export { designFontCatalogChannel } from './design-font-catalog-events.js';

export function matchDesignFontFaces(fonts: readonly DesignCustomFont[], requests: readonly DesignFontRequest[]) {
  const chosen = new Set<string>();
  for (const request of requests) {
    const name = designFontNameKey(request.family);
    const family = fonts.filter((font) => designFontNameKey(font.family) === name);
    const preferredStyle = family.filter((font) => font.style === request.style);
    const candidates = preferredStyle.length ? preferredStyle : family;
    let best = Infinity;
    let matching: DesignCustomFont[] = [];
    for (const font of candidates) {
      const available = Math.min(font.maxWeight, Math.max(font.minWeight, request.weight));
      const rank = fontWeightRank(request.weight, available);
      if (rank < best) { best = rank; matching = []; }
      if (rank === best) matching.push(font);
    }
    for (const font of matching) chosen.add(font.id);
  }
  return fonts.filter((font) => chosen.has(font.id));
}

function fontWeightRank(wanted: number, available: number) {
  const distance = Math.abs(wanted - available);
  // CSS matches styles before weights and searches the 400–500 range first for regular faces.
  if (wanted < 400) return available <= wanted ? distance : 1_000 + distance;
  if (wanted > 500) return available >= wanted ? distance : 1_000 + distance;
  if (available >= wanted && available <= 500) return distance;
  return (available < wanted ? 1_000 : 2_000) + distance;
}

export class DesignFontLoader {
  private readonly registrations = new Map<string, Registration>();

  constructor(private readonly client: Pick<DesignFontClient, 'read'>, private readonly changed?: (font: DesignCustomFont) => void) {}

  isSettled(font: DesignCustomFont) {
    return this.registrations.get(font.id)?.settled ?? false;
  }

  load(font: DesignCustomFont, retry = false): Promise<boolean> {
    const previous = this.registrations.get(font.id);
    if (previous && (!retry || !previous.settled || previous.face)) return previous.loaded;
    const request = new AbortController();
    const registration: Registration = {
      request, settled: false, loaded: this.install(font, request.signal).then((face) => {
        if (request.signal.aborted) return false;
        document.fonts.add(face);
        registration.face = face;
        return true;
      }).catch(() => false).finally(() => {
        if (!request.signal.aborted) { registration.settled = true; this.changed?.(font); }
      }),
    };
    this.registrations.set(font.id, registration);
    return registration.loaded;
  }

  retain(fonts: readonly DesignCustomFont[]) {
    const wanted = new Set(fonts.map(({ id }) => id));
    let removed = false;
    for (const [id, registration] of this.registrations) {
      if (wanted.has(id)) continue;
      registration.request.abort();
      if (registration.face) { document.fonts.delete(registration.face); removed = true; }
      this.registrations.delete(id);
    }
    return removed;
  }

  private async install(font: DesignCustomFont, signal: AbortSignal) {
    const { base64 } = await this.client.read(font.id, signal);
    signal.throwIfAborted();
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new FontFace(designCustomFontFamily(font.family), bytes, { weight: fontWeight(font), style: font.style }).load();
  }
}

export function createDesignPreviewFontLoader(client: Pick<DesignFontClient, 'list' | 'read'>) {
  const loader = new DesignFontLoader({ read: (id, signal) => readBundledDesignFont(id, signal) ?? client.read(id, signal) });
  let catalog: readonly DesignCustomFont[] | undefined;

  async function loadFonts(requests: readonly DesignFontRequest[], signal: AbortSignal) {
    if (!catalog) {
      const imported = await client.list(signal).catch(() => undefined);
      signal.throwIfAborted();
      if (imported) catalog = mergeDesignFontCatalog(imported);
    }
    const needed = matchDesignFontFaces(catalog ?? bundledDesignFonts, requests);
    loader.retain(needed);
    await Promise.all(needed.map((font) => loader.load(font, true)));
  }

  return {
    async load(requests: readonly DesignFontRequest[], signal: AbortSignal) {
      if (!requests.length) return;
      signal.throwIfAborted();
      // Release the preview queue even if a font decode is still finishing in Chromium.
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          loader.retain([]);
          reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        void loadFonts(requests, signal).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
    },
    dispose() { loader.retain([]); },
  };
}

export function importableDesignFont(file: File): boolean {
  return file.size > 0 && file.size <= maxDesignFontBytes && Object.hasOwn(designFontFormats, file.name.split('.').at(-1)?.toLowerCase() ?? '');
}

export async function encodeDesignFont(file: File): Promise<string> {
  // Validate with Chromium's font sanitizer before keeping a local copy.
  const bytes = await file.arrayBuffer();
  await new FontFace('setsuna-design-import', bytes).load();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function designFontRule(font: DesignCustomFont, base64: string): string {
  const { mime, css } = designFontFormats[font.format];
  return `@font-face{font-family:${designCustomFontFamily(font.family)};font-style:${font.style};font-weight:${fontWeight(font)};src:url(data:${mime};base64,${base64}) format('${css}')}`;
}

function fontWeight(font: DesignCustomFont): string {
  return font.minWeight === font.maxWeight ? String(font.minWeight) : `${font.minWeight} ${font.maxWeight}`;
}
