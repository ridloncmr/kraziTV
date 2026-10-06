import { useEffect, useRef } from "react";
import { ProgramIcon } from "../../branding/program-icon.js";
import type { ProgramId } from "../contracts.js";
import { programs } from "../programs.js";

/** Start is complete navigation to real programs, with no pretend OS or authentication actions. */
export function StartMenu({
  openProgram,
}: {
  openProgram: (id: ProgramId) => void;
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
        Local media. Your channels. Always on schedule.
      </div>
    </nav>
  );
}
