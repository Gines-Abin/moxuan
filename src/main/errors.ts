export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly errorCode = 'SERVICE_ERROR',
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export function requireCondition(condition: unknown, statusCode: number, message: string): asserts condition {
  if (!condition) throw new ServiceError(statusCode, message);
}
