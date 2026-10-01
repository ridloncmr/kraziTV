import type { Readable } from "node:stream";

// Duplicated in packages/media/src/process; see the note there before changing
// either copy.

export type ProcessTerminationSignal = "SIGTERM" | "SIGKILL";

export type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

/** One direct executable invocation; spawners never route through a shell. */
export type ProcessSpawnRequest = {
  command: string;
  args: readonly string[];
  shell: false;
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
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
