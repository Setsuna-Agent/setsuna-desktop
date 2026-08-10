import type {
  DesktopWebDavSyncCategoryId,
  DesktopWebDavSyncOperationPhase,
} from '@setsuna-desktop/contracts';
import type { MessageKey } from '../../../shared/i18n/messages.js';

export const webDavCategoryCopy: Record<DesktopWebDavSyncCategoryId, {
  labelKey: MessageKey;
  descriptionKey: MessageKey;
}> = {
  conversations: {
    labelKey: 'settings.sync.category.conversations',
    descriptionKey: 'settings.sync.category.conversationsDescription',
  },
  memories: {
    labelKey: 'settings.sync.category.memories',
    descriptionKey: 'settings.sync.category.memoriesDescription',
  },
  preferences: {
    labelKey: 'settings.sync.category.preferences',
    descriptionKey: 'settings.sync.category.preferencesDescription',
  },
  model_credentials: {
    labelKey: 'settings.sync.category.model_credentials',
    descriptionKey: 'settings.sync.category.model_credentialsDescription',
  },
  user_skills: {
    labelKey: 'settings.sync.category.user_skills',
    descriptionKey: 'settings.sync.category.user_skillsDescription',
  },
  usage: {
    labelKey: 'settings.sync.category.usage',
    descriptionKey: 'settings.sync.category.usageDescription',
  },
};

export const webDavOperationMessageKey: Record<DesktopWebDavSyncOperationPhase, MessageKey> = {
  connecting: 'settings.sync.operation.connecting',
  'waiting-for-idle': 'settings.sync.operation.waiting-for-idle',
  snapshotting: 'settings.sync.operation.snapshotting',
  encrypting: 'settings.sync.operation.encrypting',
  uploading: 'settings.sync.operation.uploading',
  publishing: 'settings.sync.operation.publishing',
  pruning: 'settings.sync.operation.pruning',
  listing: 'settings.sync.operation.listing',
  downloading: 'settings.sync.operation.downloading',
  inspecting: 'settings.sync.operation.inspecting',
  'preparing-restore': 'settings.sync.operation.preparing-restore',
  restoring: 'settings.sync.operation.restoring',
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
