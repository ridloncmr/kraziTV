// Popped kernels heaped above the rim, back row first: [cx, cy, r].
const KERNELS: [cx: number, cy: number, r: number][] = [
  [19, 25, 5],
  [27, 20, 5.5],
  [35, 18, 6],
  [43, 21, 5.5],
  [48, 26, 4.5],
  [23, 28, 4.5],
  [31, 26, 5],
  [40, 27, 5],
];

// Each red stripe's start and width as fractions across the bucket.
const STRIPES: [start: number, width: number][] = [
  [0.06, 0.14],
  [0.32, 0.14],
  [0.58, 0.14],
  [0.84, 0.12],
];

/**
 * A red-and-white striped popcorn bucket heaped with kernels. The stripes
 * follow the bucket's taper. Uses no shared gradient, so it takes no id.
 */
export function PopcornDrawing() {
  // The bucket's top spans x 15–49 at y 31 and narrows to 21–43 at y 58.
  const stripe = ([start, width]: [number, number]) => {
    const top = (fraction: number) => 15 + 34 * fraction;
    const bottom = (fraction: number) => 21 + 22 * fraction;
    const end = start + width;
    return `M${top(start)} 31H${top(end)}L${bottom(end)} 58H${bottom(start)}z`;
  };
  return (
    <>
      <ellipse cx="32" cy="59" rx="16" ry="3" fill="#14375e" opacity=".3" />
      {KERNELS.map(([cx, cy, r]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={r} fill="#fff6dc" stroke="#b98d3c" />
          <circle
            cx={cx + r * 0.25}
            cy={cy + r * 0.3}
            r={r * 0.45}
            fill="#f5cf6a"
            opacity=".7"
          />
        </g>
      ))}
      <path d="M15 31h34l-6 27H21z" fill="#fff" />
      {STRIPES.map((fractions) => (
        <path key={fractions[0]} d={stripe(fractions)} fill="#e2402d" />
      ))}
      <path
        d="M15 31h34l-6 27H21z"
        fill="none"
        stroke="#7c1d14"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect
        x="13"
        y="28.5"
        width="38"
        height="5"
        rx="2"
        fill="#fff"
        stroke="#7c1d14"
        strokeWidth="1.6"
      />
      <path
        d="M19 37l2.5 17"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".7"
      />
    </>
  );
}
