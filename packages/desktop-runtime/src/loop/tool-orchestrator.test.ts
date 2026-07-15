import { describe, expect, it } from 'vitest';
import { ToolApprovalStore } from './tool-orchestrator.js';

describe('ToolApprovalStore', () => {
  it('releases every turn-scoped grant when a turn finishes', () => {
    const store = new ToolApprovalStore();
    store.approveForTurn('turn_1', ['exec:git-status']);
    store.enableStrictAutoReviewForTurn('turn_1');
    store.grantSandboxPermissions('turn', 'turn_1', 'environment_1', { writableRoots: ['/workspace'] });

    store.clearTurn('turn_1');

    expect(store.hasAll(['exec:git-status'], 'turn_1')).toBe(false);
    expect(store.strictAutoReviewEnabled('turn_1')).toBe(false);
    expect(store.sandboxWorkspaceWriteFor('turn_1', 'environment_1')).toEqual({});
  });
});
