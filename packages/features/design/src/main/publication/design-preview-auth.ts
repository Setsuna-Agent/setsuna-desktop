import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isDesignPreviewPassword, maxDesignPreviewPasswordLength, type DesignPreviewAccess } from '../../contracts/design-publication.js';

export const designPreviewUnlockPath = '/api/unlock';
export const designPreviewAccessHeader = 'x-design-preview-access';

const maxPasswordBytes = maxDesignPreviewPasswordLength * 4;
const maxFailures = 8;
const failureWindowMs = 30_000;
const trackedAddresses = 128;

export function designPreviewCredentials(access: DesignPreviewAccess) {
  const linkToken = randomBytes(32).toString('base64url');
  const viewerToken = access.kind === 'password' ? randomBytes(32).toString('base64url') : linkToken;
  return { linkToken, viewerToken, linkHeader: Buffer.from('Bearer ' + linkToken), viewerHeader: Buffer.from('Bearer ' + viewerToken),
    unlock: access.kind === 'password' ? designPreviewUnlock(access.password) : undefined };
}

export function previewAuthorizationMatches(supplied: Buffer | undefined, expected: Buffer) {
  return supplied?.length === expected.length && timingSafeEqual(supplied, expected);
}

function designPreviewUnlock(password: string) {
  const key = randomBytes(32);
  const hash = (value: string) => createHmac('sha256', key).update(value).digest();
  const expected = hash(password);
  const attempts = new Map<string, { failures: number; until: number }>();

  return async (request: IncomingMessage): Promise<200 | 400 | 401 | 429> => {
    const address = request.socket.remoteAddress ?? '';
    const recent = attempts.get(address);
    if (recent && recent.until > Date.now() && recent.failures >= maxFailures) return 429;
    const password = await readPreviewPassword(request);
    if (password === undefined) return 400;

    const now = Date.now();
    const previous = attempts.get(address);
    const current = previous && previous.until > now ? previous : { failures: 0, until: now + failureWindowMs };
    if (current.failures >= maxFailures) return 429;
    if (timingSafeEqual(hash(password), expected)) {
      attempts.delete(address);
      return 200;
    }
    if (!previous && attempts.size >= trackedAddresses) {
      const oldest = attempts.keys().next().value;
      if (oldest !== undefined) attempts.delete(oldest);
    }
    attempts.set(address, { failures: current.failures + 1, until: current.until });
    return 401;
  };
}

async function readPreviewPassword(request: IncomingMessage): Promise<string | undefined> {
  const size = Number(request.headers['content-length']);
  if (request.headers['transfer-encoding'] || !Number.isSafeInteger(size) || size < 1 || size > maxPasswordBytes
    || request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'text/plain') return undefined;
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      if (bytes > size) return undefined;
      chunks.push(chunk);
    }
    if (bytes !== size) return undefined;
    const password = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    return isDesignPreviewPassword(password) ? password : undefined;
  } catch {
    return undefined;
  }
}
