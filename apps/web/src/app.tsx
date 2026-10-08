import { useCallback, useEffect, useState } from "react";
import { BootScreen } from "./desktop/chrome/boot-screen.js";
import { DesktopShell } from "./desktop/desktop-shell.js";
import { onUnauthorized } from "./http/api-client.js";
import type { AccountProfile, AuthState } from "./http/contracts.js";
import { useResource } from "./http/use-resource.js";
import { LogonScreen } from "./logon/logon-screen.js";
import { SetupScreen } from "./logon/setup-screen.js";

// Long enough that the boot screen reads as a deliberate step, not a flicker.
const MINIMUM_BOOT_MS = 650;
// How often the boot screen asks again while the server is unreachable.
const RETRY_INTERVAL_MS = 10_000;

/**
 * The app root: chooses among the boot screen, setup, the logon screen, and
 * the desktop shell from the server's latest auth state. Only the server
 * says whether the browser is logged in, so the desktop never opens without
 * an answer. A later answer, such as a login's, replaces the state; clearing
 * it re-reads `GET /auth/state`, because the boot read mounts afresh and can
 * never answer with an earlier result.
 *
 * A `401` matters only while the desktop shell is showing: the listener is
 * registered only then, and it clears only an authenticated state, so the
 * first `401` unmounts the desktop and starts one re-read, and every later
 * one (from other programs, or late from the closed desktop) changes nothing.
 * The logon and setup screens, and the boot read, answer their own `401`s.
 */
export function App() {
  const [state, setState] = useState<AuthState>();
  // Clearing the state remounts the boot read, so a re-read is always fresh.
  const reread = useCallback(() => setState(undefined), []);
  // A logout's answer names the logon screen for the account already known.
  // Like the 401 listener it changes only an authenticated state, so the two
  // can never both act: whichever lands first leaves the desktop.
  const loggedOff = useCallback(
    () =>
      setState((current) =>
        current?.authenticated ? { ...current, authenticated: false } : current,
      ),
    [],
  );
  // A change from Account Settings replaces the profile the root holds, so the
  // desktop redraws it and the next logon screen shows it without a re-read.
  // Like a logout it applies only to an authenticated state: a late answer
  // after the desktop closed changes nothing.
  const accountChanged = useCallback(
    (account: AccountProfile) =>
      setState((current) =>
        current?.authenticated ? { ...current, account } : current,
      ),
    [],
  );
  const authenticated = state?.authenticated === true;
  useEffect(() => {
    if (!authenticated) return;
    return onUnauthorized(() =>
      setState((current) => (current?.authenticated ? undefined : current)),
    );
  }, [authenticated]);
  if (!state) return <BootRead onAnswer={setState} />;
  // A logged-in browser always has an account; the guard only narrows the type.
  if (state.authenticated && state.account)
    return (
      <DesktopShell
        account={state.account}
        onAccountChanged={accountChanged}
        onLoggedOff={loggedOff}
      />
    );
  if (state.setupRequired || !state.account)
    return <SetupScreen onSetUp={setState} onAlreadySetUp={reread} />;
  return <LogonScreen account={state.account} onLoggedIn={setState} />;
}

/**
 * Shows the boot screen while it reads `GET /auth/state`, retrying while the
 * server is unreachable, and hands the answer up once the minimum boot
 * duration has passed. It exists only while the root has no state.
 */
function BootRead({ onAnswer }: { onAnswer: (state: AuthState) => void }) {
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const boot = useResource<AuthState>("/auth/state", true, RETRY_INTERVAL_MS);
  useEffect(() => {
    const timer = setTimeout(() => setMinimumElapsed(true), MINIMUM_BOOT_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (minimumElapsed && boot.data) onAnswer(boot.data);
  }, [minimumElapsed, boot.data, onAnswer]);
  return (
    <BootScreen
      failed={minimumElapsed && boot.error !== undefined}
      retrying={boot.loading}
      onRetry={boot.refresh}
    />
  );
}
