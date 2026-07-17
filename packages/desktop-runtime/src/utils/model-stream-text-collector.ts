import type { ModelStreamEvent, RuntimeStreamItemKind } from '@setsuna-desktop/contracts';

export type ModelStreamTextCollector = {
  consume(event: ModelStreamEvent): void;
  text(): string;
};

/** 从旧版增量流和基于条目的模型流中收集可见代理文本。 */
export function createModelStreamTextCollector(): ModelStreamTextCollector {
  const itemKinds = new Map<string, RuntimeStreamItemKind>();
  const itemText = new Map<string, string>();
  const pendingDeltas = new Map<string, string>();
  let output = '';

  const appendAgentItemText = (itemId: string, text: string) => {
    if (!text) return;
    itemText.set(itemId, `${itemText.get(itemId) ?? ''}${text}`);
    output += text;
  };

  const flushPendingAgentText = (itemId: string) => {
    const pending = pendingDeltas.get(itemId) ?? '';
    pendingDeltas.delete(itemId);
    appendAgentItemText(itemId, pending);
  };

  return {
    consume(event) {
      if (event.type === 'text_delta') {
        output += event.text;
        return;
      }
      if (event.type === 'item_started') {
        itemKinds.set(event.item.id, event.item.kind);
        if (event.item.kind === 'agent_message') flushPendingAgentText(event.item.id);
        else pendingDeltas.delete(event.item.id);
        return;
      }
      if (event.type === 'item_delta') {
        const kind = itemKinds.get(event.itemId);
        if (kind === 'agent_message') appendAgentItemText(event.itemId, event.delta);
        else if (kind === undefined) pendingDeltas.set(event.itemId, `${pendingDeltas.get(event.itemId) ?? ''}${event.delta}`);
        return;
      }
      if (event.type !== 'item_completed') return;

      itemKinds.set(event.item.id, event.item.kind);
      if (event.item.kind !== 'agent_message') {
        pendingDeltas.delete(event.item.id);
        return;
      }
      flushPendingAgentText(event.item.id);
      const streamedText = itemText.get(event.item.id) ?? '';
      const completedText = event.item.content ?? '';
      if (!streamedText) appendAgentItemText(event.item.id, completedText);
      else if (completedText.startsWith(streamedText)) appendAgentItemText(event.item.id, completedText.slice(streamedText.length));
    },
    text() {
      // 实现不规范的兼容供应商可能省略项目生命周期元数据；其 item_delta 载荷
      // 仍是唯一可用的可见模型输出。
      return output + [...pendingDeltas.values()].join('');
    },
  };
}
