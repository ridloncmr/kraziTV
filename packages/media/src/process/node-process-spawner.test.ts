import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { NodeProcessSpawner } from "./node-process-spawner.js";

const collect = (chunks: Buffer[]): string => Buffer.concat(chunks).toString();

// Builds a Node child stand-in whose lifecycle events the test emits by hand.
function fakeNodeChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
}

describe("NodeProcessSpawner", () => {
  it("spawns a real executable and exposes both output streams", async () => {
    const child = new NodeProcessSpawner().spawn({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('json'); process.stderr.write('diag')",
      ],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    await expect(child.exited).resolves.toEqual({ code: 0, signal: null });
    expect(collect(stdout)).toBe("json");
    expect(collect(stderr)).toBe("diag");
  });

  it("never invokes a shell and passes argv unchanged", () => {
    const nodeChild = fakeNodeChild();
    const spawnChild = vi.fn(() => nodeChild);
    const spawner = new NodeProcessSpawner(
      spawnChild as unknown as typeof spawn,
    );

    spawner.spawn({ command: "/opt/ffprobe", args: ["-i", "a & b.mkv"] });

    expect(spawnChild).toHaveBeenCalledWith(
      "/opt/ffprobe",
      ["-i", "a & b.mkv"],
      expect.objectContaining({
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it("rejects the exit promise when the executable cannot be spawned", async () => {
    const child = new NodeProcessSpawner().spawn({
      command: `missing-krazitv-executable-${process.pid}`,
      args: [],
    });

    await expect(child.exited).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not mistake a post-spawn process error for closure", async () => {
    const nodeChild = fakeNodeChild();
    const spawner = new NodeProcessSpawner(
      (() => nodeChild) as unknown as typeof spawn,
    );
    const child = spawner.spawn({ command: "ffprobe", args: [] });
    const settled = vi.fn();
    void child.exited.then(settled, settled);

    nodeChild.emit("spawn");
    nodeChild.emit("error", new Error("signal delivery failed"));
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    nodeChild.emit("close", null, "SIGKILL");
    await expect(child.exited).resolves.toEqual({
      code: null,
      signal: "SIGKILL",
    });
  });

  it("forwards termination signals to the child", () => {
    const nodeChild = fakeNodeChild();
    const spawner = new NodeProcessSpawner(
      (() => nodeChild) as unknown as typeof spawn,
    );

    spawner.spawn({ command: "ffprobe", args: [] }).terminate("SIGTERM");

    expect(nodeChild.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
