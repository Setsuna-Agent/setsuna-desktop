import type { Session } from 'electron';

const maxFaviconBytes = 512_000;
const maxFaviconCandidateCharacters = 512_000;
const maxFaviconCandidateCount = 8;
const maxInspectedFaviconCandidateCount = 32;
const maxNetworkFaviconUrlLength = 8_192;
const faviconRequestTimeoutMs = 3_000;

type FaviconSession = Pick<Session, 'fetch'>;
type FaviconResponse = Awaited<ReturnType<Session['fetch']>>;
type NormalizedFaviconCandidate =
  | { kind: 'data'; value: string }
  | { kind: 'network'; value: string };

/**
 * Fetches page-provided favicon candidates through the guest session so cookies,
 * proxy settings, certificates, and the browser cache match the embedded page.
 */
export async function loadBrowserFavicon(
  browserSession: FaviconSession,
  pageUrl: string,
  rawCandidates: readonly unknown[],
): Promise<string | null> {
  const normalizedPageUrl = normalizeNetworkUrl(pageUrl);
  if (!normalizedPageUrl) return null;

  const candidates = normalizeFaviconCandidates(rawCandidates);
  const conventionalFaviconUrl = new URL('/favicon.ico', normalizedPageUrl).href;
  if (!candidates.some((candidate) => candidate.kind === 'network' && candidate.value === conventionalFaviconUrl)) {
    candidates.push({ kind: 'network', value: conventionalFaviconUrl });
  }

  const inlineCandidate = candidates.find((candidate) => candidate.kind === 'data');
  if (inlineCandidate?.kind === 'data') return inlineCandidate.value;

  // A broken first candidate should not serialize several timeout windows before
  // a later icon can win. The browser cache keeps this fan-out inexpensive in the
  // common case where Chromium already fetched the page's declared icons.
  const attempts = candidates
    .filter((candidate): candidate is Extract<NormalizedFaviconCandidate, { kind: 'network' }> => candidate.kind === 'network')
    .map(async (candidate) => {
      const favicon = await fetchFaviconAsDataUrl(browserSession, normalizedPageUrl, candidate.value);
      if (!favicon) throw new Error('Favicon candidate was unavailable.');
      return favicon;
    });
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

function normalizeFaviconCandidates(rawCandidates: readonly unknown[]): NormalizedFaviconCandidate[] {
  const candidates: NormalizedFaviconCandidate[] = [];
  const seen = new Set<string>();
  let acceptedCharacters = 0;
  let inspectedCandidates = 0;

  for (const rawCandidate of rawCandidates) {
    if (
      candidates.length >= maxFaviconCandidateCount
      || inspectedCandidates >= maxInspectedFaviconCandidateCount
    ) break;
    inspectedCandidates += 1;
    if (typeof rawCandidate !== 'string') continue;
    const candidate = rawCandidate.trim();
    if (!candidate || acceptedCharacters + candidate.length > maxFaviconCandidateCharacters) continue;

    const dataUrl = normalizeDataImageUrl(candidate);
    const networkUrl = dataUrl ? null : normalizeNetworkUrl(candidate);
    const value = dataUrl ?? networkUrl;
    if (!value || seen.has(value)) continue;

    acceptedCharacters += candidate.length;
    seen.add(value);
    candidates.push(dataUrl ? { kind: 'data', value } : { kind: 'network', value });
  }
  return candidates;
}

function normalizeDataImageUrl(value: string): string | null {
  if (value.length > maxFaviconCandidateCharacters || !value.toLowerCase().startsWith('data:image/')) return null;
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return null;

  const metadata = value.slice(5, commaIndex).split(';');
  const mimeType = metadata.shift()?.trim().toLowerCase() ?? '';
  if (!/^image\/[a-z0-9.+-]+$/.test(mimeType)) return null;

  const payload = value.slice(commaIndex + 1);
  let bytes: Buffer;
  try {
    if (metadata.some((item) => item.trim().toLowerCase() === 'base64')) {
      const compactPayload = payload.replace(/\s/g, '');
      if (!/^[a-z\d+/]*={0,2}$/i.test(compactPayload) || compactPayload.length % 4 === 1) return null;
      bytes = Buffer.from(compactPayload, 'base64');
    } else {
      bytes = Buffer.from(decodeURIComponent(payload), 'utf8');
    }
  } catch {
    return null;
  }
  if (!bytes.byteLength || bytes.byteLength > maxFaviconBytes) return null;
  const resolvedMimeType = resolveFaviconMimeType(mimeType, bytes);
  return resolvedMimeType ? `data:${resolvedMimeType};base64,${bytes.toString('base64')}` : null;
}

function normalizeNetworkUrl(value: string): string | null {
  if (!value || value.length > maxNetworkFaviconUrlLength) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

async function fetchFaviconAsDataUrl(
  browserSession: FaviconSession,
  pageUrl: string,
  faviconUrl: string,
): Promise<string | null> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), faviconRequestTimeoutMs);
  try {
    const response = await browserSession.fetch(faviconUrl, {
      credentials: 'include',
      headers: { Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
      referrer: pageUrl,
      signal: abortController.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const bytes = await readBoundedResponse(response);
    if (!bytes) return null;
    const mimeType = resolveFaviconMimeType(response.headers.get('content-type'), bytes);
    return mimeType ? `data:${mimeType};base64,${bytes.toString('base64')}` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponse(response: FaviconResponse): Promise<Buffer | null> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxFaviconBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxFaviconBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } catch {
    return null;
  }
  return totalBytes ? Buffer.concat(chunks, totalBytes) : null;
}

function resolveFaviconMimeType(contentType: string | null, bytes: Buffer): string | null {
  const declaredMimeType = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) return 'image/vnd.microsoft.icon';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (bytes.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /^(avif|avis)$/.test(bytes.subarray(8, 12).toString('ascii'))) return 'image/avif';
  if (declaredMimeType === 'image/svg+xml') {
    const prefix = bytes.subarray(0, Math.min(bytes.byteLength, 4_096)).toString('utf8');
    const svgIndex = prefix.search(/<svg(?:\s|>)/i);
    const htmlIndex = prefix.search(/<html(?:\s|>)/i);
    if (svgIndex >= 0 && (htmlIndex < 0 || svgIndex < htmlIndex)) return declaredMimeType;
  }
  return null;
}
