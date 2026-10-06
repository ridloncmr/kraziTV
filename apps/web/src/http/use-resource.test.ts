// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../testing/browser-api.js";
import { useMutation, useResource } from "./use-resource.js";

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
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(api.requests).toHaveLength(2);
  expect(view.result.current.data?.offsetMs).toBe(50);
  view.rerender({ visible: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(api.requests).toHaveLength(2);
  view.rerender({ visible: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
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
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(api.requests).toHaveLength(1);
  expect(api.requests[0].signal?.aborted).toBe(false);
  await act(async () => {
    api.release("/slow", { offsetMs: 99 });
  });
  expect(view.result.current.data?.offsetMs).toBe(99);
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
