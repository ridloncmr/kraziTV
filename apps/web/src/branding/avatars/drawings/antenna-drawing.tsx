import { iconGradient } from "../../icon-gradients.js";

/**
 * A rooftop TV antenna against its own pale sky, with a sun and a cloud. It
 * paints a full background over the frame's, as any drawing may. `id` names
 * the enclosing picture's `IconGradients` and prefixes this drawing's own.
 */
export function AntennaDrawing({ id }: { id: string }) {
  // The boom and its elements, shortest at the front, drawn twice: outline, then metal.
  const rods = `M14 20h38${[18, 26, 34, 42, 50]
    .map(
      (x, index) =>
        `M${x} ${20 - (10 - index * 1.6)}v${(10 - index * 1.6) * 2}`,
    )
    .join("")}`;
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sky`} x2="0" y2="1">
          <stop stopColor="#d9f1ff" />
          <stop offset="1" stopColor="#5aa9ec" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${id}-sky)`} />
      <circle cx="52" cy="10" r="6" fill={iconGradient(id, "gold")} />
      <path
        d="M44 44c-3 0-5-2-4-4 0-3 4-4 6-3 1-3 6-4 8-1 3-1 6 1 5 4 2 1 2 4-1 4z"
        fill="#fff"
        opacity=".9"
      />
      <path
        d="M0 50 64 40v24H0z"
        fill="#b5523b"
        stroke="#6e2a1c"
        strokeWidth="2"
      />
      <path
        d="M0 56 64 47M12 51l2 13m14-15 2 15m14-17 2 17m14-19 2 19"
        stroke="#6e2a1c"
        strokeWidth="1"
        opacity=".6"
      />
      <path d="M32 50V18" stroke="#2c3e55" strokeWidth="4.5" />
      <path d="M32 50V18" stroke="#dde9f5" strokeWidth="2" />
      <path
        d={rods}
        fill="none"
        stroke="#2c3e55"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d={rods}
        fill="none"
        stroke="#e9f3fb"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>
  );
}
