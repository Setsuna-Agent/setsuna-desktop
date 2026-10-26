import type { ModelRequest, RuntimeUsage } from '@setsuna-desktop/contracts';
import type { GoalRuntimeHost } from '@setsuna-desktop/feature-goal/contracts';
import type { ModelClient } from '../../ports/model-client.js';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';

export function goalVerificationModel(dependencies: {
  modelClient: ModelClient; clock: Clock; ids: IdGenerator; eventWriter: RuntimeEventWriter;
}): GoalRuntimeHost['generateVerification'] {
  return async (request: ModelRequest) => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, ...(request.signal ? [request.signal] : [])]);
    const timer = setTimeout(() => controller.abort(new Error('Goal verification timed out.')), 90_000);
    const output = createModelStreamTextCollector();
    let finishReason: string | undefined;
    let usage: RuntimeUsage | undefined;
    try {
      for await (const event of dependencies.modelClient.stream({ ...request, signal })) {
        signal.throwIfAborted();
        output.consume(event);
        if (event.type === 'done') finishReason = event.finishReason;
        if (event.type === 'usage' || event.type === 'token_count') usage = event.usage;
        if (event.type === 'tool_calls') throw new Error('Goal verifier attempted to execute tools.');
        if (output.text().length > 64_000) { controller.abort(); throw new Error('Goal verifier output exceeded its limit.'); }
      }
      return { content: output.text(), finishReason };
    } finally {
      clearTimeout(timer);
      if (usage && request.usageContext) {
        const { threadId, turnId } = request.usageContext;
        await dependencies.eventWriter.appendBatch(threadId, [{ id: dependencies.ids.id('event'),
          threadId, turnId, type: 'token.count', createdAt: dependencies.clock.now().toISOString(), payload: { usage } }]);
      }
    }
  };
}
