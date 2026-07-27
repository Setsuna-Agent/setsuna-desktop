export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return isNodeError(error) && error.code === code;
}
