import { describe, expect, it } from 'vitest';
import { runtimeAccessModeForConfig, runtimeAccessModeSelection } from './runtimeAccessMode';

describe('runtime access mode', () => {
  it('persists full access as one atomic approval and sandbox selection', () => {
    expect(runtimeAccessModeSelection('full-access')).toEqual({
      approvalPolicy: 'full',
      permissionProfile: 'danger-full-access',
    });
  });

  it('maps agent approval to risk-based approval inside the workspace sandbox', () => {
    expect(runtimeAccessModeSelection('agent-approval')).toEqual({
      approvalPolicy: 'on-request',
      permissionProfile: 'workspace-write',
    });
  });

  it('projects inconsistent legacy combinations onto the conservative visible level', () => {
    expect(runtimeAccessModeForConfig({ approvalPolicy: 'on-request', permissionProfile: 'read-only' })).toBe('request-approval');
    expect(runtimeAccessModeForConfig({ approvalPolicy: 'full', permissionProfile: 'workspace-write' })).toBe('request-approval');
    expect(runtimeAccessModeForConfig({ approvalPolicy: 'strict', permissionProfile: 'danger-full-access' })).toBe('request-approval');
    expect(runtimeAccessModeForConfig({ approvalPolicy: 'full', permissionProfile: 'danger-full-access' })).toBe('full-access');
  });
});
