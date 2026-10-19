import { SignalError } from "../../errors.js";

/**
 * Reports an FFmpeg process that closed before its output ever became usable,
 * which ends the session because the item it served never aired.
 */
export function prematureExit(): SignalError {
  return new SignalError(
    "packaging_failed",
    "FFmpeg exited before producing usable output",
    { reason: "premature_exit" },
  );
}

/**
 * Reports a prepared item whose FFmpeg process stayed silent past its
 * readiness timeout, so a stalled startup fails the preparation instead of
 * leaving the channel quiet at the boundary (ADR 0016).
 */
export function itemReadinessTimeout(): SignalError {
  return new SignalError(
    "packaging_failed",
    "Prepared FFmpeg item produced no usable output in time",
    { reason: "item_readiness_timeout" },
  );
}

/**
 * Reports a prepared item whose held output passed its limit before its
 * commit, which ends the session because what it held is gone (ADR 0016).
 */
export function preparedOutputOverflow(): SignalError {
  return new SignalError(
    "packaging_failed",
    "Prepared FFmpeg item held more output than its limit before commit",
    { reason: "prepared_output_limit" },
  );
}
