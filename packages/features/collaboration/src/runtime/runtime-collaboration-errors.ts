export class CollaborationThreadNotFoundError extends Error {
  constructor(readonly threadId: string) {
    super(`Thread not found: ${threadId}`);
    this.name = 'CollaborationThreadNotFoundError';
  }
}
