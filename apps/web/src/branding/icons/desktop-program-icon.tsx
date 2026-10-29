import { memo } from "react";
import type { ProgramDefinition } from "../../desktop/contracts.js";
import { AccountPicture } from "../avatars/account-picture.js";
import { ProgramIcon } from "./program-icon.js";

/**
 * Draws a desktop program's icon wherever the shell names it: Account
 * Settings shows the account's current picture, as XP's Start menu shows the
 * user picture, and every other program its own artwork. One choice here
 * keeps the shortcut, Start, title bar, and taskbar in agreement. A
 * properties window shares the artwork of the program that opens it. Memoized
 * like `ProgramIcon`, because those places re-render on every window move.
 */
export const DesktopProgramIcon = memo(function DesktopProgramIcon({
  program,
  avatarId,
  size,
}: {
  program: ProgramDefinition["id"];
  avatarId: string;
  size: number;
}) {
  return program === "account" ? (
    <AccountPicture avatarId={avatarId} size={size} />
  ) : (
    <ProgramIcon
      program={
        program === "channel-properties"
          ? "channels"
          : program === "collection-properties"
            ? "collections"
            : program
      }
      size={size}
    />
  );
});
