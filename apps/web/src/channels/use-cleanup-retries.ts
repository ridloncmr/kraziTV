import { useSyncExternalStore } from "react";

/**
 * A failed worker stop to retry. A lifecycle retry repeats its disable or
 * delete; a rebuild retry repeats its fresh rebuild under the same key, which
 * the server recognizes and does not rebuild again.
 */
type CleanupRetry =
  | {
      id: string;
      operation: "disable" | "delete";
      committed: boolean;
      message: string;
    }
  | { id: string; operation: "rebuild"; key: string; message: string };
let retries: CleanupRetry[] = [];
const listeners = new Set<() => void>();

/** Retains pending operation references across program close, including already deleted channels. */
function remember(retry: CleanupRetry): void {
  retries = [
    ...retries.filter(
      (entry) => entry.id !== retry.id || entry.operation !== retry.operation,
    ),
    retry,
  ];
  for (const listener of listeners) listener();
}

/** A confirmed lifecycle stop also settles any earlier rebuild's worker cleanup. */
function settle(id: string, operation: CleanupRetry["operation"]): void {
  retries = retries.filter(
    (entry) =>
      entry.id !== id ||
      (entry.operation !== operation &&
        !(operation !== "rebuild" && entry.operation === "rebuild")),
  );
  for (const listener of listeners) listener();
}

/** Subscribers own UI lifetime; retry references remain transient memory rather than domain persistence. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The immutable snapshot changes only when a backend response adds or settles cleanup. */
function snapshot(): CleanupRetry[] {
  return retries;
}

/** Failed lifecycle operations outlive a window; channel configuration remains exclusively API-backed. */
export function useCleanupRetries() {
  return {
    retries: useSyncExternalStore(subscribe, snapshot),
    remember,
    settle,
  };
}
