import { ChannelObservation } from "../channel-observation/channel-observation.js";

/** Exposes published programming through the guide without adding browser scheduling policy. */
export function ProgramGuideApp({ visible }: { visible: boolean }) {
  return (
    <div className="program-page">
      <div className="program-toolbar">Program Guide</div>
      <p className="program-intro">
        Upcoming programming and current channel state, as reported by kraziTV.
      </p>
      <ChannelObservation visible={visible} guide />
    </div>
  );
}
