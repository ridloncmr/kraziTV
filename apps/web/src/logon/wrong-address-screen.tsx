import type { WrongAddress } from "../http/contracts/auth.js";
import { LogonBackdrop } from "./logon-backdrop.js";

/**
 * Shown instead of setup or logon when the server would refuse this
 * address's writes, so the owner is never handed a form that can only fail.
 * It links to the public base URL, or, when that names the server's own
 * computer and this browser is elsewhere, asks for the setting instead,
 * since a link to another machine's loopback address goes nowhere.
 */
export function WrongAddressScreen({ advice }: { advice: WrongAddress }) {
  return (
    <LogonBackdrop label="Open kraziTV at its address">
      <section className="logon-panel">
        <h1>Open kraziTV at its own address</h1>
        <p>
          kraziTV only accepts changes from the address it is set up with, so
          you can&apos;t log on from this one.
        </p>
        {advice.kind === "open" ? (
          <p>
            <a href={advice.url}>Open {advice.url}</a>
          </p>
        ) : (
          <p>
            It is set up for the computer it runs on. To use it from this
            device, set <code>PUBLIC_BASE_URL</code> to{" "}
            <code>{window.location.origin}</code>, then restart kraziTV.
          </p>
        )}
        <p className="logon-panel-note">
          <code>PUBLIC_BASE_URL</code> goes in kraziTV&apos;s <code>.env</code>{" "}
          file, or in <code>-e</code> when it runs in Docker.
        </p>
      </section>
    </LogonBackdrop>
  );
}
