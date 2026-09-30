export type MediaDiscoveryErrorCode =
  | "invalid_root_path"
  | "root_not_found"
  | "root_not_directory"
  | "traversal_failed"
  | "cancelled";

/**
 * A discovery failure for a whole root. Discovery never returns partial results,
 * so callers can treat any error as "the root's contents are unknown".
 */
export class MediaDiscoveryError extends Error {
  readonly code: MediaDiscoveryErrorCode;
  /** The path whose access failed, or the root for root-level failures. */
  readonly path: string;

  constructor(
    code: MediaDiscoveryErrorCode,
    message: string,
    path: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MediaDiscoveryError";
    this.code = code;
    this.path = path;
  }
}
