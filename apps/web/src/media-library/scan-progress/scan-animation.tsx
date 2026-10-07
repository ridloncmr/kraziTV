import { useId } from "react";
import { IconGradients, iconGradient } from "../../branding/icon-gradients.js";

/**
 * Original decorative artwork for the scan dialog: a sheet of paper arcing
 * from a source folder into a destination folder. The stylesheet moves the
 * paper only while `animating`; otherwise, and under reduced motion, the
 * paper rests beside the destination folder.
 */
export function ScanAnimation({ animating }: { animating: boolean }) {
  const id = useId();
  const gold = iconGradient(id, "gold");
  return (
    <svg
      width="200"
      height="80"
      viewBox="0 0 160 64"
      aria-hidden="true"
      className={`scan-animation${animating ? " animating" : ""}`}
    >
      <IconGradients id={id} />
      <ellipse cx="32" cy="58" rx="24" ry="3" fill="#14375e" opacity=".25" />
      <ellipse cx="128" cy="58" rx="24" ry="3" fill="#14375e" opacity=".25" />
      <path
        d="M10 22h16l5 5h23v29H10z"
        fill={gold}
        stroke="#a77423"
        strokeWidth="2"
      />
      <path
        d="M106 22h16l5 5h23v29h-44z"
        fill={gold}
        stroke="#a77423"
        strokeWidth="2"
      />
      {/* Each group moves one axis, so the paper follows a true arc. */}
      <g className="scan-paper-x">
        <g className="scan-paper-y">
          <g className="scan-paper-tilt">
            <path
              d="M-10-12h13l7 7v17h-20z"
              fill={iconGradient(id, "silver")}
              stroke="#4b6682"
            />
            <path d="M3-12v7h7" fill="none" stroke="#4b6682" />
            <path d="M-6-4h8m-8 5h12m-12 5h9" stroke="#6084a9" />
          </g>
        </g>
      </g>
      <path
        d="M11 33h45l-5 23H8z"
        fill={gold}
        stroke="#ab7a2f"
        strokeWidth="2"
      />
      <path
        d="M107 33h45l-5 23h-43z"
        fill={gold}
        stroke="#ab7a2f"
        strokeWidth="2"
      />
    </svg>
  );
}
