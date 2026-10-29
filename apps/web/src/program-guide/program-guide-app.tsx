import { GuideGrid } from "./grid/guide-grid.js";

/** The guide fills its window with the grid, which draws server programming without adding browser scheduling policy. */
export function ProgramGuideApp({
  visible,
  onWatch,
}: {
  visible: boolean;
  /** Opens TV on a channel, as choosing a channel in a TV guide tunes it. */
  onWatch: (channelId: string) => void;
}) {
  return (
    <div className="program-page guide-page">
      <GuideGrid visible={visible} onWatch={onWatch} />
    </div>
  );
}
