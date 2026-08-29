export class SideConversationThreadNotFoundError extends Error {
  constructor() {
    super('Thread not found.');
    this.name = 'SideConversationThreadNotFoundError';
  }
}

export class SideConversationInvalidParentError extends Error {
  constructor() {
    super('A side conversation must be created from a primary thread.');
    this.name = 'SideConversationInvalidParentError';
  }
}
