import { useId, type ComponentType } from "react";
import { IconGradients, iconGradient } from "../icon-gradients.js";
import { AntennaDrawing } from "./drawings/antenna-drawing.js";
import { ChessDrawing } from "./drawings/chess-drawing.js";
import { CrtTvDrawing } from "./drawings/crt-tv-drawing.js";
import { DuckDrawing } from "./drawings/duck-drawing.js";
import { FilmReelDrawing } from "./drawings/film-reel-drawing.js";
import { GuitarDrawing } from "./drawings/guitar-drawing.js";
import { PopcornDrawing } from "./drawings/popcorn-drawing.js";
import { RemoteDrawing } from "./drawings/remote-drawing.js";

/**
 * Every built-in drawing in picker order. The web app owns this list (spec
 * 0002); `duck` comes first because it is the server's default.
 */
const DRAWINGS: [string, ComponentType<{ id: string }>][] = [
  ["duck", DuckDrawing],
  ["crt-tv", CrtTvDrawing],
  ["antenna", AntennaDrawing],
  ["remote", RemoteDrawing],
  ["film-reel", FilmReelDrawing],
  ["popcorn", PopcornDrawing],
  ["guitar", GuitarDrawing],
  ["chess", ChessDrawing],
];

/** The built-in avatar IDs in order, for the Account Settings picker. */
export const AVATAR_IDS = DRAWINGS.map(([avatarId]) => avatarId);

/**
 * Draws an account's picture as an XP-style user picture: a rounded square
 * with a white border around one built-in drawing on a blue tile, which a
 * drawing may paint over with its own background. An ID with no drawing
 * shows `duck`, so a newer server never breaks the logon screen.
 * Decorative, because the display name beside it already names the account.
 */
export function AccountPicture({
  avatarId,
  size = 48,
}: {
  avatarId: string;
  size?: number;
}) {
  const id = useId();
  const [drawn, Drawing] =
    DRAWINGS.find(([known]) => known === avatarId) ?? DRAWINGS[0];
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
      <g clipPath={`url(#${id}-tile)`} data-avatar={drawn}>
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
