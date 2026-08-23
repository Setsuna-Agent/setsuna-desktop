/**
 * Message citations remain a host contract because they are persisted inside
 * RuntimeMessage. Memory storage and behavior DTOs belong to the Memory Feature.
 */
export type RuntimeMemoryCitationEntry = {
  path: string;
  lineStart: number;
  lineEnd: number;
  note: string;
};

export type RuntimeMemoryCitation = {
  entries: RuntimeMemoryCitationEntry[];
  rolloutIds: string[];
};
