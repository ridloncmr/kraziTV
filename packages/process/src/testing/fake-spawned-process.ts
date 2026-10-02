import { PassThrough } from "node:stream";

import type {
  ProcessExit,
  ProcessTerminationSignal,
  SpawnedProcess,
} from "../child-process/contracts.js";

/** A child whose closure tests trigger by hand and whose signal requests are recorded. */
export class FakeSpawnedProcess implements SpawnedProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly terminationSignals: ProcessTerminationSignal[] = [];
  readonly exited: Promise<ProcessExit>;
  /** When set, every termination request throws it, like a failed kill(). */
  terminationError: Error | undefined;
  private close!: (exit: ProcessExit) => void;

  /** Creates a still-running child. */
  constructor() {
    this.exited = new Promise<ProcessExit>((resolve) => {
      this.close = resolve;
    });
  }

  /** Records the request without closing, like a child ignoring the signal. */
  terminate(signal: ProcessTerminationSignal): boolean {
    this.terminationSignals.push(signal);
    if (this.terminationError !== undefined) throw this.terminationError;
    return true;
  }

  /** Reports closure as Node's "close" event does. */
  exit(exit: ProcessExit): void {
    this.close(exit);
  }
}
