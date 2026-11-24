export type ThreadDeletionOptions = {
  /** Skip a busy conversation instead of cancelling its work during storage cleanup. */
  onlyIfIdle?: boolean;
  /** Require the conversation to still be archived when deletion is admitted. */
  onlyIfArchived?: boolean;
};

export function parseThreadDeletionOptions(value: unknown): ThreadDeletionOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Thread deletion options must be an object.');
  }
  const { onlyIfIdle, onlyIfArchived } = value as Record<string, unknown>;
  if (onlyIfIdle !== undefined && typeof onlyIfIdle !== 'boolean') {
    throw new TypeError('onlyIfIdle must be a boolean.');
  }
  if (onlyIfArchived !== undefined && typeof onlyIfArchived !== 'boolean') {
    throw new TypeError('onlyIfArchived must be a boolean.');
  }
  return {
    ...(onlyIfIdle === undefined ? {} : { onlyIfIdle }),
    ...(onlyIfArchived === undefined ? {} : { onlyIfArchived }),
  };
}
