/**
 * An ebony chess knight standing on a checkerboard. Paints its own board
 * over the frame's background, and defines its own gradients under `id`.
 */
export function ChessDrawing({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-ebony`} x2=".35" y2="1">
          <stop stopColor="#7b8698" />
          <stop offset=".45" stopColor="#3a4352" />
          <stop offset="1" stopColor="#151a23" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill="#efe1bd" />
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3].map((column) =>
          (row + column) % 2 === 1 ? (
            <rect
              key={`${row}-${column}`}
              x={column * 16}
              y={row * 16}
              width="16"
              height="16"
              fill="#7aa25a"
            />
          ) : null,
        ),
      )}
      <rect width="64" height="64" fill="#0b2a63" opacity=".12" />
      <ellipse cx="33" cy="57" rx="17" ry="3.5" fill="#14260e" opacity=".35" />
      <path
        d="M17 57.5c0-3 2-5 5-5h22c3 0 5 2 5 5z"
        fill={`url(#${id}-ebony)`}
        stroke="#0b0e14"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M21 52.5h24l-1.5-4h-21z"
        fill={`url(#${id}-ebony)`}
        stroke="#0b0e14"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M23.5 48.5c0-6 3-10 7-14-4 0-7.5 1.6-10 0-2.2-1.4-2.4-4-1-6l8-9.5c1-3.5 3-6.5 5.5-8.5l.8-4.5 3.4 4.2c7.5 2 12.3 9.5 12.3 19 0 8-2.4 14.3-4.5 19.3z"
        fill={`url(#${id}-ebony)`}
        stroke="#0b0e14"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M41.5 17c3.5 3 5 8 5 14m-1.5 8c-.7 3-1.6 6-2.7 9"
        fill="none"
        stroke="#0b0e14"
        strokeWidth="1.2"
        strokeDasharray="2.4 1.6"
      />
      <circle cx="31" cy="21.5" r="1.7" fill="#f2f4f8" />
      <path
        d="M21.5 27.5h2"
        stroke="#9aa6b8"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M28.5 15.5c2-3 4.5-5 7-6"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity=".7"
      />
      <path
        d="M26 46c.5-4 2.5-7.5 5-10.5"
        fill="none"
        stroke="#fff"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity=".45"
      />
    </>
  );
}
