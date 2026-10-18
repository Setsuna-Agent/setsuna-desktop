import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { projectThreadFilePreviews } from '@setsuna-desktop/contracts';
import { effectiveRuntimeThreadModelBinding } from '../loop/core/runtime-thread-model.js';
import type { RuntimeFactory } from './types.js';

/** Adds a legacy thread's effective binding at the server boundary without mutating its history. */
export async function runtimeThreadResponse(
  runtime: RuntimeFactory,
  thread: RuntimeThread,
  completeThread: RuntimeThread = thread,
): Promise<RuntimeThread> {
  if (!thread.modelBinding && completeThread === thread && (thread.messagePage?.nextBefore ?? null) !== null) {
    // Model ownership can originate before this page. Sampling has all messages but excludes
    // undo bodies and diagnostics, so inferring it must not clone the full archival snapshot.
    const sampling = await runtime.threadStore.getSamplingState?.(thread.id);
    completeThread = sampling ? { ...thread, messages: sampling.messages }
      : await runtime.threadStore.getThread(thread.id) ?? thread;
  }
  thread = projectThreadFilePreviews(thread);
  if (thread.modelBinding) return thread;
  const hasLegacyModelSource = completeThread.messages.some((message) => (
    message.role === 'assistant' && Boolean(message.providerMetadata?.source)
  ));
  if (!hasLegacyModelSource) return thread;
  const config = await runtime.configStore.getConfig().catch(() => null);
  const modelBinding = effectiveRuntimeThreadModelBinding(config, completeThread);
  return modelBinding ? { ...thread, modelBinding } : thread;
}
