import { PointMenu } from '@setsuna-desktop/renderer-ui';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { threadMenuItems, type ThreadMenuOptions } from '../thread-menu/threadMenuItems.js';

export function SidebarThreadMenu({ anchor, ...options }: ThreadMenuOptions & {
  anchor: { x: number; y: number };
}) {
  const { t } = useI18n();
  return <PointMenu {...anchor} modal onClose={options.actions.close} menu={{ items: threadMenuItems(options, t) }} />;
}
