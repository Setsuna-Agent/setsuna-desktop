/** A display-only file operation reference. Its compact data contains file metadata,
 * while the authoritative tool result and undo patch stay in the runtime store. */
export type RuntimeFileChangeOperation = {
  messageId: string;
  run: { id: string; name: string; status: 'success'; data?: unknown };
};

export type RuntimeFileChangeGroups = Record<string, RuntimeFileChangeOperation[]>;

/** Fetch one recorded file's excerpts without loading its surrounding transcript. */
export type RuntimeFileChangePreviewInput = { path: string; toolCallIds: string[] };
