import { GuideGrid } from "./guide-grid.js";

/** The guide fills its window with the grid, which draws server programming without adding browser scheduling policy. */
export function ProgramGuideApp({ visible }: { visible: boolean }) {
  return (
    <div className="program-page guide-page">
      <GuideGrid visible={visible} />
    </div>
  );
}
