import { iconGradient } from "../../icon-gradients.js";

/**
 * A silver film reel with its strip unspooling off the right edge. `id`
 * names the enclosing picture's `IconGradients`.
 */
export function FilmReelDrawing({ id }: { id: string }) {
  return (
    <>
      <ellipse cx="30" cy="56" rx="20" ry="3.5" fill="#14375e" opacity=".3" />
      <path
        d="M40 42c6 7 13 9 24 6v10c-12 3-22-1-29-10z"
        fill="#2b2f36"
        stroke="#14171c"
        strokeWidth="1.2"
      />
      {[0, 1, 2, 3, 4].map((step) => (
        <rect
          key={step}
          x={42 + step * 4.6}
          y={46.6 + Math.sin(step / 1.4) * 1.2}
          width="2.2"
          height="1.8"
          rx=".4"
          fill="#e8e2c8"
        />
      ))}
      <circle
        cx="29"
        cy="30"
        r="21"
        fill={iconGradient(id, "silver")}
        stroke="#2c3e55"
        strokeWidth="2"
      />
      <circle cx="29" cy="30" r="17.5" fill="none" stroke="#fff" opacity=".6" />
      {[0, 1, 2, 3, 4].map((step) => {
        const angle = (step * 2 * Math.PI) / 5 - Math.PI / 2;
        return (
          <circle
            key={step}
            cx={29 + Math.cos(angle) * 10.5}
            cy={30 + Math.sin(angle) * 10.5}
            r="5"
            fill="#1d3550"
            stroke="#2c3e55"
          />
        );
      })}
      <circle cx="29" cy="30" r="4" fill="#6886a7" stroke="#2c3e55" />
      <circle cx="29" cy="30" r="1.4" fill="#1d3550" />
      <path
        d="M14 22c3-6 9-10 15-10"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".8"
      />
    </>
  );
}
