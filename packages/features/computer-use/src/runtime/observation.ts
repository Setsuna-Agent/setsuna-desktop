import type { ComputerFrame, ComputerWindow, ComputerWindows } from '../contracts/index.js';

const windowIdentity = ({ id, application, title }: ComputerWindow) => ({ id, application, title });

/** Model coordinates have one owner: the attached image. Native points, screen
 * origins and DPI stay inside the input backend, never alongside those pixels. */
export function computerObservation(frame: ComputerFrame) {
  return {
    kind: frame.kind, scope: frame.scope,
    ...(frame.scope === 'window' ? { window: windowIdentity(frame.window) } : {}),
    sessionId: frame.sessionId, observationId: frame.observationId, capturedAt: frame.capturedAt,
    width: frame.width, height: frame.height, coordinateSpace: frame.coordinateSpace,
    ...(frame.inputDispatched !== undefined ? { inputDispatched: frame.inputDispatched } : {}),
    ...(frame.actionError ? { actionError: frame.actionError } : {}),
  };
}

export function computerWindowList(result: ComputerWindows) {
  return { ...result, windows: result.windows.map(windowIdentity) };
}
