import { Blocks } from 'lucide-react';
import type { RuntimePluginUse } from './runtimePluginUsage.js';

export function RuntimePluginUses({
  active,
  plugins,
}: {
  active: boolean;
  plugins: RuntimePluginUse[];
}) {
  if (!plugins.length) return null;
  const status = active ? '正在使用插件' : '已使用插件';
  return (
    <div
      className={`chat-plugin-uses ${active ? 'is-active' : 'is-complete'}`}
      aria-label={`${status}：${plugins.map((plugin) => plugin.name).join('、')}`}
      aria-live={active ? 'polite' : undefined}
    >
      <span className="chat-plugin-uses__status">{status}</span>
      <span className="chat-plugin-uses__list">
        {plugins.map((plugin) => (
          <span className="chat-plugin-use" key={plugin.id} title={`插件：${plugin.name}`}>
            <span className="chat-plugin-use__icon" aria-hidden="true">
              <Blocks size={11} strokeWidth={2} />
            </span>
            <span className="chat-plugin-use__name">{plugin.name}</span>
          </span>
        ))}
      </span>
    </div>
  );
}
