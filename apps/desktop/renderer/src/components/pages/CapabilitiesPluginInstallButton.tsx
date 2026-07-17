import { Loader2 } from 'lucide-react';
import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';

export function CapabilitiesPluginInstallButton({
  installing,
  onInstall,
  plugin,
}: {
  installing: boolean;
  onInstall: (plugin: RuntimePluginMarketplaceItem) => Promise<void>;
  plugin: RuntimePluginMarketplaceItem;
}) {
  const disabled = plugin.installed || installing;
  const label = plugin.installed ? '已安装' : installing ? '获取中' : '获取';

  return (
    <button
      className={`desktop-plugin-market__get${plugin.installed ? ' is-installed' : ''}`}
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
