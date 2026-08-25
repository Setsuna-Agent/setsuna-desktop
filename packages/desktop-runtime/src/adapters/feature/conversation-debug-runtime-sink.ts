import {
  createNoopConversationDebugControl,
  type ConversationDebugControl,
  type ConversationDebugTraceSink,
  type RuntimeDebugTraceInput,
} from '@setsuna-desktop/feature-conversation-debug/contracts';

/** Keeps core runtime instrumentation stable while the optional Feature is activated. */
export class ConversationDebugRuntimeSink implements ConversationDebugTraceSink {
  private control: ConversationDebugControl = createNoopConversationDebugControl();

  bind(control: ConversationDebugControl): () => void {
    this.control = control;
    return () => {
      if (this.control === control) this.control = createNoopConversationDebugControl();
    };
  }

  enabled(): boolean {
    return this.control.enabled();
  }

  append(input: RuntimeDebugTraceInput): void {
    this.control.append(input);
  }
}
