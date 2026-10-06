import { useEffect, useRef, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { PlexSetup } from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";

/** Uses backend-configured public URLs so Plex reaches the server even from a different host. */
export function PlexSetupApp({ visible }: { visible: boolean }) {
  const setup = useResource<PlexSetup>("/plex/setup", visible);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /** Clipboard failure leaves selectable URLs available for ordinary manual copying. */
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      if (mounted.current) setMessage("URL copied to clipboard.");
    } catch {
      if (mounted.current)
        setMessage(
          "Clipboard unavailable. Select the URL and copy it manually.",
        );
    }
  }
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <span>Plex Setup</span>
        <button onClick={setup.refresh}>Refresh</button>
      </div>
      <p className="program-intro">
        Bring your kraziTV channels into Plex Live TV.
      </p>
      <RequestFeedback
        loading={setup.loading}
        error={setup.error}
        message={message}
      />
      {setup.data && (
        <fieldset>
          <legend>Tuner connection</legend>
          {(
            [
              ["Tuner base URL", setup.data.tunerBaseUrl],
              ["XMLTV guide URL", setup.data.xmltvUrl],
            ] as const
          ).map(([label, value]) => (
            <div className="inline-form" key={label}>
              <label>
                {label}
                <input
                  readOnly
                  value={value}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <button
                onClick={() => {
                  void copy(value);
                }}
              >
                Copy {label}
              </button>
            </div>
          ))}
        </fieldset>
      )}
      <fieldset>
        <legend>Setup in Plex</legend>
        <ol className="setup-steps">
          <li>
            Create and enable a channel with a programming block in My Channels.
          </li>
          <li>
            In Plex server settings, open Live TV &amp; DVR and add a tuner
            manually using the tuner base URL above.
          </li>
          <li>
            Provide the XMLTV guide URL and map the kraziTV channels shown by
            Plex.
          </li>
          <li>Open Plex Live TV to tune a channel.</li>
        </ol>
        <p className="secondary">
          Plex must be able to reach these server-configured URLs. If they point
          at an unreachable address, update PUBLIC_BASE_URL on your kraziTV
          server.
        </p>
      </fieldset>
    </div>
  );
}
