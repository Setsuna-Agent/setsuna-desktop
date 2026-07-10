export class RuntimeHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RuntimeHttpError';
  }
}
