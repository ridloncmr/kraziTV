import { ChannelObservation } from "../channel-observation/channel-observation.js";
import type { ProgramId } from "../desktop/contracts.js";

/** Reports only health and current-state capabilities the backend actually exposes. */
export function LiveMonitorApp({
  visible,
  connection,
}: {
  visible: boolean;
  connection: string;
  /** Opens another program, such as My Channels when there is nothing to observe. */
  openProgram: (id: ProgramId) => void;
}) {
  return (
    <div className="program-page">
      <p className="info-strip" role="status">
        {connection}
      </p>
      <ChannelObservation visible={visible} />
    </div>
  );
}
