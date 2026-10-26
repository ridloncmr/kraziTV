import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../api-client.js";
import { useRefreshScope } from "./refresh-scope.js";
import { toError } from "../to-error.js";

/**
 * Replaced reads cannot publish into another selection; hidden programs do not
 * poll. A body turns the read into a POST, and results are keyed by path and
 * body together so a changed body never shows the previous answer. The read
 * also reloads with its refresh scope; a quiet reload of data already shown
 * reports no loading and never restarts a read in flight.
 */
export function useResource<T>(
  path: string | null,
  active = true,
  intervalMs = 0,
  body?: unknown,
) {
  // A body can hold thousands of IDs, so it is serialized only when the caller
  // passes a new one; callers keep its identity stable between renders.
  const json = useMemo(
    () => (body === undefined ? undefined : JSON.stringify(body)),
    [body],
  );
  const key = path === null ? null : `${path} ${json ?? ""}`;
  const [result, setResult] = useState<{ key: string; data: T }>();
  const [failure, setFailure] = useState<{ key: string; error: Error }>();
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState({ count: 0, quiet: false });
  const refresh = useCallback(
    () => setRevision((value) => ({ count: value.count + 1, quiet: false })),
    [],
  );
  const shownKey = useRef<string>(undefined);
  shownKey.current = result?.key;
  const inFlight = useRef(false);
  useEffect(() => {
    if (!path || !key || !active) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    inFlight.current = true;
    if (!revision.quiet || shownKey.current !== key) setLoading(true);
    void apiRequest<T>(path, {
      signal: controller.signal,
      ...(json === undefined
        ? {}
        : { method: "POST", body: JSON.parse(json) as unknown }),
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setResult({ key, data: value });
          setFailure(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setFailure({
            key,
            error: toError(error),
          });
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        inFlight.current = false;
        setLoading(false);
      });
    return () => {
      inFlight.current = false;
      controller.abort();
    };
  }, [path, key, json, active, revision]);
  // Runs after the read above, so a scope reload landing in the same commit
  // as a new path or a shown window finds that read in flight and skips.
  const { signal } = useRefreshScope();
  const seenSignal = useRef(signal.revision);
  useEffect(() => {
    if (seenSignal.current === signal.revision) return;
    seenSignal.current = signal.revision;
    if (signal.quiet && inFlight.current) return;
    setRevision((value) => ({ count: value.count + 1, quiet: signal.quiet }));
  }, [signal]);
  useEffect(() => {
    if (!active || !path || !intervalMs || loading) return;
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [active, path, intervalMs, refresh, loading]);
  return {
    data: result?.key === key ? result.data : undefined,
    error: failure?.key === key ? failure.error : undefined,
    loading,
    refresh,
  };
}

/**
 * Reads each of `paths` once while active and keeps every answer keyed by
 * path, so a list can read one resource per row without a hook per row. A
 * read is never abandoned when another path joins, so rows settle in one
 * request each. A failed read reports `failed`, so the caller can stop
 * waiting for it, and is tried again when the paths next change. Every path
 * is read again when the refresh scope reloads, keeping its answer meanwhile.
 */
export function useResourceMap<T>(
  paths: readonly string[],
  active = true,
): { get: (path: string) => T | undefined; failed: (path: string) => boolean } {
  const [values, setValues] = useState<ReadonlyMap<string, T>>(new Map());
  const [failures, setFailures] = useState<ReadonlySet<string>>(new Set());
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const key = [...new Set(paths)].sort().join("\n");
  const { revision } = useRefreshScope().signal;
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (!active || key === "") return;
    if (seenRevision.current !== revision) {
      seenRevision.current = revision;
      requested.current.clear();
    }
    for (const path of key.split("\n")) {
      if (requested.current.has(path)) continue;
      requested.current.add(path);
      apiRequest<T>(path).then(
        (value) => {
          if (!mounted.current) return;
          setValues((current) => new Map(current).set(path, value));
          setFailures((current) => withoutPath(current, path));
        },
        () => {
          requested.current.delete(path);
          if (mounted.current) {
            setFailures((current) => new Set(current).add(path));
          }
        },
      );
    }
  }, [key, active, revision]);
  return {
    get: (path) => values.get(path),
    failed: (path) => failures.has(path),
  };
}

// A copy of the paths without `path`, or the same set when it is absent.
function withoutPath(
  paths: ReadonlySet<string>,
  path: string,
): ReadonlySet<string> {
  if (!paths.has(path)) return paths;
  const next = new Set(paths);
  next.delete(path);
  return next;
}

/** A program owns its write until completion or close; concurrent submissions are blocked. */
export function useMutation() {
  const owner = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [message, setMessage] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      owner.current?.abort();
    };
  }, []);
  /** Success callbacks run only while this program still owns the result. */
  async function run<T>(
    path: string,
    method: string,
    body?: unknown,
    onSuccess?: (value: T) => void,
  ): Promise<void> {
    if (owner.current) return;
    const controller = new AbortController();
    owner.current = controller;
    setPending(true);
    setError(undefined);
    setMessage("");
    try {
      const value = await apiRequest<T>(path, {
        method,
        body,
        signal: controller.signal,
      });
      if (!mounted.current || controller.signal.aborted) return;
      setMessage("Operation completed successfully.");
      onSuccess?.(value);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted)
        setError(toError(failure));
    } finally {
      if (owner.current === controller) owner.current = null;
      if (mounted.current) setPending(false);
    }
  }
  return { run, pending, error, message };
}
