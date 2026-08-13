import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { withAvailableApprovalRetries } from '../../src/server/runtime-thread-routes.js';
import type { RuntimeFactory } from '../../src/server/types.js';

describe('runtime thread route approval capabilities', () => {
  it('hides persisted exact retries that the current runtime no longer retains', () => {
    const messages: RuntimeMessage[] = [{
      id: 'assistant_1',
      role: 'assistant',
      content: '',
      createdAt: '2026-08-13T00:00:00.000Z',
      status: 'complete',
      toolRuns: [
        deniedRun('approval_available'),
        deniedRun('approval_from_prior_runtime'),
      ],
    }];
    const runtime = {
      approvalOverrides: {
        hasDeniedAction: vi.fn((approvalId: string) => approvalId === 'approval_available'),
      },
    } as unknown as Pick<RuntimeFactory, 'approvalOverrides'>;

    const result = withAvailableApprovalRetries(runtime, messages);

    expect(result[0]?.toolRuns?.[0]?.approvalReviewAssessment?.exactRetryAvailable).toBe(true);
    expect(result[0]?.toolRuns?.[1]?.approvalReviewAssessment?.exactRetryAvailable).toBe(false);
    expect(messages[0]?.toolRuns?.[1]?.approvalReviewAssessment?.exactRetryAvailable).toBe(true);
  });
});

function deniedRun(approvalId: string): NonNullable<RuntimeMessage['toolRuns']>[number] {
  return {
    id: `run_${approvalId}`,
    name: 'configure_mcp_server',
    status: 'error',
    approvalId,
    approvalReviewAssessment: {
      status: 'denied',
      rationale: 'The action was denied.',
      exactRetryAvailable: true,
    },
  };
}
