/**
 * Gregg at 48 px for the balloon (spec 0006, The tray assistant): a boxy
 * outlined CRT in the manner of a 1970s portable, screen on the left and two
 * dials on the right, his face light on dark glass. The visor is a green brim
 * over the top bezel; the tie hangs loose from the bottom bezel between the
 * feet. The cigarette's smoke wisp is `.gregg-smoke`, drawn last so it rises
 * over the glass, and animated by `tray-reminders.css` alone. The drawing is
 * decorative: the balloon names him in text.
 */
export function GreggFigure({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      width="48"
      height="48"
      aria-hidden="true"
    >
      {/* Rabbit ears, with ball tips so they read as antennas, not cracks. */}
      <path
        d="M20 10.5 11 1.5M26 10.5l9-9"
        stroke="#4a3d2a"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="11" cy="1.5" r="1.3" fill="#8c8f94" stroke="#4a3d2a" />
      <circle cx="35" cy="1.5" r="1.3" fill="#8c8f94" stroke="#4a3d2a" />
      {/* Two feet under the body, behind it, so it sits rather than floats. */}
      <rect x="8.5" y="39" width="6" height="4" rx="1" fill="#4a3d2a" />
      <rect x="33.5" y="39" width="6" height="4" rx="1" fill="#4a3d2a" />
      {/* The beige cabinet; its outline sets the drawing's line weight. */}
      <rect
        x="4"
        y="10"
        width="40"
        height="30"
        rx="4"
        fill="#ddc9a0"
        stroke="#4a3d2a"
        strokeWidth="1.5"
      />
      {/* A darker base band, the speaker grille strip of a portable. */}
      <path d="M5 33h38v3a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="#c4ad7e" />
      {/* The screen, left of the dials, dark so his light face shows on it. */}
      <rect
        x="8"
        y="14"
        width="25"
        height="20"
        rx="3"
        fill="#2d3a37"
        stroke="#4a3d2a"
      />
      {/* One faint glass highlight in the top corner, so the screen curves. */}
      <path
        d="M10.5 17.5q2-2 5-2"
        stroke="#fff"
        strokeOpacity=".18"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Two dials with pointer marks: channel above, volume below. */}
      <circle cx="38.8" cy="20" r="2.6" fill="#bda77a" stroke="#4a3d2a" />
      <path d="M38.8 18v2" stroke="#4a3d2a" />
      <circle cx="38.8" cy="28" r="2.6" fill="#bda77a" stroke="#4a3d2a" />
      <path d="M38.8 26v2" stroke="#4a3d2a" />
      {/* The green eyeshade, a translucent brim across the top of the screen. */}
      <path
        d="M6.5 17.5C12 12.5 29 12.5 34.5 17.5V19.5C29 15 12 15 6.5 19.5Z"
        fill="#2f9e63"
        fillOpacity=".92"
        stroke="#1b5e3a"
        strokeLinejoin="round"
      />
      {/* Half-lidded eyes: the lower half of each eye shows, with a pupil. */}
      <path d="M13 24.5a3 2.2 0 0 0 6 0z" fill="#d7dfd8" />
      <path d="M22 24.5a3 2.2 0 0 0 6 0z" fill="#d7dfd8" />
      <circle cx="16.3" cy="25.2" r="1" fill="#2d3a37" />
      <circle cx="25.3" cy="25.2" r="1" fill="#2d3a37" />
      {/* The lids, a flat grey line across each eye, which makes them tired. */}
      <path
        d="M12.5 24.5h7M21.5 24.5h7"
        stroke="#8e9a93"
        strokeLinecap="round"
      />
      {/* Bags under the eyes, fainter than the lids. */}
      <path
        d="M14 28q2 .9 4 0M23 28q2 .9 4 0"
        stroke="#59665f"
        strokeWidth=".9"
        strokeLinecap="round"
        fill="none"
      />
      {/* A flat mouth, as the spec has it: never a smile, never a frown. */}
      <path
        d="M15.5 30.5h7.5"
        stroke="#d7dfd8"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* The cigarette from the mouth's corner: paper, tan filter, orange ember. */}
      <path
        d="M23 30.5 30.5 33.3"
        stroke="#f3efe3"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M24.4 31l1.3.5" stroke="#c9a46a" strokeWidth="1.8" />
      <circle cx="30.8" cy="33.4" r="1.1" fill="#ff6a2b" />
      {/* Chin creases on the base band, so the tie hangs from a jaw line. */}
      <path
        d="M12.5 34.5q3.5 2.5 6 2.6M20 37q3.5-1 6.5-2.6"
        stroke="#4a3d2a"
        fill="none"
        strokeLinecap="round"
      />
      {/* The loosened tie: knot on the bezel, blade past the cabinet's edge. */}
      <path
        d="M17 36l4-.4.4 2.6-3.6.6z"
        fill="#a73a2e"
        stroke="#4a3d2a"
        strokeLinejoin="round"
      />
      <path
        d="M17.6 38.6l3.6-.6 1 6.4-1.9 2.4-2.3-2z"
        fill="#a73a2e"
        stroke="#4a3d2a"
        strokeLinejoin="round"
      />
      {/* The smoke, last and in a light grey, so it reads on the dark glass. */}
      <path
        className="gregg-smoke"
        d="M31.5 31.5c1.6-1.4-1.4-2.8.2-4.4s1.5-2.2 0-3.6"
        fill="none"
        stroke="#c3cbc4"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
