/** Preserves server error details so committed lifecycle changes never look rolled back. */
export class ApiError extends Error {
  /**
   * Retains the structured envelope rather than flattening retry policy into
   * text, and the HTTP status, so a `401` can be told apart from other refusals.
   */
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
