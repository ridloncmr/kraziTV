import type { Readable } from "node:stream";

// Mirrors the process port proven in packages/signal. It is duplicated rather
// than shared until a second real consumer justifies extracting a package.

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
  terminate(signal: ProcessTerminationSignal): boolean;
}

export interface ProcessSpawner {
  spawn(request: ProcessSpawnRequest): SpawnedProcess;
}
