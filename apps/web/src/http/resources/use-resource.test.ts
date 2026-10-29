// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../../testing/browser-api.js";
import { elapse } from "../../testing/fake-time.js";
import { RefreshScope, useRefreshScope } from "./refresh-scope.js";
import { useMutation, useResource, useResourceMap } from "./use-resource.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("discards a previous selection even when its transport finishes after abort", async () => {
  const api = new BrowserApi();
  api.hold("/first");
  api.reply("/second", { name: "second" });
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(({ path }) => useResource<{ name: string }>(path), {
    initialProps: { path: "/first" },
  });
  await waitFor(() => expect(api.requests).toHaveLength(1));
  view.rerender({ path: "/second" });
  await waitFor(() => expect(view.result.current.data?.name).toBe("second"));
  await act(async () => {
    api.release("/first", { name: "old" });
  });
  expect(view.result.current.data?.name).toBe("second");
  expect(api.requests[0].signal?.aborted).toBe(true);
});

it("polls every ten seconds while visible and stops while minimized", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.reply("/now", { offsetMs: 50 });
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(
    ({ visible }) => useResource<{ offsetMs: number }>("/now", visible, 10_000),
    { initialProps: { visible: true } },
  );
  await elapse(0);
  await elapse(10_000);
  expect(api.requests).toHaveLength(2);
  expect(view.result.current.data?.offsetMs).toBe(50);
  view.rerender({ visible: false });
  await elapse(30_000);
  expect(api.requests).toHaveLength(2);
  view.rerender({ visible: true });
  await elapse(0);
  expect(api.requests).toHaveLength(3);
});

it("does not abort a slow current-state read at each polling tick", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.hold("/slow");
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(() =>
    useResource<{ offsetMs: number }>("/slow", true, 10_000),
  );
  await elapse(30_000);
  expect(api.requests).toHaveLength(1);
  expect(api.requests[0].signal?.aborted).toBe(false);
  await act(async () => {
    api.release("/slow", { offsetMs: 99 });
  });
  expect(view.result.current.data?.offsetMs).toBe(99);
});

it("waits a full interval after each answer lands before polling again", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  // Every answer takes four seconds to arrive.
  api.handle(
    "/now",
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(api.response({ offsetMs: 1 })), 4_000);
      }),
  );
  vi.stubGlobal("fetch", api.fetch);
  renderHook(() => useResource<{ offsetMs: number }>("/now", true, 10_000));

  await elapse(4_000);
  expect(api.requests).toHaveLength(1);
  // A fixed clock would ask again at ten seconds; the poll waits from the answer.
  await elapse(9_999);
  expect(api.requests).toHaveLength(1);
  await elapse(1);
  expect(api.requests).toHaveLength(2);
  await elapse(4_000);
  await elapse(10_000);
  expect(api.requests).toHaveLength(3);
});

it("reads and polls nothing without a path, and reads once without an interval", async () => {
  vi.useFakeTimers();
  const api = new BrowserApi();
  api.reply("/once", { name: "once" });
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(
    ({ path, intervalMs }) =>
      useResource<{ name: string }>(path, true, intervalMs),
    { initialProps: { path: null as string | null, intervalMs: 10_000 } },
  );

  await elapse(30_000);
  expect(api.requests).toEqual([]);
  expect(view.result.current.loading).toBe(false);

  view.rerender({ path: "/once", intervalMs: 0 });
  await elapse(30_000);
  expect(api.requests).toHaveLength(1);
  expect(view.result.current.data?.name).toBe("once");
});

