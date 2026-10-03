export type ComputerControlErrorCode =
  | 'invalid-command' | 'session-required' | 'session-mismatch' | 'session-busy'
  | 'turn-revoked' | 'control-unavailable' | 'operation-failed';

/** Main reports whether the requesting turn's session survived the command.
 * Transport failures have no such guarantee and still require runtime cleanup. */
export type ComputerControlFailure = {
  code: ComputerControlErrorCode;
  sessionState: 'unchanged' | 'closed';
  message: string;
};

export class ComputerControlError extends Error {
  constructor(readonly failure: ComputerControlFailure) {
    super(failure.message);
    this.name = 'ComputerControlError';
  }
}
