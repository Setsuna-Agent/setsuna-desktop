import type {
  ModelStreamEvent,
  RuntimeMemoryCitation,
  RuntimeStreamItem,
  RuntimeToolCall,
} from '@setsuna-desktop/contracts';
import type { MemoryCitationOutputFilter } from '@setsuna-desktop/feature-memory/contracts';

export type LegacyModelStreamMirrorState = {
  reasoningItemStarted: boolean;
  reasoningText: string;
  toolCalls: Map<string, RuntimeToolCall>;
  completedToolCallIds: Set<string>;
  tokenCountPublished: boolean;
};

export type AssistantOutputAccumulator = {
  append(delta: string): Promise<void>;
  finish(): Promise<RuntimeMemoryCitation | undefined>;
  text(): string;
};

export function createAssistantOutputAccumulator(
  publishVisibleDelta: (delta: string) => Promise<void>,
  filter: MemoryCitationOutputFilter,
): AssistantOutputAccumulator {
  let visibleText = '';

  const appendParsed = async (chunk: { visibleText: string }) => {
    if (!chunk.visibleText) return;
    visibleText += chunk.visibleText;
    await publishVisibleDelta(chunk.visibleText);
  };

  return {
    async append(delta: string) {
      if (delta) await appendParsed(filter.push(delta));
    },
    async finish() {
      const completed = filter.finish();
      await appendParsed(completed);
      return completed.citation;
    },
    text: () => visibleText,
  };
}

export function createLegacyModelStreamMirrorState(): LegacyModelStreamMirrorState {
  return {
    reasoningItemStarted: false,
    reasoningText: '',
    toolCalls: new Map(),
    completedToolCallIds: new Set(),
    tokenCountPublished: false,
  };
}

export function createAssistantItemStreamBridge(
  output: AssistantOutputAccumulator,
  publishReasoningDelta: (delta: string) => Promise<void> = async () => undefined,
): {
  appendAgent(delta: string): Promise<void>;
  appendReasoning(delta: string): Promise<void>;
  consume(event: ModelStreamEvent): Promise<void>;
  finish(): Promise<void>;
} {
  const items = new Map<string, RuntimeStreamItem>();
  const emittedTextItemIds = new Set<string>();

  const appendReasoning = async (delta: string) => {
    if (!delta) return;
    await publishReasoningDelta(delta);
  };
  const appendAgent = async (delta: string) => {
    if (!delta) return;
    await output.append(delta);
  };
  const appendItemText = async (item: RuntimeStreamItem, text: string) => {
    if (item.kind === 'agent_message') {
      emittedTextItemIds.add(item.id);
      await appendAgent(text);
    } else if (item.kind === 'reasoning') {
      emittedTextItemIds.add(item.id);
      await appendReasoning(text);
    }
  };

  return {
    appendAgent,
    appendReasoning,
    async consume(event) {
      if (event.type === 'item_started') {
        items.set(event.item.id, event.item);
      } else if (event.type === 'item_delta') {
        const item = items.get(event.itemId);
        if (item) await appendItemText(item, event.delta);
      } else if (event.type === 'item_completed') {
        items.set(event.item.id, event.item);
        if (event.item.content && !emittedTextItemIds.has(event.item.id)) await appendItemText(event.item, event.item.content);
      } else if (event.type === 'reasoning_summary_delta' || event.type === 'reasoning_raw_delta') {
        if (event.itemId) emittedTextItemIds.add(event.itemId);
        await appendReasoning(event.text);
      }
    },
    async finish() {},
  };
}
