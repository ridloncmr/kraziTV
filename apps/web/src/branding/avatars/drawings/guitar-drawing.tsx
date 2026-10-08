import { iconGradient } from "../../icon-gradients.js";

/**
 * A red double-cutaway electric guitar slanted across a purple stage with
 * a spotlight. Paints its own background over the frame's. `id` names the
 * enclosing picture's `IconGradients` and prefixes this drawing's own.
 */
export function GuitarDrawing({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-stage`} x2="0" y2="1">
          <stop stopColor="#7a5bd0" />
          <stop offset="1" stopColor="#2a1b5e" />
        </linearGradient>
        <linearGradient id={`${id}-body`} x2=".3" y2="1">
          <stop stopColor="#ff8a66" />
          <stop offset=".45" stopColor="#e0352a" />
          <stop offset="1" stopColor="#8a1511" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${id}-stage)`} />
      <path d="M22 0h20l14 64H8z" fill="#fff" opacity=".12" />
      <g transform="rotate(38 32 34)">
        <path
          d="M28.5 1.5h7l1 9h-9z"
          fill="#24262e"
          stroke="#0d0e12"
          strokeWidth="1.2"
        />
        {[3, 6, 9].map((y) => (
          <g key={y}>
            <circle
              cx="26.6"
              cy={y}
              r="1.3"
              fill={iconGradient(id, "silver")}
            />
            <circle
              cx="37.4"
              cy={y}
              r="1.3"
              fill={iconGradient(id, "silver")}
            />
          </g>
        ))}
        <rect
          x="29.6"
          y="10"
          width="4.8"
          height="27"
          fill="#b06c2c"
          stroke="#5a3412"
          strokeWidth="1"
        />
        {[14, 18, 22, 26, 30].map((y) => (
          <path
            key={y}
            d={`M29.8 ${y}h4.4`}
            stroke="#e6edf5"
            strokeWidth=".7"
          />
        ))}
        <path
          d="M23 35c-4-2-7 2-4.6 6-4 4.5-4.5 12 .6 16.5 5 4.6 21 4.6 26 0 5-4.5 4.6-12 .6-16.5C47.9 37 45 33 41 35c-2.5 1.6-5.5 2.5-9 2.5s-6.5-.9-9-2.5z"
          fill={`url(#${id}-body)`}
          stroke="#5c0c09"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M25 41c3 1 11 1 14 0l4 9c-2 5-6 7-11 7-6 0-10-3-12-8z"
          fill="#f4f1ea"
          opacity=".92"
        />
        <rect x="27" y="43" width="10" height="2.6" rx="1" fill="#24262e" />
        <rect x="27" y="48" width="10" height="2.6" rx="1" fill="#24262e" />
        <rect
          x="26.5"
          y="53"
          width="11"
          height="2.4"
          rx="1"
          fill={iconGradient(id, "silver")}
          stroke="#4b6682"
          strokeWidth=".6"
        />
        <path
          d="M30.6 10v44m1.4-44v44m1.4-44v44"
          stroke="#f5f0d8"
          strokeWidth=".45"
          opacity=".9"
        />
        <path
          d="M20.5 43c-1 3-1 7 1 10"
          fill="none"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity=".6"
        />
      </g>
    </>
  );
}
