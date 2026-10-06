/** Preserves server error details so committed lifecycle changes never look rolled back. */
export class ApiError extends Error {
  /** Retains the structured envelope rather than flattening retry policy into text. */
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
