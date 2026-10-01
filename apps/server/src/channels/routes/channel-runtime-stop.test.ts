import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignalError } from "@krazitv/signal";

import { RecordingChannelRuntime } from "../../testing/recording-channel-runtime.js";
import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../../testing/test-environment.js";
import { ChannelRepository } from "../repository/channel-repository.js";
import { sequentialIds } from "../../testing/record-sources.js";

type Server = FastifyInstance;

afterEach(cleanUpTestEnvironment);

// Boots the real composition with deterministic IDs, a recording runtime, and
// error logs captured as parsed JSON lines.
async function startServer(options: { channelStopTimeoutMs?: number } = {}) {
  const runtime = new RecordingChannelRuntime();
  const logs: Record<string, unknown>[] = [];
  const { server, dependencies } = await startTestServer({
    channelStopTimeoutMs: options.channelStopTimeoutMs,
    logger: {
      level: "error",
      stream: {
        write: (line: string) =>
          logs.push(JSON.parse(line) as Record<string, unknown>),
      },
    },
    overrides: (db) => ({
      channels: new ChannelRepository(db, {
        createId: sequentialIds("channel"),
      }),
      channelRuntime: runtime,
    }),
  });
  return { server, runtime, logs, channels: dependencies.channels };
}

function create(server: Server, payload: InjectOptions["payload"]) {
  return server.inject({ method: "POST", url: "/channels", payload });
}

function update(server: Server, id: string, payload: InjectOptions["payload"]) {
  return server.inject({ method: "PATCH", url: `/channels/${id}`, payload });
}

function remove(server: Server, id: string) {
  return server.inject({ method: "DELETE", url: `/channels/${id}` });
}

function cleanupFailed(
  operation: "disable" | "delete",
  persistenceCommitted: boolean,
) {
  return {
    error: {
      code: "channel_runtime_cleanup_failed",
      message: expect.any(String),
      channelId: "channel-001",
      operation,
      persistenceCommitted,
      retryable: true,
    },
  };
}

describe("disabling a channel", () => {
  it("stops the runtime after the disable commits", async () => {
    const { server, runtime, channels } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });
    let committedState: boolean | undefined;
    runtime.onStop = async ({ channelId }) => {
      committedState = (await channels.findById(channelId))?.enabled;
    };

    const response = await update(server, "channel-001", { enabled: false });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: false });
    expect(runtime.stops).toEqual([
      { channelId: "channel-001", reason: "disabled" },
    ]);
    expect(committedState).toBe(false);
  });

  it("does not respond until the stop settles", async () => {
    const { server, runtime } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });
    let release!: () => void;
    runtime.onStop = () => new Promise((resolve) => (release = resolve));
    let responded = false;

    const pending = update(server, "channel-001", { enabled: false }).then(
      (response) => {
        responded = true;
        return response;
      },
    );
    await vi.waitFor(() => expect(runtime.stops).toHaveLength(1));
    await new Promise((resolve) => setImmediate(resolve));

    expect(responded).toBe(false);
    release();
    expect((await pending).statusCode).toBe(200);
  });

  it("commits other changes in the same request before stopping", async () => {
    const { server, runtime, channels } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });
    let committedName: string | undefined;
    runtime.onStop = async ({ channelId }) => {
      committedName = (await channels.findById(channelId))?.name;
    };

    await update(server, "channel-001", { enabled: false, name: "Off Air" });

    expect(committedName).toBe("Off Air");
  });

  it("keeps the disable and reports a retryable 503 when the stop fails", async () => {
    const { server, runtime, channels } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });
    runtime.failure = new Error("ffmpeg would not exit");

    const response = await update(server, "channel-001", { enabled: false });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(cleanupFailed("disable", true));
    expect((await channels.findById("channel-001"))?.enabled).toBe(false);
  });

  it("retries the stop when an already-disabled channel is disabled again", async () => {
    const { server, runtime } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });
    runtime.failure = new Error("ffmpeg would not exit");
    await update(server, "channel-001", { enabled: false });
    runtime.failure = undefined;

    const retry = await update(server, "channel-001", { enabled: false });

    expect(retry.statusCode).toBe(200);
    expect(runtime.stops).toEqual([
      { channelId: "channel-001", reason: "disabled" },
      { channelId: "channel-001", reason: "disabled" },
    ]);
  });

  it("does not stop anything for an unknown channel", async () => {
    const { server, runtime } = await startServer();

    const response = await update(server, "missing", { enabled: false });

    expect(response.statusCode).toBe(404);
    expect(runtime.stops).toEqual([]);
  });
});

