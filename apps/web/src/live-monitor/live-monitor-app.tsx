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
      <div className="program-toolbar">Live Monitor</div>
      <p className="info-strip" role="status">
        {connection}
      </p>
      <p className="program-intro">
        Inspect a channel's current and next media and server-reported playback
        offset.
      </p>
      <ChannelObservation visible={visible} />
    </div>
  );
}
