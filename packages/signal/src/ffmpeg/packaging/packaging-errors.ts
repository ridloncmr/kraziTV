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
 * Reports a prepared item or a stand-in whose FFmpeg process stayed silent
 * past its readiness timeout, so a stalled startup fails instead of leaving
 * the channel quiet (ADR 0016, ADR 0020).
 */
export function itemReadinessTimeout(): SignalError {
  return new SignalError(
    "packaging_failed",
    "FFmpeg item produced no usable output in time",
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

/**
 * Reports an airing item whose FFmpeg process went silent, whether hung or
 * finished early because its media was shorter than probed, so a stand-in
 * fills the rest of its airtime instead of dead air (ADR 0020).
 */
export function outputStalled(): SignalError {
  return new SignalError(
    "packaging_failed",
    "Airing FFmpeg item stopped producing output",
    { reason: "output_stalled" },
  );
}
