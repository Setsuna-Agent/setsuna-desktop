import { defineRendererMessageBundle } from '@setsuna-desktop/feature-core/renderer';
import { webDavSyncEnUS, webDavSyncZhCN } from './messages-source.js';

export const webDavSyncMessages = defineRendererMessageBundle({
  namespace: 'feature.webdavSync',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      ...webDavSyncZhCN,
      'feature.webdavSync.common.cancel': '取消',
      'feature.webdavSync.common.close': '关闭',
      'feature.webdavSync.common.loading': '加载中…',
      'feature.webdavSync.common.processing': '处理中',
    },
    'en-US': {
      ...webDavSyncEnUS,
      'feature.webdavSync.common.cancel': 'Cancel',
      'feature.webdavSync.common.close': 'Close',
      'feature.webdavSync.common.loading': 'Loading…',
      'feature.webdavSync.common.processing': 'Processing',
    },
  },
});
