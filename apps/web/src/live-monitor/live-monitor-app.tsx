import { ChannelObservation } from "../channel-observation/channel-observation.js";

/** Reports only health and current-state capabilities the backend actually exposes. */
export function LiveMonitorApp({
  visible,
  connection,
}: {
  visible: boolean;
  connection: string;
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