describe("deleting a channel", () => {
  it("stops the runtime after the delete commits", async () => {
    const { server, runtime, channels } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });
    let stillStored: boolean | undefined;
    runtime.onStop = async ({ channelId }) => {
      stillStored = (await channels.findById(channelId)) !== undefined;
    };

    const response = await remove(server, "channel-001");

    expect(response.statusCode).toBe(204);
    expect(runtime.stops).toEqual([
      { channelId: "channel-001", reason: "deleted" },
    ]);
    expect(stillStored).toBe(false);
  });

  it("keeps the delete and reports a retryable 503 when the stop fails", async () => {
    const { server, runtime, channels } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });
    runtime.failure = new Error("ffmpeg would not exit");

    const response = await remove(server, "channel-001");

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(cleanupFailed("delete", true));
    expect(await channels.findById("channel-001")).toBeUndefined();
  });

  it("retries the stop when the channel is already gone", async () => {
    const { server, runtime } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });
    runtime.failure = new Error("ffmpeg would not exit");
    await remove(server, "channel-001");
    runtime.failure = undefined;

    const retry = await remove(server, "channel-001");

    expect(retry.statusCode).toBe(204);
    expect(runtime.stops).toEqual([
      { channelId: "channel-001", reason: "deleted" },
      { channelId: "channel-001", reason: "deleted" },
    ]);
  });
});

describe("re-enabling a channel", () => {
  it("retries the prior stop before committing the enable", async () => {
    const { server, runtime, channels } = await startServer();
    await create(server, {
      number: "69",
      name: "Krazi Comedy",
      enabled: false,
    });
    let stateDuringStop: boolean | undefined;
    runtime.onStop = async ({ channelId }) => {
      stateDuringStop = (await channels.findById(channelId))?.enabled;
    };

    const response = await update(server, "channel-001", { enabled: true });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: true });
    expect(runtime.stops).toEqual([
      { channelId: "channel-001", reason: "disabled" },
    ]);
    expect(stateDuringStop).toBe(false);
  });

  it("keeps the channel disabled and unchanged while the stop fails", async () => {
    const { server, runtime, channels } = await startServer();
    await create(server, {
      number: "69",
      name: "Krazi Comedy",
      enabled: false,
    });
    runtime.failure = new Error("ffmpeg would not exit");

    const response = await update(server, "channel-001", {
      enabled: true,
      name: "Back On Air",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(cleanupFailed("disable", false));
    expect(await channels.findById("channel-001")).toMatchObject({
      enabled: false,
      name: "Krazi Comedy",
    });
  });

  it("enables once a retried stop succeeds", async () => {
    const { server, runtime } = await startServer();
    await create(server, {
      number: "69",
      name: "Krazi Comedy",
      enabled: false,
    });
    runtime.failure = new Error("ffmpeg would not exit");
    await update(server, "channel-001", { enabled: true });
    runtime.failure = undefined;

    const retry = await update(server, "channel-001", { enabled: true });

    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ enabled: true });
  });
});

describe("changes that leave the runtime alone", () => {
  it("never stops for create, rename, renumber, or enabling an enabled channel", async () => {
    const { server, runtime } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });

    await update(server, "channel-001", { name: "Krazi Classics" });
    await update(server, "channel-001", { number: "69.1" });
    await update(server, "channel-001", { enabled: true });

    expect(runtime.stops).toEqual([]);
  });
});

