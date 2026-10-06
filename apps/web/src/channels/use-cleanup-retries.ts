import { useSyncExternalStore } from "react";

interface CleanupRetry {
  id: string;
  operation: "disable" | "delete";
  committed: boolean;
  message: string;
}
let retries: CleanupRetry[] = [];
const listeners = new Set<() => void>();

/** Retains pending operation references across program close, including already deleted channels. */
function remember(retry: CleanupRetry): void {
  retries = [...retries.filter((entry) => entry.id !== retry.id), retry];
  for (const listener of listeners) listener();
}

/** Only confirmed cleanup success dismisses its retry action. */
function settle(id: string): void {
  retries = retries.filter((entry) => entry.id !== id);
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
