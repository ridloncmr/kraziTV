import { useEffect, useRef, type KeyboardEvent } from "react";
import { DesktopProgramIcon } from "../../branding/icons/desktop-program-icon.js";
import { ProgramIcon } from "../../branding/icons/program-icon.js";
import { SourceCodeLink } from "../../branding/attribution/source-code-link.js";
import type { ProgramId } from "../contracts.js";
import { programs } from "../programs.js";

/**
 * Start is complete navigation to real programs, plus Log Off, which ends
 * this browser's session, and a link to kraziTV's source code. It has no
 * pretend OS actions such as Turn Off. The arrow keys move through the
 * programs as XP's did: Up and Down along a column, Left and Right across.
 */
export function StartMenu({
  avatarId,
  openProgram,
  logOff,
}: {
  /** The account's picture, which the Account Settings entry draws. */
  avatarId: string;
  openProgram: (id: ProgramId) => void;
  logOff: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  /**
   * Moves focus with the arrow keys: Up and Down wrap within the focused
   * column, Left and Right keep the row in the next column, or its last
   * entry when that column is shorter. Other keys keep their meaning.
   */
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const focused = document.activeElement;
    const column = focused?.closest(".start-menu-programs > div");
    if (!column?.parentElement) return;
    const groups = [...column.parentElement.children];
    const buttons = (group: Element) => [
      ...group.querySelectorAll<HTMLButtonElement>("button"),
    ];
    const entries = buttons(column);
    const at = entries.indexOf(focused as HTMLButtonElement);
    const across = (step: number) => {
      const next = groups[groups.indexOf(column) + step];
      if (!next) return entries[at];
      const neighbours = buttons(next);
      return neighbours[Math.min(at, neighbours.length - 1)];
    };
    const next = {
      ArrowDown: () => entries[(at + 1) % entries.length],
      ArrowUp: () => entries[(at - 1 + entries.length) % entries.length],
      ArrowRight: () => across(1),
      ArrowLeft: () => across(-1),
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    next()?.focus();
  }
  return (
    <nav className="start-menu" id="start-menu" aria-label="Start programs">
      <div className="start-menu-header">
        <ProgramIcon program="logo" size={40} />
        <div>
          <strong>kraziTV</strong>
          <span>Broadcast administration</span>
        </div>
      </div>
      <div className="start-menu-programs" onKeyDown={navigate}>
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
