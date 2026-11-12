/**
 * Gregg at 48 px for the balloon (spec 0006, The tray assistant): a squat
 * 1950s set in heavy ink, with thick dark outlines, a barrel-curved screen,
 * two knobs, rabbit ears, and splayed legs. His visor is a cap-like brim that
 * crests the top of the body; the eyes are heavy-lidded light shapes on dark
 * glass, the mouth is flat, and the loosened tie hangs over the body's bottom
 * edge. The cigarette's smoke wisp is `.gregg-smoke`, drawn last so it rises
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
      <path
        d="M21 13 12 2M27 13l9-11"
        stroke="#26201a"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M11 41l-2.5 6M37 41l2.5 6"
        stroke="#26201a"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect
        x="3"
        y="12"
        width="42"
        height="29"
        rx="4"
        fill="#e1cfa5"
        stroke="#26201a"
        strokeWidth="2.5"
      />
      <path
        d="M8 17Q22 14.5 36 17Q38 27 36 36Q22 38.5 8 36Q6 27 8 17z"
        fill="#243030"
        stroke="#26201a"
        strokeWidth="2"
      />
      <circle
        cx="41.5"
        cy="22"
        r="2.2"
        fill="#c9b283"
        stroke="#26201a"
        strokeWidth="1.5"
      />
      <circle
        cx="41.5"
        cy="31"
        r="2.2"
        fill="#c9b283"
        stroke="#26201a"
        strokeWidth="1.5"
      />
      <path
        d="M5 16.5Q22 8.5 39 16.5L37 20.5Q22 14 7 20.5Z"
        fill="#2e9d62"
        stroke="#26201a"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M13 26.5a3.5 2.5 0 0 0 7 0z" fill="#d9e1d7" />
      <path d="M24 26.5a3.5 2.5 0 0 0 7 0z" fill="#d9e1d7" />
      <path
        d="M12.5 26.5h8M23.5 26.5h8"
        stroke="#d9e1d7"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="16.8" cy="27.6" r="1.1" fill="#243030" />
      <circle cx="27.8" cy="27.6" r="1.1" fill="#243030" />
      <path
        d="M15 32.5h8.5"
        stroke="#d9e1d7"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M23.5 32.5 32 35.5"
        stroke="#26201a"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M23.5 32.5 32 35.5"
        stroke="#f3efe4"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M24.8 33l1.8.6" stroke="#cfa868" strokeWidth="2.2" />
      <circle cx="32.4" cy="35.7" r="1.5" fill="#ff6a2b" stroke="#26201a" />
      <path
        d="M11 36q3.5 2.5 5.8.8M21.5 35.6q3.5 2.5 7 .4"
        stroke="#26201a"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M16.5 36.5l5-.5.4 3-4.5.7z"
        fill="#b23a2f"
        stroke="#26201a"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M17.4 39.7l4.5-.7 1.3 5.6-2.2 2.4-2.6-2.2z"
        fill="#b23a2f"
        stroke="#26201a"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        className="gregg-smoke"
        d="M33.4 33.6c2.2-1.5-1.6-3.3.3-5.3s2-2.9.2-4.9"
        fill="none"
        stroke="#c3cbc4"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
