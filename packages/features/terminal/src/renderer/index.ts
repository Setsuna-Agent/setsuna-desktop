export { terminalRendererFeature } from './feature.js';
export {
  TerminalWorkspacePanel,
  TerminalWorkspacePanelHostProvider,
  type TerminalWorkspacePanelHost,
} from './TerminalWorkspacePanel.js';
export { LazyTerminalPane } from './LazyTerminalPane.js';
export type { TerminalPaneProps } from './TerminalPane.js';
export {
  appendTerminalRestoreBuffer,
  clearTerminalRestoreBuffer,
  markTerminalSessionExited,
  recordTerminalEventSeq,
  terminalLastEventSeq,
  terminalRestoreBuffer,
  terminalSessionExited,
} from './terminalRestoreBuffer.js';
export { terminalDisplayTitle } from './terminalTitle.js';
export { TerminalActions } from './actions/TerminalActions.js';
export { TerminalActionsHostProvider, type TerminalActionsHost } from './actions/context.js';
