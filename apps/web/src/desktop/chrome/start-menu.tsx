import { useEffect, useRef } from "react";
import { ProgramIcon } from "../../branding/program-icon.js";
import type { ProgramId } from "../contracts.js";
import { programs } from "../programs.js";

/**
 * Start is complete navigation to real programs, plus Log Off, which ends
 * this browser's session. It has no pretend OS actions such as Turn Off.
 */
export function StartMenu({
  openProgram,
  logOff,
}: {
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
        <ProgramIcon program="logo" size={40} />
        <div>
          <strong>kraziTV</strong>
          <span>Broadcast administration</span>
        </div>
      </div>
      <div className="start-menu-programs">
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
                  <ProgramIcon program={program.id} size={34} />
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
        <button type="button" onClick={logOff}>
          Log Off
        </button>
      </div>
    </nav>
  );
}
