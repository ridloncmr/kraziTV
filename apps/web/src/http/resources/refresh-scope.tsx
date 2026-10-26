import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * One reload request for every read in a scope. A quiet reload keeps the
 * current data on screen without a progress message and is skipped by a
 * read that is already in flight.
 */
type RefreshSignal = { revision: number; quiet: boolean };

const RefreshContext = createContext<{
  signal: RefreshSignal;
  refresh: () => void;
}>({ signal: { revision: 0, quiet: false }, refresh: () => {} });

/**
 * Groups the reads of one part of the page so they reload together: loudly
 * when `refresh` is called, as a Refresh button does, and quietly when
 * `active` turns on or the enclosing scope reloads. Data changed elsewhere,
 * such as through the API or another window, then shows up without a click.
 */
export function RefreshScope({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const parent = useContext(RefreshContext).signal.revision;
  const [signal, setSignal] = useState<RefreshSignal>({
    revision: 0,
    quiet: false,
  });
  // Reacting during render, not in an effect, lets the reads see the new
  // signal in the same commit that changed `active`.
  const [seen, setSeen] = useState({ active, parent });
  if (seen.active !== active || seen.parent !== parent) {
    setSeen({ active, parent });
    if ((active && !seen.active) || seen.parent !== parent)
      setSignal((current) => ({ revision: current.revision + 1, quiet: true }));
  }
  const refresh = useCallback(
    () =>
      setSignal((current) => ({
        revision: current.revision + 1,
        quiet: false,
      })),
    [],
  );
  const value = useMemo(() => ({ signal, refresh }), [signal, refresh]);
  return (
    <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
  );
}

/** A scope that reloads quietly whenever the browser window regains focus. */
export function PageRefreshScope({ children }: { children: ReactNode }) {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    globalThis.addEventListener("focus", focus);
    globalThis.addEventListener("blur", blur);
    return () => {
      globalThis.removeEventListener("focus", focus);
      globalThis.removeEventListener("blur", blur);
    };
  }, []);
  return <RefreshScope active={focused}>{children}</RefreshScope>;
}

/** The nearest scope's reload signal and its loud `refresh`. */
export function useRefreshScope() {
  return useContext(RefreshContext);
}
