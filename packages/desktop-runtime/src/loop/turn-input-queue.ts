import type { RuntimeMailboxDelivery, RuntimeMessage } from '@setsuna-desktop/contracts';

export type RuntimeQueuedSteer = {
  message: RuntimeMessage;
  skillIds: string[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export type RuntimeQueuedTurnInput =
  | { type: 'steer'; input: RuntimeQueuedSteer }
  | { type: 'mailbox'; input: RuntimeMailboxDelivery };

/**
 * 用于任务启动后到达、且模型可见输入的轮次本地队列。
 *
 * 当前循环会消费 steer 消息；邮箱条目复用同一顺序边界，使多代理投递无需增加
 * 更多 ActiveTurn 字段即可接入。
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

  enqueueSteer(input: RuntimeQueuedSteer): void {
    this.pending.push({ type: 'steer', input });
  }

  enqueueMailbox(input: RuntimeMailboxDelivery): void {
    this.pending.push({ type: 'mailbox', input });
  }

  takeSteers(): RuntimeQueuedSteer[] {
    const steers: RuntimeQueuedSteer[] = [];
    this.takeMatching((item) => {
      if (item.type !== 'steer') return false;
      steers.push(item.input);
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
