import type { CSSProperties } from "react";

/**
 * A classic segmented progress bar. With `progress` it is determinate and the
 * stylesheet snaps its fill to whole blocks; without it, it is indeterminate,
 * omits `aria-valuenow`, and the stylesheet sweeps a short group of blocks.
 */
export function SegmentedProgressBar({
  label,
  progress,
}: {
  label: string;
  progress?: { value: number; max: number };
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className="segmented-progress"
      {...(progress && {
        "aria-valuemin": 0,
        "aria-valuemax": progress.max,
        "aria-valuenow": progress.value,
      })}
    >
      <span
        className="segmented-progress-fill progress-segments"
        style={
          progress &&
          ({
            "--progress": filledFraction(progress.value, progress.max),
          } as CSSProperties)
        }
      />
    </div>
  );
}

/** The share of the track to fill, kept within it whatever counts the caller reports. */
function filledFraction(value: number, max: number): number {
  return max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
}
