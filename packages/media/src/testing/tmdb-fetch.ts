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
