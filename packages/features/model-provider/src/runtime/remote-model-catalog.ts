import type { Api, Model, Provider } from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RefreshModelProviderCatalogResult } from '../contracts/index.js';
import { createModelProviderCatalog, supportedProviders } from './provider-catalog.js';
import { MAX_CATALOG_BYTES, parseRemoteCatalog } from './remote-model-catalog-data.js';

const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

type CacheEntry = {
  schemaVersion: 1;
  appVersion: string;
  checkedAt: number;
  lastModified?: number;
  etag?: string;
  models: Model<Api>[];
};

/** One runtime owns the overlay used by both the settings catalog and model sampling. */
export class RemoteModelCatalog {
  readonly providers: readonly Provider[];
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<RefreshModelProviderCatalogResult>>();
  private readonly failures = new Map<string, { retryAt: number; message: string }>();
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private readonly now: () => number;

  constructor(
    private readonly cacheDir: string,
    private readonly appVersion: string,
    options: Readonly<{ now?: () => number; signal?: AbortSignal }> = {},
  ) {
    this.now = options.now ?? Date.now;
    this.signal = options.signal ? AbortSignal.any([this.controller.signal, options.signal]) : this.controller.signal;
    this.providers = supportedProviders().map((provider) => ({
      ...provider,
      getModels: () => {
        const merged = new Map(provider.getModels().map((model) => [model.id, model]));
        for (const model of this.entries.get(provider.id)?.models ?? []) merged.set(model.id, model);
        return [...merged.values()];
      },
    }));
  }

  snapshot() { return createModelProviderCatalog(this.providers); }

  async restore(): Promise<void> {
    await Promise.all(this.providers.map(async ({ id }) => {
      try {
        const text = await readFile(this.cachePath(id), 'utf8');
        if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) return;
        const stored = JSON.parse(text) as CacheEntry;
        // App upgrades start with their freshly bundled metadata, then revalidate remotely.
        if (stored.schemaVersion !== 1 || stored.appVersion !== this.appVersion
          || !Number.isFinite(stored.checkedAt) || stored.checkedAt > this.now()
          || (stored.etag !== undefined && typeof stored.etag !== 'string')
          || (stored.lastModified !== undefined && !Number.isFinite(stored.lastModified))) return;
        this.entries.set(id, { ...stored, models: parseRemoteCatalog(id, stored.models) });
      } catch {
        // A missing or damaged cache never prevents offline startup.
      }
    }));
  }

  refresh(
    providerId: string,
    fetchImpl: typeof fetch,
    force = false,
  ): Promise<RefreshModelProviderCatalogResult> {
    if (!this.providers.some((provider) => provider.id === providerId)) throw new Error('Unknown catalog provider.');
    const pending = this.inFlight.get(providerId);
    if (pending) return pending;
    const failure = this.failures.get(providerId);
    if (!force && failure && this.now() < failure.retryAt) {
      return Promise.resolve({ catalog: this.snapshot(), error: failure.message });
    }
    const stored = this.entries.get(providerId);
    if (!force && stored && this.now() - stored.checkedAt < REFRESH_INTERVAL_MS) {
      return Promise.resolve({ catalog: this.snapshot() });
    }
    const operation = this.download(providerId, fetchImpl).finally(() => this.inFlight.delete(providerId));
    this.inFlight.set(providerId, operation);
    return operation;
  }

  async dispose(): Promise<void> {
    this.controller.abort();
    await Promise.allSettled(this.inFlight.values());
  }

  private async download(providerId: string, fetchImpl: typeof fetch): Promise<RefreshModelProviderCatalogResult> {
    const stored = this.entries.get(providerId);
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    try {
      // This is a public metadata service. Provider credentials and custom headers must stay on model requests.
      const response = await fetchImpl(`https://pi.dev/api/models/providers/${encodeURIComponent(providerId)}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': `setsuna-desktop/${this.appVersion}`,
          ...(stored?.etag ? { 'If-None-Match': stored.etag } : {}),
        },
        signal,
      });
      let entry: CacheEntry;
      if (response.status === 304 && stored) {
        entry = { ...stored, checkedAt: this.now() };
      } else {
        if (!response.ok) throw new Error(`Model catalog request failed (${response.status}).`);
        const text = await readCatalogResponse(response);
        const models = parseRemoteCatalog(providerId, JSON.parse(text));
        if (!models.length) throw new Error('The remote catalog has no supported models.');
        const modified = Date.parse(response.headers.get('last-modified') ?? '');
        const lastModified = Number.isFinite(modified) ? modified : undefined;
        if (stored?.lastModified && lastModified && lastModified < stored.lastModified) {
          throw new Error('The remote catalog is older than the cached catalog.');
        }
        entry = {
          schemaVersion: 1, appVersion: this.appVersion, checkedAt: this.now(), models,
          lastModified, etag: response.headers.get('etag') ?? undefined,
        };
      }
      signal.throwIfAborted();
      this.entries.set(providerId, entry);
      this.failures.delete(providerId);
      // Cache persistence is best effort; a read-only disk should not discard fresh in-memory metadata.
      await this.persist(providerId, entry).catch(() => undefined);
      return { catalog: this.snapshot() };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Model catalog refresh failed.';
      this.failures.set(providerId, { retryAt: this.now() + FAILURE_RETRY_MS, message });
      return { catalog: this.snapshot(), error: message };
    }
  }

  private cachePath(providerId: string): string { return path.join(this.cacheDir, `${providerId}.json`); }

  private async persist(providerId: string, entry: CacheEntry): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const target = this.cachePath(providerId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(entry), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

async function readCatalogResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty model catalog response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CATALOG_BYTES) throw new Error('Model catalog response is too large.');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => undefined); }
}
