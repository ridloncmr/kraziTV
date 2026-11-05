import { useEffect, useRef } from "react";
import { AccountPicture } from "../../branding/avatars/account-picture.js";
import { DesktopProgramIcon } from "../../branding/icons/desktop-program-icon.js";
import { SourceCodeLink } from "../../branding/attribution/source-code-link.js";
import { navigateWithArrows } from "../arrow-navigation.js";
import type { ProgramId } from "../contracts.js";
import { programs } from "../programs.js";

/**
 * Start is complete navigation to real programs, plus Log Off, which ends
 * this browser's session, and a link to kraziTV's source code. It opens on
 * the account's picture and name, as XP's did. It has no pretend OS actions
 * such as Turn Off. The arrow keys move through the programs as XP's did: Up,
 * Down, Home, and End along a column, Left and Right across.
 */
export function StartMenu({
  avatarId,
  displayName,
  openProgram,
  logOff,
}: {
  /** The account's picture, which the header and the Account Settings entry draw. */
  avatarId: string;
  /** The account's name, which the header shows beside its picture. */
  displayName: string;
  openProgram: (id: ProgramId) => void;
  logOff: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  return (
    <nav className="start-menu" id="start-menu" aria-label="Start programs">
      <div className="start-menu-header">
        <AccountPicture avatarId={avatarId} size={40} />
        <div>
          <strong>{displayName}</strong>
          <span>Broadcast administration</span>
        </div>
      </div>
      <div
        className="start-menu-programs"
        onKeyDown={(event) =>
          navigateWithArrows(event, [...event.currentTarget.children])
        }
      >
        {(["Primary", "Server"] as const).map((group) => (
          <div key={group}>
            <h2>
              {group === "Primary" ? "Your television network" : "Server tools"}
            </h2>
            {programs
              .filter((program) => program.group === group)
              .map((program) => (
                <button
                  key={program.id}
                  ref={program.id === "channels" ? first : undefined}
                  onClick={() => openProgram(program.id)}
                >
                  <DesktopProgramIcon
                    program={program.id}
                    avatarId={avatarId}
                    size={34}
                  />
                  <span>
                    <strong>{program.name}</strong>
                    <small>{program.description}</small>
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="start-menu-footer">
        <span>Local media. Your channels. Always on schedule.</span>
        <SourceCodeLink className="start-menu-source" />
        <button type="button" onClick={logOff}>
          Log Off
        </button>
      </div>
    </nav>
  );
}
