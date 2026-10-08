import { iconGradient } from "../../icon-gradients.js";

/**
 * A rubber duck bobbing on a blue pool, the default account picture. Drawn in
 * the program icons' language: gold shading, dark outlines, and a white
 * highlight. `id` names the `IconGradients` the enclosing picture defines.
 */
export function DuckDrawing({ id }: { id: string }) {
  const gold = iconGradient(id, "gold");
  return (
    <>
      <path
        d="M0 46q5-3 10 0t11 0 11 0 11 0 11 0 10 0v18H0z"
        fill="#2c79c9"
        opacity=".55"
      />
      <ellipse cx="33" cy="50" rx="21" ry="3.5" fill="#14375e" opacity=".3" />
      <path
        d="M14 40c0-7 6-10 13-9l12 1c5 0 8-3 11-8 4 2 6 7 5 13-1 8-8 14-20 14h-8c-8 0-13-4-13-11z"
        fill={gold}
        stroke="#a7661a"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M30 37c4-4 12-4 16 1-3 6-12 7-16 3z"
        fill={gold}
        stroke="#a7661a"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M33 38c3-2 7-2 10 0"
        fill="none"
        stroke="#fff8c8"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity=".8"
      />
      <circle
        cx="24"
        cy="22"
        r="10.5"
        fill={gold}
        stroke="#a7661a"
        strokeWidth="1.6"
      />
      <path
        d="M15.5 22.5c-3-1.6-7-.8-8.5 1.3 1.6 1.4 5 1.6 8.5.7z"
        fill="#ff8a3d"
        stroke="#b4501a"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M15.8 25c-2.6.8-5.4.7-7.4-.4 1.2 2.4 4.6 3.2 7.7 2.1z"
        fill="#e86a28"
        stroke="#b4501a"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="27.5" cy="25" r="2.2" fill="#ff8a3d" opacity=".35" />
      <circle cx="21" cy="19.5" r="2.3" fill="#1b2433" />
      <circle cx="21.8" cy="18.7" r=".85" fill="#fff" />
      <path
        d="M18 15c2-2.6 6-3.5 9-2.4"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity=".75"
      />
      <path
        d="M19 34c3-1.5 7-1.6 9-1.2"
        fill="none"
        stroke="#fff8c8"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity=".7"
      />
    </>
  );
}
