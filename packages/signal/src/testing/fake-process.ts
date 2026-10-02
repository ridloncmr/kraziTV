import { PassThrough } from "node:stream";

import type {
  ProcessExit,
  ProcessSpawner,
  ProcessSpawnRequest,
  ProcessTerminationSignal,
  SpawnedProcess,
} from "@krazitv/process";

import { Deferred } from "./deferred.js";

export class FakeProcess implements SpawnedProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly terminationSignals: ProcessTerminationSignal[] = [];
  private readonly exitState = new Deferred<ProcessExit>();

  get exited(): Promise<ProcessExit> {
    return this.exitState.promise;
  }

  writeStdout(chunk: string | Uint8Array): void {
    this.stdout.write(chunk);
  }

  writeStderr(chunk: string | Uint8Array): void {
    this.stderr.write(chunk);
  }

  terminate(signal: ProcessTerminationSignal): boolean {
    if (this.exitState.isSettled) return false;
    this.terminationSignals.push(signal);
    return true;
  }

  exit(result: ProcessExit): void {
    if (this.exitState.isSettled) return;
    this.stdout.end();
    this.stderr.end();
    this.exitState.resolve(result);
  }

  fail(error: unknown): void {
    if (this.exitState.isSettled) return;
    this.stdout.destroy();
    this.stderr.destroy();
    this.exitState.reject(error);
  }
}

export class FakeProcessSpawner implements ProcessSpawner {
  readonly spawnCalls: ProcessSpawnRequest[] = [];
  private readonly processes: FakeProcess[] = [];

  enqueue(process: FakeProcess): void {
    this.processes.push(process);
  }

  spawn(request: ProcessSpawnRequest): FakeProcess {
    this.spawnCalls.push(request);
    const process = this.processes.shift();
    if (!process) throw new Error("No fake process was arranged");
    return process;
  }
}
