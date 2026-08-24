import { clearTerminalRestoreBuffer } from '@setsuna-desktop/feature-terminal/renderer';

export function clearTerminalFeatureRestoreBuffer(sessionId: string): void {
  clearTerminalRestoreBuffer(sessionId);
}
