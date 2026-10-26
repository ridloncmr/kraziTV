import { ChannelObservation } from "../channel-observation/channel-observation.js";

/** Exposes published programming through the guide without adding browser scheduling policy. */
export function ProgramGuideApp({ visible }: { visible: boolean }) {
  return (
    <div className="program-page">
      <ChannelObservation visible={visible} guide />
    </div>
  );
}
