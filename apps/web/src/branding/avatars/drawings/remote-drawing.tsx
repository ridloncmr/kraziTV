import { iconGradient } from "../../icon-gradients.js";

// The four color keys along the remote's foot, left to right.
const COLOR_KEYS = ["#e2442f", "#4fb34a", "#f2c534", "#3b82e0"];

/**
 * A chunky remote control tilted across the tile: red power key, a
 * direction pad, number keys, and the four color keys. `id` names the
 * enclosing picture's `IconGradients`.
 */
export function RemoteDrawing({ id }: { id: string }) {
  return (
    <>
      <ellipse cx="34" cy="57" rx="18" ry="3.5" fill="#14375e" opacity=".3" />
      <g transform="rotate(-24 32 33)">
        <rect
          x="21"
          y="5"
          width="22"
          height="54"
          rx="10"
          fill={iconGradient(id, "silver")}
          stroke="#2c3e55"
          strokeWidth="2"
        />
        <path
          d="M24.5 14c0-4 2-6 5-6.5"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="32" cy="13.5" r="3.6" fill="#e2442f" stroke="#8c2416" />
        <circle cx="32" cy="27" r="7" fill="#4b6682" stroke="#2c3e55" />
        <path
          d="M32 21.5v3m0 5v3m-5.5-5.5h3m5 0h3"
          stroke="#e6f0fa"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="32" cy="27" r="2.2" fill={iconGradient(id, "silver")} />
        {[0, 1, 2].map((row) =>
          [0, 1, 2].map((column) => (
            <rect
              key={`${row}-${column}`}
              x={25.5 + column * 5}
              y={37 + row * 4.4}
              width="3.4"
              height="2.8"
              rx="1"
              fill="#2c3e55"
            />
          )),
        )}
        {COLOR_KEYS.map((color, index) => (
          <rect
            key={color}
            x={24.6 + index * 3.9}
            y="51.5"
            width="3"
            height="2.6"
            rx="1"
            fill={color}
          />
        ))}
      </g>
    </>
  );
}
