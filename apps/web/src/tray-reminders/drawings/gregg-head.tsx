/**
 * Gregg at 16 px for the tray (spec 0006, The tray assistant): the same
 * heavy ink at 1.5 px on a squat outlined box with two leg stubs, rabbit
 * ears, a rounded dark screen, the visor as a green arc over the top bezel,
 * two eye slits, a flat mouth, and an outlined cigarette whose orange ember
 * pokes past the body, so he still reads as a TV with a cigarette on the
 * tray's blue. No smoke at this size; it would be a stray pixel. Decorative:
 * the tray icon's label names the balloon it opens.
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
      <path
        d="M6.5 4.5 3.5 1M9.5 4.5 12.5 1"
        stroke="#26201a"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M4 14.5 3 16M12 14.5l1 1.5"
        stroke="#26201a"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="1.5"
        y="4.5"
        width="13"
        height="10"
        rx="2"
        fill="#e1cfa5"
        stroke="#26201a"
        strokeWidth="1.5"
      />
      <rect x="3.5" y="6.5" width="7.5" height="6" rx="2" fill="#243030" />
      <path
        d="M2.5 6.5Q7.5 4.5 12.5 6.5"
        stroke="#2e9d62"
        strokeWidth="2"
        fill="none"
      />
      <rect x="4.5" y="8.5" width="2" height="1" fill="#d9e1d7" />
      <rect x="8" y="8.5" width="2" height="1" fill="#d9e1d7" />
      <path d="M5.5 11h3" stroke="#d9e1d7" strokeWidth="1.2" />
      <circle cx="12.75" cy="9" r=".9" fill="#26201a" />
      <path
        d="M8.5 11 13.5 13"
        stroke="#26201a"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M8.5 11 13.5 13"
        stroke="#f3efe4"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="13.9" cy="13.2" r="1.1" fill="#ff6a2b" />
      <rect x="5.5" y="12.5" width="1.6" height="3.5" fill="#b23a2f" />
    </svg>
  );
}
