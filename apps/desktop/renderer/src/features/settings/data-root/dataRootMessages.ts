import type {
  DesktopDataMigrationCategoryId,
  DesktopDataMigrationPhase,
} from '@setsuna-desktop/contracts';
import type { MessageKey } from '../../../shared/i18n/messages.js';

export const dataRootPhaseMessageKey: Record<DesktopDataMigrationPhase, MessageKey> = {
  scanning: 'dataRoot.phase.scanning',
  copying: 'dataRoot.phase.copying',
  merging_memory: 'dataRoot.phase.merging_memory',
  validating: 'dataRoot.phase.validating',
  committing: 'dataRoot.phase.committing',
  restarting: 'dataRoot.phase.restarting',
  failed: 'dataRoot.phase.failed',
};

export const dataRootCategoryMessageKey: Record<
  DesktopDataMigrationCategoryId,
  MessageKey
> = {
  conversations: 'dataRoot.category.conversations',
  settings_credentials: 'dataRoot.category.settings_credentials',
  projects_capabilities: 'dataRoot.category.projects_capabilities',
  memories: 'dataRoot.category.memories',
  attachments_images: 'dataRoot.category.attachments_images',
  runtime_dependencies: 'dataRoot.category.runtime_dependencies',
  desktop_browser: 'dataRoot.category.desktop_browser',
};