describe("cleanup failure logging", () => {
  it("logs the channel, operation, stop reason, phase, and cause details", async () => {
    const { server, runtime, logs } = await startServer();
    await create(server, { number: "69", name: "Krazi Comedy" });
    runtime.failure = new SignalError(
      "runtime_cleanup_failed",
      "Channel channel-001 runtime cleanup did not settle",
      { channelId: "channel-001", phase: "worker_stop" },
      {
        cause: new SignalError("packaging_failed", "FFmpeg did not exit", {
          pid: 4242,
        }),
      },
    );

    await update(server, "channel-001", { enabled: false });

    expect(logs).toContainEqual(
      expect.objectContaining({
        msg: "Channel runtime cleanup failed",
        channelId: "channel-001",
        operation: "disable",
        stopReason: "disabled",
        persistenceCommitted: true,
        cleanupPhase: "worker_stop",
        causes: [
          {
            code: "runtime_cleanup_failed",
            message: "Channel channel-001 runtime cleanup did not settle",
            details: { channelId: "channel-001", phase: "worker_stop" },
          },
          {
            code: "packaging_failed",
            message: "FFmpeg did not exit",
            details: { pid: 4242 },
          },
        ],
      }),
    );
  });
});

describe("concurrent lifecycle changes", () => {
  it("runs a disable only after an in-flight re-enable finishes", async () => {
    const { server, runtime, channels } = await startServer();
    await create(server, {
      number: "69",
      name: "Krazi Comedy",
      enabled: false,
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let released = false;
    let secondStopAfterRelease: boolean | undefined;
    runtime.onStop = async () => {
      if (runtime.stops.length === 1) return held;
      secondStopAfterRelease = released;
      throw new Error("ffmpeg would not exit");
    };

    // ChannelLifecycleLock tests prove the waiting itself without timing; this
    // checks the routes hold the lock, so the disable lands after the re-enable.
    const enabling = update(server, "channel-001", { enabled: true });
    await vi.waitFor(() => expect(runtime.stops).toHaveLength(1));
    const disabling = update(server, "channel-001", { enabled: false });
    released = true;
    release();
    expect((await enabling).statusCode).toBe(200);
    expect((await disabling).statusCode).toBe(503);
    expect(runtime.stops).toHaveLength(2);
    expect(secondStopAfterRelease).toBe(true);
    expect((await channels.findById("channel-001"))?.enabled).toBe(false);
  });

  it("does not hold up lifecycle changes on other channels", async () => {
    const { server, runtime } = await startServer();
    await create(server, { number: "69", name: "Held" });
    await create(server, { number: "70", name: "Free" });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    runtime.onStop = ({ channelId }) =>
      channelId === "channel-001" ? held : undefined;

    const first = update(server, "channel-001", { enabled: false });
    await vi.waitFor(() => expect(runtime.stops).toHaveLength(1));

    expect((await remove(server, "channel-002")).statusCode).toBe(204);
    release();
    expect((await first).statusCode).toBe(200);
  });
});

describe("a stop that never settles", () => {
  it("answers the retryable 503 at the deadline and frees the channel", async () => {
    const { server, runtime, channels } = await startServer({
      channelStopTimeoutMs: 50,
    });
    await create(server, { number: "69", name: "Krazi Comedy" });
    runtime.onStop = () =>
      runtime.stops.length === 1 ? new Promise<void>(() => {}) : undefined;

    const disabling = await update(server, "channel-001", { enabled: false });

    expect(disabling.statusCode).toBe(503);
    expect(disabling.json()).toEqual(cleanupFailed("disable", true));
    expect((await channels.findById("channel-001"))?.enabled).toBe(false);
    const renaming = await update(server, "channel-001", { name: "Off Air" });
    expect(renaming.statusCode).toBe(200);
  });

  it("keeps a re-enable refused while the stop is still hung", async () => {
    const { server, runtime, channels } = await startServer({
      channelStopTimeoutMs: 50,
    });
    await create(server, {
      number: "69",
      name: "Krazi Comedy",
      enabled: false,
    });
    runtime.onStop = () => new Promise<void>(() => {});

    const response = await update(server, "channel-001", { enabled: true });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(cleanupFailed("disable", false));
    expect((await channels.findById("channel-001"))?.enabled).toBe(false);
  });
});
