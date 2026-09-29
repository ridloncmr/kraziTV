import type { Readable } from "node:stream";

export type ProcessTerminationSignal = "SIGTERM" | "SIGKILL";
export type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};
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
  readonly exited: Promise<ProcessExit>;
  terminate(signal: ProcessTerminationSignal): boolean;
}

export interface ProcessSpawner {
  spawn(request: ProcessSpawnRequest): SpawnedProcess;
}
