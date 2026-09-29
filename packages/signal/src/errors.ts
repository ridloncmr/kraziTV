export type SignalErrorCode =
  | "channel_not_found"
  | "channel_disabled"
  | "invalid_channel_authorization"
  | "no_current_playout"
  | "media_unavailable"
  | "invalid_playout_item"
  | "packaging_start_failed"
  | "packaging_failed"
  | "packaging_stopped"
  | "worker_startup_timeout"
  | "subscription_aborted"
  | "runtime_cleanup_failed"
  | "manager_shutdown";

export type SignalErrorDetails = Readonly<Record<string, unknown>>;

/** A provider-neutral runtime failure. HTTP adapters own status-code mapping. */
export class SignalError extends Error {
  readonly code: SignalErrorCode;
  readonly details: SignalErrorDetails;

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
