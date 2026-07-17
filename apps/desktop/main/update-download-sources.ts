import type { DesktopUpdateDownloadSource, DesktopUpdateDownloadSourceInput } from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const GITHUB_DIRECT_DOWNLOAD_SOURCE_ID = 'github-direct';

export const GITHUB_DIRECT_DOWNLOAD_SOURCE: DesktopUpdateDownloadSource = {
  id: GITHUB_DIRECT_DOWNLOAD_SOURCE_ID,
  name: 'GitHub 直连',
  urlTemplate: '{url}',
  builtIn: true,
};

type PersistedDownloadSourceConfig = {
  activeSourceId: string;
  sources: DesktopUpdateDownloadSource[];
};

export class UpdateDownloadSourceStore {
  private config: PersistedDownloadSourceConfig = defaultConfig();

  constructor(private readonly configPath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.configPath, 'utf8')) as unknown;
      this.config = normalizePersistedConfig(parsed);
    } catch (error) {
      if (!isMissingFileError(error)) console.warn(`[desktop-updater] Ignoring invalid download source config: ${formatError(error)}`);
      this.config = defaultConfig();
    }
  }

  getConfig(): PersistedDownloadSourceConfig {
    return cloneConfig(this.config);
  }

  getActiveSource(): DesktopUpdateDownloadSource {
    return cloneSource(this.config.sources.find((source) => source.id === this.config.activeSourceId) ?? GITHUB_DIRECT_DOWNLOAD_SOURCE);
  }

  async add(input: DesktopUpdateDownloadSourceInput): Promise<PersistedDownloadSourceConfig> {
    const name = normalizeSourceName(input.name);
    const urlTemplate = normalizeDownloadSourceTemplate(input.urlTemplate);
    if (this.config.sources.some((source) => source.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error(`下载源“${name}”已存在。`);
    }

    const source: DesktopUpdateDownloadSource = {
      id: `custom-${randomUUID()}`,
      name,
      urlTemplate,
      builtIn: false,
    };
    const nextConfig = {
      activeSourceId: source.id,
      sources: [...this.config.sources, source],
    };
    await this.persist(nextConfig);
    this.config = nextConfig;
    return this.getConfig();
  }

  async select(sourceId: string): Promise<PersistedDownloadSourceConfig> {
    if (!this.config.sources.some((source) => source.id === sourceId)) throw new Error('选择的下载源不存在。');
    if (this.config.activeSourceId === sourceId) return this.getConfig();
    const nextConfig = { ...this.config, activeSourceId: sourceId };
    await this.persist(nextConfig);
    this.config = nextConfig;
    return this.getConfig();
  }

  async remove(sourceId: string): Promise<PersistedDownloadSourceConfig> {
    const source = this.config.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error('要删除的下载源不存在。');
    if (source.builtIn) throw new Error('内置下载源不能删除。');

    const nextConfig = {
      activeSourceId: this.config.activeSourceId === sourceId ? GITHUB_DIRECT_DOWNLOAD_SOURCE_ID : this.config.activeSourceId,
      sources: this.config.sources.filter((item) => item.id !== sourceId),
    };
    await this.persist(nextConfig);
    this.config = nextConfig;
    return this.getConfig();
  }

  private async persist(config: PersistedDownloadSourceConfig): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.configPath);
  }
}

export function normalizeDownloadSourceTemplate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('请输入下载源地址。');
  if (trimmed.length > 2048) throw new Error('下载源地址过长。');

  const template = trimmed.includes('{url}') || trimmed.includes('{encodedUrl}') ? trimmed : `${trimmed.replace(/\/+$/u, '')}/{url}`;
  const unknownPlaceholders = template.match(/\{[^}]+\}/gu)?.filter((placeholder) => placeholder !== '{url}' && placeholder !== '{encodedUrl}') ?? [];
  if (unknownPlaceholders.length > 0) throw new Error(`不支持模板变量 ${unknownPlaceholders[0]}。`);

  // 验证时解析出真实 URL，让格式错误的模板在持久化前就校验失败。
  resolveUpdateDownloadUrl({ ...GITHUB_DIRECT_DOWNLOAD_SOURCE, urlTemplate: template }, 'https://github.com/example/project/releases/download/v1/app.zip');
  return template;
}

export function resolveUpdateDownloadUrl(source: DesktopUpdateDownloadSource, originalUrl: string): string {
  const resolved = source.urlTemplate
    .replaceAll('{encodedUrl}', encodeURIComponent(originalUrl))
    .replaceAll('{url}', originalUrl);
  const url = new URL(resolved);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('下载源只支持 HTTP 或 HTTPS 地址。');
  return url.toString();
}

function normalizePersistedConfig(value: unknown): PersistedDownloadSourceConfig {
  if (!isRecord(value)) return defaultConfig();

  const customSources = Array.isArray(value.sources)
    ? value.sources.flatMap((source) => {
        if (!isRecord(source) || source.builtIn === true || typeof source.id !== 'string' || !source.id.startsWith('custom-')) return [];
        try {
          return [{
            id: source.id,
            name: normalizeSourceName(typeof source.name === 'string' ? source.name : ''),
            urlTemplate: normalizeDownloadSourceTemplate(typeof source.urlTemplate === 'string' ? source.urlTemplate : ''),
            builtIn: false,
          } satisfies DesktopUpdateDownloadSource];
        } catch {
          return [];
        }
      })
    : [];
  const sources = [cloneSource(GITHUB_DIRECT_DOWNLOAD_SOURCE), ...deduplicateSources(customSources)];
  const requestedActiveId = typeof value.activeSourceId === 'string' ? value.activeSourceId : GITHUB_DIRECT_DOWNLOAD_SOURCE_ID;
  const activeSourceId = sources.some((source) => source.id === requestedActiveId) ? requestedActiveId : GITHUB_DIRECT_DOWNLOAD_SOURCE_ID;
  return { activeSourceId, sources };
}

function defaultConfig(): PersistedDownloadSourceConfig {
  return {
    activeSourceId: GITHUB_DIRECT_DOWNLOAD_SOURCE_ID,
    sources: [cloneSource(GITHUB_DIRECT_DOWNLOAD_SOURCE)],
  };
}

function deduplicateSources(sources: DesktopUpdateDownloadSource[]): DesktopUpdateDownloadSource[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  return sources.filter((source) => {
    const normalizedName = source.name.toLocaleLowerCase();
    if (ids.has(source.id) || names.has(normalizedName)) return false;
    ids.add(source.id);
    names.add(normalizedName);
    return true;
  });
}

function normalizeSourceName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('请输入下载源名称。');
  if (name.length > 40) throw new Error('下载源名称不能超过 40 个字符。');
  return name;
}

function cloneConfig(config: PersistedDownloadSourceConfig): PersistedDownloadSourceConfig {
  return { activeSourceId: config.activeSourceId, sources: config.sources.map(cloneSource) };
}

function cloneSource(source: DesktopUpdateDownloadSource): DesktopUpdateDownloadSource {
  return { ...source };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
