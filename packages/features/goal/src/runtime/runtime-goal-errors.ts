export class GoalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalConflictError';
  }
}

export class GoalThreadNotFoundError extends Error {
  constructor(readonly threadId: string) {
    super(`Thread not found: ${threadId}`);
    this.name = 'GoalThreadNotFoundError';
  }
}
