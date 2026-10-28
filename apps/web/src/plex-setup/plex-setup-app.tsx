import { useEffect, useRef, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type { PlexSetup } from "../http/contracts/plex.js";
import { useResource } from "../http/resources/use-resource.js";

/**
 * Uses backend-configured public URLs so Plex reaches the server even from a
 * different host. When the server names this computer only, it says so first
 * and gives the exact settings that fix it, ready to copy.
 */
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
  /** A labeled, read-only value with a button that copies it. */
  const copyRow = (label: string, value: string) => (
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
  );
  const localOnly = setup.data?.localOnlySettings ?? [];
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <button onClick={setup.refresh}>Refresh</button>
      </div>
      <RequestFeedback
        loading={setup.loading}
        error={setup.error}
        message={message}
      />
      {setup.data && localOnly.length > 0 && (
        <div className="inline-notice" role="alert">
          <strong>Only Plex on this computer can reach kraziTV.</strong>
          <p>
            Plex on another device, such as a TV or a separate Plex server,
            can&apos;t connect to these addresses. To fix it, add these settings
            to the environment kraziTV starts in, then restart kraziTV:
          </p>
          {localOnly.includes("PUBLIC_BASE_URL") &&
            (setup.data.suggestedPublicBaseUrl ? (
              copyRow(
                "Address setting",
                `PUBLIC_BASE_URL=${setup.data.suggestedPublicBaseUrl}`,
              )
            ) : (
              <p>
                <code>
                  PUBLIC_BASE_URL=http://&lt;this computer&apos;s network
                  address&gt;{portSuffix(setup.data.tunerBaseUrl)}
                </code>
              </p>
            ))}
          {localOnly.includes("HOST") &&
            copyRow("Listen setting", "HOST=0.0.0.0")}
          <p className="secondary">
            If Plex runs on this computer, you can leave these as they are.
          </p>
        </div>
      )}
      {setup.data && (
        <fieldset>
          <legend>Tuner connection</legend>
          {copyRow("Tuner base URL", setup.data.tunerBaseUrl)}
          {copyRow("XMLTV guide URL", setup.data.xmltvUrl)}
        </fieldset>
      )}
      <fieldset>
        <legend>Setup in Plex</legend>
        <ol className="setup-steps">
          <li>
            Create and enable a channel with a programming assignment in My
            Channels.
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
          Plex must be able to reach these addresses. If it can&apos;t, set
          kraziTV&apos;s <code>PUBLIC_BASE_URL</code> setting to an address it
          can, then restart kraziTV.
        </p>
      </fieldset>
    </div>
  );
}

/** The `:port` a suggested address keeps from the current one; a URL on its scheme's default port has none. */
function portSuffix(url: string): string {
  const { port } = new URL(url);
  return port === "" ? "" : `:${port}`;
}
