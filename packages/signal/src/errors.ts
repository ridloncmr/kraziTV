export type SignalErrorCode =
  | "channel_not_found"
  | "channel_disabled"
  | "invalid_channel_authorization"
  | "no_current_playout"
  | "playout_unavailable"
  | "media_unavailable"
  | "invalid_playout_item"
  | "packaging_start_failed"
  | "packaging_failed"
  | "packaging_stopped"
  | "worker_startup_timeout"
  | "transition_failed"
  | "subscription_aborted"
  | "runtime_cleanup_failed"
  | "manager_shutdown";

export type SignalErrorDetails = Readonly<Record<string, unknown>>;

/** A provider-neutral runtime failure. HTTP adapters own status-code mapping. */
export class SignalError extends Error {
  readonly code: SignalErrorCode;
  readonly details: SignalErrorDetails;

  /** Sets `name` so logs identify runtime failures from any signal module. */
  constructor(
    code: SignalErrorCode,
    message: string,
    details: SignalErrorDetails = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SignalError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Keeps an already-typed failure and classifies anything else, so every
 * boundary preserves the most specific code while still carrying the cause.
 */
export function toSignalError(
  cause: unknown,
  code: SignalErrorCode,
  message: string,
  details: SignalErrorDetails,
): SignalError {
  if (cause instanceof SignalError) return cause;
  return new SignalError(
    code,
    message,
    details,
    cause === undefined ? undefined : { cause },
  );
}
