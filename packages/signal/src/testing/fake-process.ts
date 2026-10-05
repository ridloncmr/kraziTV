import { PassThrough } from "node:stream";

import type {
  ProcessExit,
  ProcessSpawner,
  ProcessSpawnRequest,
  ProcessTerminationSignal,
  SpawnedProcess,
} from "@krazitv/process";

import { Deferred } from "./deferred.js";

/** An FFmpeg child whose output and closure the test scripts by hand. */
export class FakeProcess implements SpawnedProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly terminationSignals: ProcessTerminationSignal[] = [];
  private readonly exitState = new Deferred<ProcessExit>();

  /** Settles only when the test calls `exit` or `fail`, never on a signal alone. */
  get exited(): Promise<ProcessExit> {
    return this.exitState.promise;
  }

  /** Emits child output, such as MPEG-TS packets, at the moment the test chooses. */
  writeStdout(chunk: string | Uint8Array): void {
    this.stdout.write(chunk);
  }

  /** Emits diagnostics so stderr tails and summaries can be asserted. */
  writeStderr(chunk: string | Uint8Array): void {
    this.stderr.write(chunk);
  }

  /**
   * Records the signal without exiting, so a test can prove escalation and
   * decide when, or whether, the child closes. Refuses once it has exited.
   */
  terminate(signal: ProcessTerminationSignal): boolean {
    if (this.exitState.isSettled) return false;
    this.terminationSignals.push(signal);
    return true;
  }

  /** Closes the child with a chosen code or signal after ending its pipes. */
  exit(result: ProcessExit): void {
    if (this.exitState.isSettled) return;
    this.stdout.end();
    this.stderr.end();
    this.exitState.resolve(result);
  }

  /** Simulates an OS-level failure observed after spawn, with broken pipes. */
  fail(error: unknown): void {
    if (this.exitState.isSettled) return;
    this.stdout.destroy();
    this.stderr.destroy();
    this.exitState.reject(error);
  }
}

/** Hands out pre-arranged fake children in order and records each request. */
export class FakeProcessSpawner implements ProcessSpawner {
  readonly spawnCalls: ProcessSpawnRequest[] = [];
  private readonly processes: FakeProcess[] = [];

  /** Arranges the child the next spawn returns, so a test holds its handle first. */
  enqueue(process: FakeProcess): void {
    this.processes.push(process);
  }

  /** Throws when nothing was arranged, so an unexpected spawn fails the test loudly. */
  spawn(request: ProcessSpawnRequest): FakeProcess {
    this.spawnCalls.push(request);
    const process = this.processes.shift();
    if (!process) throw new Error("No fake process was arranged");
    return process;
  }
}
