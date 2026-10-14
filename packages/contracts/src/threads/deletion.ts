export type ThreadDeletionOptions = {
  /** Skip a busy conversation instead of cancelling its work during storage cleanup. */
  onlyIfIdle?: boolean;
};

export function parseThreadDeletionOptions(value: unknown): ThreadDeletionOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Thread deletion options must be an object.');
  }
  const { onlyIfIdle } = value as Record<string, unknown>;
  if (onlyIfIdle !== undefined && typeof onlyIfIdle !== 'boolean') {
    throw new TypeError('onlyIfIdle must be a boolean.');
  }
  return onlyIfIdle === undefined ? {} : { onlyIfIdle };
}
