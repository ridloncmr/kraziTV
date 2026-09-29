import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { NodeProcessSpawner } from "./node-process-spawner.js";

const collect = (chunks: Buffer[]): string => Buffer.concat(chunks).toString();

describe("NodeProcessSpawner", () => {
  it("spawns a command without a shell and exposes both output streams", async () => {
    const spawner = new NodeProcessSpawner();
    const child = spawner.spawn({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('video'); process.stderr.write('diagnostic')",
      ],
      shell: false,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    await expect(child.exited).resolves.toEqual({ code: 0, signal: null });
    expect(collect(stdout)).toBe("video");
    expect(collect(stderr)).toBe("diagnostic");
  });

  it("rejects the exit promise when the executable cannot be spawned", async () => {
    const spawner = new NodeProcessSpawner();
    const child = spawner.spawn({
      command: `missing-krazitv-executable-${process.pid}`,
      args: [],
      shell: false,
    });

    await expect(child.exited).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not mistake a post-spawn process error for verified closure", async () => {
    const nodeChild = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    const spawnChild = (() => nodeChild) as unknown as typeof spawn;
    const spawner = new NodeProcessSpawner(spawnChild);
    const child = spawner.spawn({
      command: "ffmpeg",
      args: [],
      shell: false,
    });
    const settled = vi.fn();
    void child.exited.then(settled, settled);

    nodeChild.emit("spawn");
    nodeChild.emit("error", new Error("signal delivery failed"));
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();

    nodeChild.emit("close", 0, null);
    await expect(child.exited).resolves.toEqual({ code: 0, signal: null });
  });
});
