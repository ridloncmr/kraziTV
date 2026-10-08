import { useId, type ComponentType } from "react";
import { IconGradients, iconGradient } from "../icon-gradients.js";
import { DuckDrawing } from "./duck-drawing.js";

/**
 * Every built-in drawing by avatar ID. The web app owns this list; spec 0003
 * adds the rest, and `duck` stays the server's default.
 */
const drawings: Record<string, ComponentType<{ id: string }>> = {
  duck: DuckDrawing,
};

/**
 * Draws an account's picture as an XP-style account tile: a rounded square with
 * a white border around one built-in drawing. An ID with no drawing shows
 * `duck`, so a newer server never breaks the logon screen. Decorative,
 * because the display name beside it already names the account.
 */
export function AccountPicture({
  avatarId,
  size = 48,
}: {
  avatarId: string;
  size?: number;
}) {
  const id = useId();
  const Drawing = drawings[avatarId] ?? DuckDrawing;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="account-picture"
    >
      <IconGradients id={id} />
      <clipPath id={`${id}-tile`}>
        <rect x="3" y="3" width="58" height="58" rx="7" />
      </clipPath>
      <rect
        x="4"
        y="5"
        width="58"
        height="58"
        rx="7"
        fill="#0b2a63"
        opacity=".35"
      />
      <g clipPath={`url(#${id}-tile)`}>
        <rect width="64" height="64" fill={iconGradient(id, "blue")} />
        <path d="M0 0h64v22C44 30 20 30 0 24z" fill="#fff" opacity=".22" />
        <Drawing id={id} />
      </g>
      <rect
        x="3"
        y="3"
        width="58"
        height="58"
        rx="7"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
      />
    </svg>
  );
}
