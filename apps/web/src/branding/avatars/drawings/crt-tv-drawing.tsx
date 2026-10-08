import { iconGradient } from "../../icon-gradients.js";

/**
 * A boxy wood-cabinet CRT with a rabbit-ear aerial and a glowing screen.
 * Square and warm-toned on purpose, so it never reads as the kraziTV logo's
 * rounded blue set. `id` names the enclosing picture's `IconGradients`.
 */
export function CrtTvDrawing({ id }: { id: string }) {
  return (
    <>
      <ellipse cx="32" cy="58" rx="24" ry="3.5" fill="#14375e" opacity=".3" />
      <path
        d="M32 21 18 8m14 13 14-13"
        stroke="#2c3e55"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M32 21 18 8m14 13 14-13"
        stroke="#dde9f5"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="18" cy="8" r="2.4" fill="#dde9f5" stroke="#2c3e55" />
      <circle cx="46" cy="8" r="2.4" fill="#dde9f5" stroke="#2c3e55" />
      <path
        d="M25 23a7 5 0 0 1 14 0z"
        fill={iconGradient(id, "silver")}
        stroke="#2c3e55"
        strokeWidth="1.4"
      />
      <path d="M14 54h5v4h-5zm31 0h5v4h-5z" fill="#4a2d0c" />
      <rect
        x="7"
        y="22"
        width="50"
        height="33"
        rx="4"
        fill={iconGradient(id, "gold")}
        stroke="#7a4c12"
        strokeWidth="2"
      />
      <rect
        x="11"
        y="26"
        width="31"
        height="25"
        rx="7"
        fill="#1f3a34"
        stroke="#4a2d0c"
        strokeWidth="2"
      />
      <rect
        x="14"
        y="29"
        width="25"
        height="19"
        rx="5"
        fill="#5fd4a8"
        opacity=".55"
      />
      <path
        d="M16 33c2-3 6-4 10-4"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".75"
      />
      <rect
        x="45"
        y="26"
        width="8"
        height="25"
        rx="2"
        fill="#7a4c12"
        opacity=".3"
      />
      <circle
        cx="49"
        cy="31"
        r="2.8"
        fill={iconGradient(id, "silver")}
        stroke="#2c3e55"
      />
      <circle
        cx="49"
        cy="39"
        r="2.8"
        fill={iconGradient(id, "silver")}
        stroke="#2c3e55"
      />
      <path
        d="M46.5 45h5m-5 2.5h5"
        stroke="#4a2d0c"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M10 24.5h43" stroke="#fff" opacity=".5" />
    </>
  );
}
