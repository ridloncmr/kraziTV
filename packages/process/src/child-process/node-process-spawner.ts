import { spawn } from "node:child_process";

import type {
  ProcessExit,
  ProcessSpawner,
  ProcessSpawnRequest,
  SpawnedProcess,
} from "./contracts.js";

/** Adapts Node child-process events to the process port. */
export class NodeProcessSpawner implements ProcessSpawner {
  /** Allows deterministic adapter tests while using Node spawn in production. */
  constructor(private readonly spawnChild: typeof spawn = spawn) {}

  /** Spawns without a shell and treats stdio closure as verified completion. */
  spawn(request: ProcessSpawnRequest): SpawnedProcess {
    const child = this.spawnChild(request.command, [...request.args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    if (child.stdout === null || child.stderr === null) {
      throw new Error("Spawned process did not expose piped output streams");
    }

    const exited = new Promise<ProcessExit>((resolve, reject) => {
      let settled = false;
      let spawned = false;
      child.once("spawn", () => {
        spawned = true;
      });
      child.on("error", (error) => {
        // After spawn, errors (e.g. failed kill delivery) do not mean closure.
        if (spawned || settled) return;
        settled = true;
        reject(error);
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        resolve({ code, signal });
      });
    });

    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exited,
      terminate: (signal) => child.kill(signal),
    };
  }
}
