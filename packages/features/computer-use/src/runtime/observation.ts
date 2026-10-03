import type { ComputerFrame, ComputerWindow, ComputerWindows } from '../contracts/index.js';

const windowIdentity = ({ id, application, title }: ComputerWindow) => ({ id, application, title });

/** Model coordinates have one owner: the attached image. Native points, screen
 * origins and DPI stay inside the input backend, never alongside those pixels. */
export function computerObservation(frame: ComputerFrame) {
  return {
    kind: frame.kind, scope: frame.scope,
    ...(frame.scope === 'window' ? { window: windowIdentity(frame.window) } : {}),
    observationId: frame.observationId, capturedAt: frame.capturedAt,
    width: frame.width, height: frame.height, coordinateSpace: frame.coordinateSpace,
    ...(frame.inputDispatched !== undefined ? { inputDispatched: frame.inputDispatched } : {}),
    ...(frame.actionError ? { actionError: frame.actionError } : {}),
  };
}

export function computerWindowList(result: ComputerWindows) {
  // This backend does not enumerate windows. An empty list would incorrectly
  // imply that no applications are running or no desktop can be controlled.
  if (result.mode === 'foreground-desktop') return {
    kind: result.kind, mode: result.mode,
    nextStep: { tool: 'computer_start', arguments: {} },
    note: 'Window enumeration is unavailable in this mode; application running state is unknown. Call computer_start with {} to inspect the primary desktop screenshot.',
  };
  return { ...result, windows: result.windows.map(windowIdentity) };
}
