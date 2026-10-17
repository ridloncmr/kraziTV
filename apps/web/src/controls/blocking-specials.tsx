import { ApiError } from "../http/api-error.js";
import { displayTime } from "./display-time.js";

/**
 * Names the specials that refuse a delete, each by its channel and start,
 * and opens My Channels, where the owner edits or cancels them first
 * (programming spec 0007). Shows nothing for a refusal no special causes.
 */
export function BlockingSpecials({
  error,
  channelNumber,
  onOpenChannels,
}: {
  error: Error | undefined;
  channelNumber: (channelId: string) => string;
  onOpenChannels?: () => void;
}) {
  const listed =
    error instanceof ApiError && Array.isArray(error.details.reservations)
      ? (error.details.reservations as {
          id: string;
          channelId: string;
          startsAt: string;
        }[])
      : [];
  if (listed.length === 0) return null;
  return (
    <section aria-label="Blocking specials">
      <p>
        Edit or cancel these specials first in My Channels, or end one that is
        already on air early:
      </p>
      <ul>
        {listed.map((special) => (
          <li key={special.id}>
            Channel {channelNumber(special.channelId)} · special at{" "}
            {displayTime(special.startsAt)}
          </li>
        ))}
      </ul>
      {onOpenChannels && (
        <button type="button" onClick={onOpenChannels}>
          Open My Channels
        </button>
      )}
    </section>
  );
}
