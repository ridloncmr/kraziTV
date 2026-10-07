import { useEffect, useState } from "react";
import { displayClockTime } from "../../controls/display-time.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { ApiError } from "../../http/api-error.js";
import type {
  CatalogRemoval,
  CatalogRemovalImpact,
  Channel,
} from "../../http/contracts.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import {
  isRefusal,
  offAirLine,
  refusalMessage,
  removalFeedback,
  subjectSummary,
  toTarget,
  type RemovalSubject,
} from "./removal-messages.js";

type Airing = "finish" | "interrupt";

/**
 * Confirms a catalog removal against the server's preview. The airing choice
 * is transient; the server's responses decide every outcome. A refusal
 * replaces the preview and leaves only Close; a removal whose impact changed
 * since the preview shows the new impact and asks again.
 */
export function RemoveMediaDialog({
  subject,
  removed,
  onClose,
}: {
  subject: RemovalSubject;
  /** Called with the feedback line once the server committed the removal. */
  removed: (feedback: string) => void;
  onClose: () => void;
}) {
  // Built once, so the preview's POST body keeps its identity across renders.
  const [previewBody] = useState(() => ({ target: toTarget(subject) }));
  const preview = useResource<CatalogRemovalImpact>(
    "/catalog-removals/preview",
    true,
    0,
    previewBody,
  );
  const mutation = useMutation();
  const [airing, setAiring] = useState<Airing>("finish");
  // The impact the server returned with a refusal for missing consent; it
  // replaces the preview, so the user confirms what is true now.
  const [changed, setChanged] = useState<CatalogRemovalImpact>();
  useEffect(() => {
    const error = mutation.error;
    if (
      error instanceof ApiError &&
      error.code === "channels_left_unschedulable"
    ) {
      setChanged(error.details.impact as CatalogRemovalImpact);
    }
  }, [mutation.error]);

  const failure = isRefusal(mutation.error) ? mutation.error : preview.error;
  const inUse =
    failure instanceof ApiError && failure.code === "media_item_in_use";
  const channels = useResource<Channel[]>(inUse ? "/channels" : null);
  const impact = changed ?? preview.data;
  const title = subject.kind === "root" ? "Remove media root" : "Remove media";

  if (failure) {
    const numberOf = (id: string) =>
      channels.data?.find((channel) => channel.id === id)?.number ?? id;
    const waiting = inUse && channels.loading && !channels.data;
    return (
      <WindowDialog title={title} onClose={onClose}>
        {waiting ? (
          <p role="status">Checking…</p>
        ) : (
          <p role="alert" className="error-message">
            {refusalMessage(failure, numberOf) ?? failure.message}
          </p>
        )}
        <div className="dialog-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </WindowDialog>
    );
  }
  if (!impact) {
    return (
      <WindowDialog title={title} onClose={onClose}>
        <p role="status">Checking…</p>
      </WindowDialog>
    );
  }

  const airingIds = new Set(impact.airing.map((entry) => entry.channelId));
  const anyway = impact.channelsLeftUnschedulable.length > 0;
  return (
    <WindowDialog title={title} busy={mutation.pending} onClose={onClose}>
      <p>{subjectSummary(subject, impact.itemCount)}</p>
      <ul>
        <li>Files on disk are not touched.</li>
        <li>Collections lose these items.</li>
        {subject.kind === "items" && (
          <li>
            Items whose files still exist return on the next scan of their root.
          </li>
        )}
      </ul>
      {impact.airing.length > 0 && (
        <fieldset disabled={mutation.pending}>
          <legend>Now airing</legend>
          <ul>
            {impact.airing.map((entry) => (
              <li key={entry.channelId}>
                {`${entry.channelNumber}: ${entry.title}, until ${displayClockTime(entry.endsAt)}`}
              </li>
            ))}
          </ul>
          <AiringChoice
            value="finish"
            current={airing}
            onChange={setAiring}
            label="Let it finish"
            effect="The program plays to its scheduled end. The channel's schedule changes after it."
          />
          <AiringChoice
            value="interrupt"
            current={airing}
            onChange={setAiring}
            label="Stop it now and rebuild the schedule"
            effect="The channel's schedule is rebuilt from now. Anyone watching these channels is disconnected and must tune in again to see the new program."
          />
        </fieldset>
      )}
      {anyway && (
        <section>
          <h3>Channels left with nothing to play</h3>
          <ul>
            {impact.channelsLeftUnschedulable.map((channel) => (
              <li key={channel.channelId}>
                {offAirLine(
                  channel.channelNumber,
                  airing === "interrupt" && airingIds.has(channel.channelId),
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <RequestFeedback
        loading={mutation.pending}
        error={changed ? undefined : mutation.error}
        message={
          changed && !mutation.pending
            ? "What this removal does has changed. Review it and confirm again."
            : undefined
        }
      />
      <div className="dialog-actions">
        <button
          disabled={mutation.pending}
          onClick={() => {
            void mutation.run<CatalogRemoval>(
              "/catalog-removals",
              "POST",
              {
                target: previewBody.target,
                airing,
                allowUnschedulable: anyway,
              },
              (result) => removed(removalFeedback(subject, result, impact)),
            );
          }}
        >
          {anyway ? "Remove anyway" : "Remove"}
        </button>
        <button disabled={mutation.pending} onClick={onClose}>
          Cancel
        </button>
      </div>
    </WindowDialog>
  );
}

/** One airing option, with its effect spelled out beneath the label. */
function AiringChoice({
  value,
  current,
  onChange,
  label,
  effect,
}: {
  value: Airing;
  current: Airing;
  onChange: (value: Airing) => void;
  label: string;
  effect: string;
}) {
  return (
    <label>
      <input
        type="radio"
        name="airing"
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
      />
      <strong>{label}</strong>
      <small className="secondary">{effect}</small>
    </label>
  );
}
