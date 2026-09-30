import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { installShutdownHandlers } from "./shutdown.js";

describe("installShutdownHandlers", () => {
  it("shares one graceful close across termination signals", async () => {
    const signals = new EventEmitter();
    const close = vi.fn(async () => undefined);
    const installed = installShutdownHandlers(
      { close },
      Object.assign(signals, { exitCode: undefined as number | undefined }),
      vi.fn(),
    );

    signals.emit("SIGINT");
    signals.emit("SIGTERM");
    await installed.shutdown();

    expect(close).toHaveBeenCalledOnce();
  });

  it("reports failed cleanup and marks the process unsuccessful", async () => {
    const signals = Object.assign(new EventEmitter(), {
      exitCode: undefined as number | undefined,
    });
    const failure = new Error("cleanup failed");
    const report = vi.fn();
    const installed = installShutdownHandlers(
      { close: vi.fn(async () => Promise.reject(failure)) },
      signals,
      report,
    );

    signals.emit("SIGTERM");
    await installed.shutdown();

    expect(signals.exitCode).toBe(1);
    expect(report).toHaveBeenCalledWith(failure);
  });
});
