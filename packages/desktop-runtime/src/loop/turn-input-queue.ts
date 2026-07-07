import type { RuntimeMailboxDelivery, RuntimeMessage } from '@setsuna-desktop/contracts';

export type RuntimeQueuedTurnInput =
  | { type: 'steer'; message: RuntimeMessage }
  | { type: 'mailbox'; input: RuntimeMailboxDelivery };

/**
 * Turn-local input queue for model-visible input that arrives after a task starts.
 *
 * Today the loop consumes steer messages; mailbox entries use the same ordering
 * boundary so multi-agent delivery can plug in without adding more ActiveTurn fields.
 */
export class RuntimeTurnInputQueue {
  private readonly pending: RuntimeQueuedTurnInput[] = [];
  private writesInFlight = 0;
  private readonly writeWaiters: Array<() => void> = [];

  beginWrite(): void {
    this.writesInFlight += 1;
  }

  settleWrite(): void {
    this.writesInFlight = Math.max(0, this.writesInFlight - 1);
    if (this.writesInFlight > 0) return;
    const waiters = this.writeWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
  }

  async waitForWrites(): Promise<void> {
    while (this.writesInFlight > 0) {
      await new Promise<void>((resolve) => this.writeWaiters.push(resolve));
    }
  }

  enqueueSteer(message: RuntimeMessage): void {
    this.pending.push({ type: 'steer', message });
  }

  enqueueMailbox(input: RuntimeMailboxDelivery): void {
    this.pending.push({ type: 'mailbox', input });
  }

  takeSteers(): RuntimeMessage[] {
    const steers: RuntimeMessage[] = [];
    this.takeMatching((item) => {
      if (item.type !== 'steer') return false;
      steers.push(item.message);
      return true;
    });
    return steers;
  }

  takeMailbox(): RuntimeMailboxDelivery[] {
    const inputs: RuntimeMailboxDelivery[] = [];
    this.takeMatching((item) => {
      if (item.type !== 'mailbox') return false;
      inputs.push(item.input);
      return true;
    });
    return inputs;
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  private takeMatching(consume: (item: RuntimeQueuedTurnInput) => boolean): void {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.pending.length; readIndex += 1) {
      const item = this.pending[readIndex];
      if (consume(item)) continue;
      this.pending[writeIndex] = item;
      writeIndex += 1;
    }
    this.pending.length = writeIndex;
  }
}
