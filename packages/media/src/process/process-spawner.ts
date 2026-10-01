import type { Readable } from "node:stream";

// Mirrors the process port in packages/signal/src/process. It is duplicated
// rather than shared until a third consumer justifies extracting a package.
// Keep both copies' NodeProcessSpawner settle logic identical and mirror any
// fix. The only intended difference: signal's request also carries
// `shell: false`, `cwd`, and `env`, which ffprobe does not need.

export type ProcessTerminationSignal = "SIGTERM" | "SIGKILL";

export type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

/** One direct executable invocation; spawners never route through a shell. */
export type ProcessSpawnRequest = {
  command: string;
  args: readonly string[];
};

export interface SpawnedProcess {
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** Settles only once the child and its output streams have closed. */
  readonly exited: Promise<ProcessExit>;
  /** Requests termination; returns false when the child has already exited. */
  terminate(signal: ProcessTerminationSignal): boolean;
}

export interface ProcessSpawner {
  /** Starts one direct child process so arguments are never shell-interpreted. */
  spawn(request: ProcessSpawnRequest): SpawnedProcess;
}
