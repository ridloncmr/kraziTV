import type { Readable } from "node:stream";

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

/** A pending one-shot timer that can be cancelled before it fires. */
interface ProcessTimer {
  cancel(): void;
}

/** Schedules termination deadlines; injectable so callers keep deterministic clocks. */
export interface ProcessTimerScheduler {
  setTimeout(callback: () => void, delayMs: number): ProcessTimer;
}

export interface ProcessSpawner {
  /** Starts one direct child process so arguments are never shell-interpreted. */
  spawn(request: ProcessSpawnRequest): SpawnedProcess;
}
