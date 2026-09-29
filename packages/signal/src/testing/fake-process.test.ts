import { describe, expect, it } from "vitest";

import { FakeProcess, FakeProcessSpawner } from "./fake-process.js";

describe("FakeProcessSpawner", () => {
  it("returns queued processes and records structured spawn requests", () => {
    const spawner = new FakeProcessSpawner();
    const process = new FakeProcess();
    spawner.enqueue(process);

    const request = {
      command: "ffmpeg",
      args: ["-i", "input.mkv"],
      shell: false as const,
    };

    expect(spawner.spawn(request)).toBe(process);
    expect(spawner.spawnCalls).toEqual([request]);
  });

  it("models output, termination, and process exit without real time", async () => {
    const process = new FakeProcess();
    const stdout: Buffer[] = [];
    process.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));

    process.writeStdout(Buffer.from("video"));
    expect(process.terminate("SIGTERM")).toBe(true);
    process.exit({ code: 0, signal: null });

    await expect(process.exited).resolves.toEqual({ code: 0, signal: null });
    expect(Buffer.concat(stdout).toString()).toBe("video");
    expect(process.terminationSignals).toEqual(["SIGTERM"]);
    expect(process.terminate("SIGKILL")).toBe(false);
  });
});
