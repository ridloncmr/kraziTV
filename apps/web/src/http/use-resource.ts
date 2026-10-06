import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api-client.js";

/** Replaced reads cannot publish into another selection; hidden programs do not poll. */
export function useResource<T>(
  path: string | null,
  active = true,
  intervalMs = 0,
) {
  const [result, setResult] = useState<{ path: string; data: T }>();
  const [failure, setFailure] = useState<{ path: string; error: Error }>();
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path || !active) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void apiRequest<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setResult({ path, data: value });
          setFailure(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setFailure({
            path,
            error: error instanceof Error ? error : new Error(String(error)),
          });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, active, revision]);
  useEffect(() => {
    if (!active || !path || !intervalMs || loading) return;
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [active, path, intervalMs, refresh, loading]);
  return {
    data: result?.path === path ? result.data : undefined,
    error: failure?.path === path ? failure.error : undefined,
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
        setError(
          failure instanceof Error ? failure : new Error(String(failure)),
        );
    } finally {
      if (owner.current === controller) owner.current = null;
      if (mounted.current) setPending(false);
    }
  }
  return { run, pending, error, message };
}
