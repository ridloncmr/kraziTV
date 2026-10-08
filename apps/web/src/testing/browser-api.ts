/** Requests captured at the fetch boundary use the real public API method/body/error contract. */
interface BrowserRequest {
  path: string;
  /** Handlers match on path alone; tests read the query to check paging and search. */
  query: URLSearchParams;
  method: string;
  body: unknown;
  signal?: AbortSignal | null;
  /** Whether the request asked the browser to send its session cookie. */
  credentials?: RequestCredentials | undefined;
}
type Handler = (request: BrowserRequest) => Response | Promise<Response>;

/** Controlled fetch transport; held responses deliberately ignore abort to exercise late-result guards. */
export class BrowserApi {
  readonly requests: BrowserRequest[] = [];
  readonly #handlers = new Map<string, Handler>();
  readonly #held = new Map<string, (response: Response) => void>();

  /** Canned replies still pass through production HTTP-status and JSON-envelope handling. */
  reply(path: string, value: unknown, method = "GET", status = 200): void {
    this.handle(path, () => this.response(value, status), method);
  }

  /** A route may model committed persistence before returning a cleanup failure. */
  handle(path: string, handler: Handler, method = "GET"): void {
    this.#handlers.set(`${method}:${path}`, handler);
  }

  /** Holding a response allows selection, minimize and close to race with a real pending request. */
  hold(path: string, method = "GET"): void {
    this.handle(
      path,
      () =>
        new Promise<Response>((resolve) => {
          this.#held.set(`${method}:${path}`, resolve);
        }),
      method,
    );
  }

  /** Resolves the held transport even after abort, proving callers discard stale completions. */
  release(path: string, value: unknown, method = "GET", status = 200): void {
    const resolve = this.#held.get(`${method}:${path}`);
    if (!resolve) throw new Error(`No held request for ${method}:${path}`);
    resolve(this.response(value, status));
    this.#held.delete(`${method}:${path}`);
  }

  /** JSON and 204 responses match the server rather than returning domain objects directly. */
  response(value: unknown, status = 200): Response {
    return new Response(status === 204 ? null : JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Arrow binding makes this directly usable as global fetch without exposing test-only production options. */
  fetch = async (
    input: RequestInfo | URL,
    options?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      "http://ui.test",
    );
    const path = url.pathname;
    const request: BrowserRequest = {
      path,
      query: url.searchParams,
      method: options?.method ?? "GET",
      body:
        typeof options?.body === "string"
          ? (JSON.parse(options.body) as unknown)
          : undefined,
      signal: options?.signal,
      credentials: options?.credentials,
    };
    this.requests.push(request);
    const handler = this.#handlers.get(`${request.method}:${path}`);
    return handler
      ? await handler(request)
      : this.response(
          {
            error: {
              code: "not_found",
              message: `Unexpected test request: ${request.method} ${path}`,
            },
          },
          404,
        );
  };
}
