import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { Loader2 } from 'lucide-react';

export function CapabilitiesPluginInstallButton({
  installing,
  onInstall,
  plugin,
}: {
  installing: boolean;
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  plugin: RuntimePluginMarketplaceItem;
}) {
  const updateAvailable = plugin.installed && plugin.updateAvailable;
  const disabled = (plugin.installed && !updateAvailable) || installing;
  const label = installing
    ? updateAvailable ? '更新中' : '获取中'
    : updateAvailable ? '更新'
      : plugin.installed ? '已安装' : '获取';

  return (
    <button
      className={`desktop-plugin-market__get${plugin.installed && !updateAvailable ? ' is-installed' : ''}`}
      type="button"
      aria-label={`${label}：${plugin.name}`}
      disabled={disabled}
      onClick={() => void onInstall(plugin)}
    >
      {installing ? <Loader2 className="is-spinning" size={13} /> : null}
      <span>{label}</span>
    </button>
  );
}
