import { PassThrough } from "node:stream";

import type {
  ProcessExit,
  ProcessSpawner,
  ProcessSpawnRequest,
  ProcessTerminationSignal,
  SpawnedProcess,
} from "@krazitv/process";

/** A child process whose output and closure are driven explicitly by tests. */
export class FakeProcess implements SpawnedProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly terminationSignals: ProcessTerminationSignal[] = [];
  readonly exited: Promise<ProcessExit>;
  private settle!: (exit: ProcessExit) => void;
  private failSpawn!: (error: unknown) => void;
  private closed = false;

  /** Creates a still-running child. */
  constructor() {
    this.exited = new Promise<ProcessExit>((resolve, reject) => {
      this.settle = resolve;
      this.failSpawn = reject;
    });
  }

  /** Records requested signals without closing, like a child ignoring them. */
  terminate(signal: ProcessTerminationSignal): boolean {
    if (this.closed) return false;
    this.terminationSignals.push(signal);
    return true;
  }

  /** Closes output streams, then reports closure as Node's "close" event does. */
  exit(result: ProcessExit): void {
    if (this.closed) return;
    this.closed = true;
    this.stdout.end();
    this.stderr.end();
    this.settle(result);
  }

  /** Simulates an asynchronous spawn failure such as ENOENT. */
  fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.stdout.destroy();
    this.stderr.destroy();
    this.failSpawn(error);
  }
}

/** Hands out pre-arranged fake children and records every spawn request. */
export class FakeProcessSpawner implements ProcessSpawner {
  readonly spawnCalls: ProcessSpawnRequest[] = [];
  private readonly processes: FakeProcess[] = [];

  /** Queues the child returned by the next spawn. */
  enqueue(process: FakeProcess): void {
    this.processes.push(process);
  }

  /** Returns the next queued child, failing loudly if a test forgot one. */
  spawn(request: ProcessSpawnRequest): FakeProcess {
    this.spawnCalls.push(request);
    const process = this.processes.shift();
    if (!process) throw new Error("No fake process was arranged");
    return process;
  }
}