it("never shows another path's answer or failure while its own read loads", async () => {
  const api = new BrowserApi();
  api.reply("/fine", { name: "fine" });
  api.reply(
    "/broken",
    { error: { code: "offline", message: "Down" } },
    "GET",
    503,
  );
  api.hold("/slow");
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(({ path }) => useResource<{ name: string }>(path), {
    initialProps: { path: "/fine" },
  });
  await waitFor(() => expect(view.result.current.data?.name).toBe("fine"));

  view.rerender({ path: "/broken" });
  expect(view.result.current.data).toBeUndefined();
  await waitFor(() => expect(view.result.current.error).toBeDefined());

  view.rerender({ path: "/slow" });
  expect(view.result.current.error).toBeUndefined();
  expect(view.result.current.data).toBeUndefined();
  expect(view.result.current.loading).toBe(true);
  await act(async () => {
    api.release("/slow", { name: "slow" });
  });
  expect(view.result.current.data?.name).toBe("slow");
  expect(view.result.current.loading).toBe(false);
});

it("re-reads when a body's content changes but not when only its identity does", async () => {
  const api = new BrowserApi();
  api.handle(
    "/search",
    (request) => api.response({ q: (request.body as { q: string }).q }),
    "POST",
  );
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(
    ({ body }) => useResource<{ q: string }>("/search", true, 0, body),
    { initialProps: { body: { q: "a" } } },
  );
  await waitFor(() => expect(view.result.current.data?.q).toBe("a"));
  view.rerender({ body: { q: "a" } });
  view.rerender({ body: { q: "b" } });
  await waitFor(() => expect(view.result.current.data?.q).toBe("b"));
  expect(api.requests.map((request) => request.body)).toEqual([
    { q: "a" },
    { q: "b" },
  ]);
});

it("closing an owner cancels its write and prevents a late success callback", async () => {
  const api = new BrowserApi();
  api.hold("/scan", "POST");
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(() => useMutation());
  const completed = vi.fn();
  let pending: Promise<void>;
  act(() => {
    pending = view.result.current.run("/scan", "POST", undefined, completed);
  });
  view.unmount();
  expect(api.requests[0].signal?.aborted).toBe(true);
  api.release("/scan", { done: true }, "POST");
  await pending!;
  expect(completed).not.toHaveBeenCalled();
});

it("reads each of several paths once, keeping a pending read when another path joins", async () => {
  const api = new BrowserApi();
  api.hold("/slow");
  api.reply("/fast", { name: "fast" });
  api.reply("/later", { name: "later" });
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(
    ({ paths, visible }) => useResourceMap<{ name: string }>(paths, visible),
    { initialProps: { paths: ["/slow", "/fast"], visible: false } },
  );
  expect(api.requests).toEqual([]);

  view.rerender({ paths: ["/slow", "/fast"], visible: true });
  await waitFor(() =>
    expect(view.result.current.get("/fast")?.name).toBe("fast"),
  );
  view.rerender({ paths: ["/slow", "/fast", "/later"], visible: true });
  await waitFor(() =>
    expect(view.result.current.get("/later")?.name).toBe("later"),
  );
  await act(async () => {
    api.release("/slow", { name: "slow" });
  });

  expect(view.result.current.get("/slow")?.name).toBe("slow");
  expect(api.requests.map((request) => request.path).sort()).toEqual([
    "/fast",
    "/later",
    "/slow",
  ]);
});

it("reports a failed read among several paths, so a caller can stop waiting for it", async () => {
  const api = new BrowserApi();
  api.reply("/fine", { name: "fine" });
  api.reply(
    "/broken",
    { error: { code: "offline", message: "Down" } },
    "GET",
    503,
  );
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(() =>
    useResourceMap<{ name: string }>(["/fine", "/broken"]),
  );

  await waitFor(() => expect(view.result.current.failed("/broken")).toBe(true));
  expect(view.result.current.get("/broken")).toBeUndefined();
  expect(view.result.current.failed("/fine")).toBe(false);
  expect(view.result.current.get("/fine")?.name).toBe("fine");
});

