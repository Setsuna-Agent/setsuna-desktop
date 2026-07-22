import { describe, expect, it } from 'vitest';
import {
  shouldLoadDesktopReviewState,
  type DesktopReviewAutoLoadInput,
} from '../../../../../src/features/workspace/hooks/desktopReviewAutoLoad.js';

describe('shouldLoadDesktopReviewState', () => {
  it('loads the conversation environment without requiring the review panel to be opened', () => {
    expect(shouldLoadDesktopReviewState(reviewInput())).toBe(true);
  });

  it('loads on demand for an open review panel even when conversation auto-load is disabled', () => {
    expect(shouldLoadDesktopReviewState(reviewInput({ autoLoad: false, panelOpen: true }))).toBe(true);
  });

  it.each([
    { loading: true },
    { hasState: true },
    { error: 'git failed' },
    { hasWorkspace: false },
    { activeView: 'settings' },
  ] satisfies Array<Partial<DesktopReviewAutoLoadInput>>)('does not duplicate or retry an unavailable review load: %o', (patch) => {
    expect(shouldLoadDesktopReviewState(reviewInput(patch))).toBe(false);
  });
});

function reviewInput(patch: Partial<DesktopReviewAutoLoadInput> = {}): DesktopReviewAutoLoadInput {
  return {
    activeView: 'chat',
    autoLoad: true,
    error: null,
    hasState: false,
    hasWorkspace: true,
    loading: false,
    panelOpen: false,
    ...patch,
  };
}
