import type { SendTurnInput, StartTurnResponse } from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ApprovalReviewer } from '../../ports/approval-reviewer.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';

type AutomaticApprovalOverrideCoordinatorOptions = {
  clock: Clock;
  eventWriter: Pick<RuntimeEventWriter, 'append'>;
  ids: IdGenerator;
  reviewer?: ApprovalReviewer;
  startTurn(threadId: string, input: SendTurnInput): Promise<StartTurnResponse>;
};

/** Bridges a user override into one audited retry while the reviewer owns exact-action matching. */
export class AutomaticApprovalOverrideCoordinator {
  constructor(private readonly options: AutomaticApprovalOverrideCoordinatorOptions) {}

  async approveDeniedAction(
    approvalId: string,
    expectedThreadId?: string,
  ): Promise<boolean> {
    const registered = this.options.reviewer?.approveDeniedAction?.(approvalId);
    if (!registered) return false;
    if (expectedThreadId && registered.threadId !== expectedThreadId) {
      if (!registered.alreadyRegistered) {
        this.options.reviewer?.cancelDeniedActionApproval?.(approvalId);
      }
      return false;
    }
    if (registered.alreadyRegistered) return true;

    try {
      await this.options.startTurn(registered.threadId, {
        input: [
          `The user manually approved one retry of the exact action denied under approval ${approvalId}.`,
          'Retry only that exact action. Do not generalize this authorization to similar commands, parameters, targets, or permissions.',
        ].join(' '),
      });
    } catch (error) {
      this.options.reviewer?.cancelDeniedActionApproval?.(approvalId);
      throw error;
    }
    await this.options.eventWriter.append(registered.threadId, {
      id: this.options.ids.id('event'),
      threadId: registered.threadId,
      turnId: registered.turnId,
      type: 'approval.override_registered',
      createdAt: this.options.clock.now().toISOString(),
      payload: { approvalId },
    });
    return true;
  }
}