it("reloads every read in a refresh scope, quietly when the scope turns active", async () => {
  let active = false;
  const api = new BrowserApi();
  api.reply("/one", { name: "one" });
  api.reply("/two", { name: "two" });
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(
    () => ({
      one: useResource<{ name: string }>("/one"),
      two: useResource<{ name: string }>("/two"),
      scope: useRefreshScope(),
    }),
    {
      wrapper: scopeWrapper(() => active),
    },
  );
  await waitFor(() => expect(view.result.current.two.data?.name).toBe("two"));

  act(() => view.result.current.scope.refresh());
  expect(view.result.current.one.loading).toBe(true);
  await waitFor(() => expect(api.requests).toHaveLength(4));
  await waitFor(() => expect(view.result.current.one.loading).toBe(false));

  active = true;
  view.rerender();
  expect(view.result.current.one.loading).toBe(false);
  await waitFor(() => expect(api.requests).toHaveLength(6));
});

it("skips a quiet scope reload while its read is still in flight", async () => {
  let active = false;
  const api = new BrowserApi();
  api.hold("/slow");
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(() => useResource<{ name: string }>("/slow"), {
    wrapper: scopeWrapper(() => active),
  });
  await waitFor(() => expect(api.requests).toHaveLength(1));

  active = true;
  view.rerender();
  await act(async () => {
    api.release("/slow", { name: "slow" });
  });

  expect(api.requests).toHaveLength(1);
  expect(api.requests[0].signal?.aborted).toBe(false);
  expect(view.result.current.data?.name).toBe("slow");
});

it("reads once when its window shows in the same commit as its scope's quiet reload", async () => {
  let active = false;
  const api = new BrowserApi();
  api.reply("/shown", { name: "shown" });
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(
    () => useResource<{ name: string }>("/shown", active),
    { wrapper: scopeWrapper(() => active) },
  );
  expect(api.requests).toEqual([]);

  active = true;
  view.rerender();
  await waitFor(() => expect(view.result.current.data?.name).toBe("shown"));

  expect(api.requests).toHaveLength(1);
  expect(api.requests[0].signal?.aborted).toBe(false);
});

it("reloads quietly when the scope around its own scope reloads", async () => {
  const api = new BrowserApi();
  api.reply("/inner", { name: "inner" });
  vi.stubGlobal("fetch", api.fetch);
  let outer: () => void = () => {};
  // Captures the outer scope's loud refresh, as its Refresh button would hold it.
  function OuterRefresh() {
    outer = useRefreshScope().refresh;
    return null;
  }
  const view = renderHook(() => useResource<{ name: string }>("/inner"), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(RefreshScope, {
        active: true,
        children: [
          createElement(OuterRefresh, { key: "refresh" }),
          createElement(RefreshScope, { key: "inner", active: true, children }),
        ],
      }),
  });
  await waitFor(() => expect(view.result.current.data?.name).toBe("inner"));

  act(() => outer());

  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.data?.name).toBe("inner");
  await waitFor(() => expect(api.requests).toHaveLength(2));
});

it("reads every path again when its refresh scope reloads", async () => {
  const api = new BrowserApi();
  api.reply("/a", { name: "a" });
  api.reply("/b", { name: "b" });
  vi.stubGlobal("fetch", api.fetch);
  const view = renderHook(
    () => ({
      map: useResourceMap<{ name: string }>(["/a", "/b"]),
      scope: useRefreshScope(),
    }),
    { wrapper: scopeWrapper(() => true) },
  );
  await waitFor(() =>
    expect(view.result.current.map.get("/b")?.name).toBe("b"),
  );

  act(() => view.result.current.scope.refresh());

  await waitFor(() => expect(api.requests).toHaveLength(4));
  expect(view.result.current.map.get("/a")?.name).toBe("a");
});

// Wraps a hook in a refresh scope whose `active` the test changes between renders.
function scopeWrapper(active: () => boolean) {
  return ({ children }: { children: ReactNode }) =>
    createElement(RefreshScope, { active: active(), children });
}
