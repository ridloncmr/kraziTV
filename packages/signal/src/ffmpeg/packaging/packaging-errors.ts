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
 * Reports a committed item whose FFmpeg process stayed silent past its
 * readiness timeout, so a stalled transition cannot leave the channel quiet.
 */
export function itemReadinessTimeout(): SignalError {
  return new SignalError(
    "packaging_failed",
    "Committed FFmpeg item produced no usable output in time",
    { reason: "item_readiness_timeout" },
  );
}
