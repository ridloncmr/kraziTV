import { memo } from "react";
import type { ProgramId } from "../desktop/contracts.js";
import { AccountPicture } from "./avatars/account-picture.js";
import { ProgramIcon } from "./program-icon.js";

/**
 * Draws a desktop program's icon wherever the shell names it: Account
 * Settings shows the account's current picture, as XP's Start menu shows the
 * user picture, and every other program its own artwork. One choice here
 * keeps the shortcut, Start, title bar, and taskbar in agreement. Memoized
 * like `ProgramIcon`, because those places re-render on every window move.
 */
export const DesktopProgramIcon = memo(function DesktopProgramIcon({
  program,
  avatarId,
  size,
}: {
  program: ProgramId;
  avatarId: string;
  size: number;
}) {
  return program === "account" ? (
    <AccountPicture avatarId={avatarId} size={size} />
  ) : (
    <ProgramIcon program={program} size={size} />
  );
});
