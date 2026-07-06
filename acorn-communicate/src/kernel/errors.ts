/** Typed platform error mapped to RFC 9457 problem+json at the API boundary. */
export class PlatformError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PlatformError';
  }

  toProblem(instance?: string) {
    return {
      type: `https://docs.acorn-communicate.dev/problems/${this.code}`,
      title: this.code,
      status: this.status,
      detail: this.message,
      ...(instance ? { instance } : {}),
      ...(this.details !== undefined ? { errors: this.details } : {}),
    };
  }
}

export const notFound = (what: string, id?: string) =>
  new PlatformError('not-found', 404, id ? `${what} ${id} not found` : `${what} not found`);
export const invalid = (message: string, details?: unknown) =>
  new PlatformError('validation-failed', 400, message, details);
export const forbidden = (message = 'forbidden') => new PlatformError('forbidden', 403, message);
export const unauthorized = (message = 'unauthorized') =>
  new PlatformError('unauthorized', 401, message);
export const conflict = (message: string) => new PlatformError('conflict', 409, message);
export const gone = (message: string) => new PlatformError('gone', 410, message);
