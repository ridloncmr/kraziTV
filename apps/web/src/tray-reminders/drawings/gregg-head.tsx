/**
 * Gregg at 16 px for the tray (spec 0006, The tray assistant): drawn on the
 * pixel grid, not scaled from the figure. Rabbit ears, the outlined beige
 * cabinet, a dark screen with the visor as a green band across its top, two
 * eye slits, a flat mouth, one dial, and the cigarette ending in an orange
 * ember past the screen's edge, which is what still reads as a TV with a
 * cigarette on the tray's blue. No smoke at this size; it would be a stray
 * pixel. Decorative: the tray icon's label names the balloon it opens.
 */
export function GreggHead({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      {/* Rabbit ears at 45 degrees, the one angle a 1 px line keeps crisp. */}
      <path
        d="M6.5 4.5 3.5 1M9.5 4.5 12.5 1"
        stroke="#4a3d2a"
        strokeLinecap="round"
      />
      {/* The cabinet on half-pixel bounds, so its 1 px outline is not blurred. */}
      <rect
        x="1.5"
        y="4.5"
        width="13"
        height="10"
        rx="1.5"
        fill="#ddc9a0"
        stroke="#4a3d2a"
      />
      {/* The screen, left of the dial, whole pixels so it stays a solid block. */}
      <rect x="3" y="6" width="8" height="7" fill="#2d3a37" />
      {/* The visor as a green band over the screen's top edge. */}
      <rect x="2.5" y="5.5" width="9" height="1.5" fill="#2f9e63" />
      {/* Two eye slits and a flat mouth: the face at this size. */}
      <rect x="4" y="8" width="2" height="1" fill="#d7dfd8" />
      <rect x="7" y="8" width="2" height="1" fill="#d7dfd8" />
      <path d="M5 10.5h3" stroke="#d7dfd8" />
      {/* One dial beside the screen keeps the portable's screen-left layout. */}
      <circle cx="12.75" cy="8" r=".9" fill="#4a3d2a" />
      {/* The cigarette, pale on the dark screen, with its ember past the bezel. */}
      <path
        d="M8 10.5 13.5 12.5"
        stroke="#f3efe3"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="13.9" cy="12.7" r="1" fill="#ff6a2b" />
      {/* The tie's blade below the cabinet. */}
      <rect x="5.5" y="13" width="1.5" height="3" fill="#a73a2e" />
    </svg>
  );
}
