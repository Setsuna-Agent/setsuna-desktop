import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { effectiveRuntimeThreadModelBinding } from '../loop/core/runtime-thread-model.js';
import type { RuntimeFactory } from './types.js';

/** Adds a legacy thread's effective binding at the server boundary without mutating its history. */
export async function runtimeThreadResponse(
  runtime: RuntimeFactory,
  thread: RuntimeThread,
  completeThread: RuntimeThread = thread,
): Promise<RuntimeThread> {
  if (thread.modelBinding) return thread;
  const hasLegacyModelSource = completeThread.messages.some((message) => (
    message.role === 'assistant' && Boolean(message.providerMetadata?.source)
  ));
  if (!hasLegacyModelSource) return thread;
  const config = await runtime.configStore.getConfig().catch(() => null);
  const modelBinding = effectiveRuntimeThreadModelBinding(config, completeThread);
  return modelBinding ? { ...thread, modelBinding } : thread;
}
