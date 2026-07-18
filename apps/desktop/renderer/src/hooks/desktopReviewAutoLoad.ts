export type DesktopReviewAutoLoadInput = {
  activeView: string;
  autoLoad: boolean;
  error: string | null;
  hasState: boolean;
  hasWorkspace: boolean;
  loading: boolean;
  panelOpen: boolean;
};

/** Keep automatic status reads independent from whether the full review panel has been opened. */
export function shouldLoadDesktopReviewState(input: DesktopReviewAutoLoadInput): boolean {
  if (input.activeView !== 'chat' || !input.hasWorkspace) return false;
  if (!input.autoLoad && !input.panelOpen) return false;
  return !input.loading && !input.hasState && !input.error;
}
