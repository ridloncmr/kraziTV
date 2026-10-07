import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "./api-client.js";
import { toError } from "./to-error.js";

/**
 * Replaced reads cannot publish into another selection; hidden programs do not
 * poll. A body turns the read into a POST, and results are keyed by path and
 * body together so a changed body never shows the previous answer.
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
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path || !key || !active) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
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
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, key, json, active, revision]);
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
