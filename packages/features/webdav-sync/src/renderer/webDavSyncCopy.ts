import type {
  DesktopWebDavSyncCategoryId,
  DesktopWebDavSyncOperationPhase,
} from '../contracts/index.js';
import type { RendererFeatureMessageKey } from '@setsuna-desktop/feature-core/renderer';

export const webDavCategoryCopy: Record<DesktopWebDavSyncCategoryId, {
  labelKey: RendererFeatureMessageKey;
  descriptionKey: RendererFeatureMessageKey;
}> = {
  conversations: {
    labelKey: 'feature.webdavSync.category.conversations',
    descriptionKey: 'feature.webdavSync.category.conversationsDescription',
  },
  memories: {
    labelKey: 'feature.webdavSync.category.memories',
    descriptionKey: 'feature.webdavSync.category.memoriesDescription',
  },
  preferences: {
    labelKey: 'feature.webdavSync.category.preferences',
    descriptionKey: 'feature.webdavSync.category.preferencesDescription',
  },
  model_credentials: {
    labelKey: 'feature.webdavSync.category.model_credentials',
    descriptionKey: 'feature.webdavSync.category.model_credentialsDescription',
  },
  user_skills: {
    labelKey: 'feature.webdavSync.category.user_skills',
    descriptionKey: 'feature.webdavSync.category.user_skillsDescription',
  },
  usage: {
    labelKey: 'feature.webdavSync.category.usage',
    descriptionKey: 'feature.webdavSync.category.usageDescription',
  },
};

export const webDavOperationMessageKey: Record<
  DesktopWebDavSyncOperationPhase,
  RendererFeatureMessageKey
> = {
  connecting: 'feature.webdavSync.operation.connecting',
  'waiting-for-idle': 'feature.webdavSync.operation.waiting-for-idle',
  snapshotting: 'feature.webdavSync.operation.snapshotting',
  encrypting: 'feature.webdavSync.operation.encrypting',
  uploading: 'feature.webdavSync.operation.uploading',
  publishing: 'feature.webdavSync.operation.publishing',
  pruning: 'feature.webdavSync.operation.pruning',
  listing: 'feature.webdavSync.operation.listing',
  downloading: 'feature.webdavSync.operation.downloading',
  inspecting: 'feature.webdavSync.operation.inspecting',
  'preparing-restore': 'feature.webdavSync.operation.preparing-restore',
  restoring: 'feature.webdavSync.operation.restoring',
};

export function formatSyncBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes.toLocaleString(locale)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024) break;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${unit}`;
}
