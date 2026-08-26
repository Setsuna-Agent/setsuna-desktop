import type { RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import type { UsageRecorder } from '../../ports/usage-store.js';

const NOOP_USAGE_RECORDER: UsageRecorder = Object.freeze({
  recordUsage: async (input) => Object.freeze({ id: '', ...input }),
});

/** Stable recorder injected before optional Features activate, then bound transactionally. */
export class BindableUsageRecorder implements UsageRecorder {
  private recorder: UsageRecorder = NOOP_USAGE_RECORDER;

  bind(recorder: UsageRecorder): () => void {
    this.recorder = recorder;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.recorder === recorder) this.recorder = NOOP_USAGE_RECORDER;
    };
  }

  recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<RuntimeUsageRecord> {
    return this.recorder.recordUsage(input);
  }
}
