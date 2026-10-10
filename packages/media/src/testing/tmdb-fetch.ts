/** Answers with a fixed status while recording the real client's HTTP contract. */
export function answering(status: number) {
  const calls: { url: string; authorization: string | null }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Response.json({ success: status === 200 }, { status });
  };
  return { fetch, calls };
}

/** Models a hung request that settles only when the client's signal aborts. */
export const hanging = (_input: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) {
      reject(init.signal.reason as Error);
      return;
    }
    init?.signal?.addEventListener("abort", () =>
      reject(init.signal?.reason as Error),
    );
  });

/** Holds movie headers or bodies while authentication answers immediately. */
export function heldMovieFetch(holdBody = false) {
  const releases: (() => void)[] = [];
  const paths: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    paths.push(url.pathname + (url.searchParams.get("query") ?? ""));
    if (url.pathname === "/3/authentication")
      return Response.json({ success: true });
    if (!holdBody) {
      await new Promise<void>((resolve) => releases.push(resolve));
      return Response.json({ results: [] });
    }
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          let settled = false;
          const onAbort = () => {
            if (settled) return;
            settled = true;
            controller.error(init?.signal?.reason);
          };
          releases.push(() => {
            if (settled) return;
            settled = true;
            init?.signal?.removeEventListener("abort", onAbort);
            controller.enqueue(new TextEncoder().encode('{"results":[]}'));
            controller.close();
          });
          init?.signal?.addEventListener("abort", onAbort, { once: true });
          if (init?.signal?.aborted) onAbort();
        },
      }),
    );
  };
  return { fetch, releases, paths };
}

/** How a routed fetch answers one request path. */
type Route = (url: URL) => Response | Promise<Response>;

/**
 * A fetch that answers by request path, as TMDB would, and records every URL
 * it was asked for. An unrouted path answers TMDB's `404`.
 */
export function routedFetch(routes: Record<string, Route>) {
  const urls: URL[] = [];
  const fetch = async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    urls.push(url);
    const route = routes[url.pathname];
    return route
      ? route(url)
      : Response.json({ status_code: 34 }, { status: 404 });
  };
  return { fetch, urls };
}
