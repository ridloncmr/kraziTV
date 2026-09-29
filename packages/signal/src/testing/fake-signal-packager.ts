import { PassThrough } from "node:stream";

import type {
  SignalPackager,
  SignalPlayoutItem,
  SignalPreparation,
  SignalSession,
} from "../signal-packager/contracts.js";
import { SignalError } from "../errors.js";
import { Deferred } from "./deferred.js";

type PreparationState = "pending" | "committed" | "discarded";

export class FakeSignalPreparation implements SignalPreparation {
  private state: PreparationState = "pending";

  constructor(
    private readonly owner: FakeSignalSession,
    readonly item: SignalPlayoutItem,
  ) {}

  commit(): void {
    if (this.state === "committed") {
      throw new Error("Preparation was already committed");
    }
    if (this.state === "discarded") {
      throw new Error("Preparation was already discarded");
    }
    this.owner.commitPreparation(this);
    this.state = "committed";
  }

  async discard(): Promise<void> {
    if (this.state !== "pending") return;
    await this.owner.beforeDiscard();
    if (this.state !== "pending") return;
    this.owner.discardPreparation(this);
    this.state = "discarded";
  }
}

export class FakeSignalSession implements SignalSession {
  readonly output = new PassThrough();
  readonly committedItems: SignalPlayoutItem[];
  readonly completion: Promise<void>;
  readonly discardedItems: SignalPlayoutItem[] = [];
  readonly prepareCalls: SignalPlayoutItem[] = [];
  stopCalls = 0;

  private readonly readyState = new Deferred<void>();
  private readonly completionState = new Deferred<void>();
  private currentPreparation?: FakeSignalPreparation;
  private nextPrepareFailure?: { reason: unknown };
  private nextPrepareGate?: Deferred<void>;
  private discardFailures: unknown[] = [];
  private nextDiscardGate?: Deferred<void>;
  private stopped = false;

  constructor(initialItem: SignalPlayoutItem) {
    this.committedItems = [initialItem];
    this.completion = this.completionState.promise;
    void this.readyState.promise.catch(() => undefined);
    void this.completion.catch(() => undefined);
  }

  get ready(): Promise<void> {
    return this.readyState.promise;
  }

  async prepare(item: SignalPlayoutItem): Promise<FakeSignalPreparation> {
    if (this.stopped) {
      throw new Error("Cannot prepare an item after the session has stopped");
    }
    if (this.currentPreparation) {
      throw new Error("Session already has an outstanding preparation");
    }
    this.prepareCalls.push(item);
    const failure = this.nextPrepareFailure;
    this.nextPrepareFailure = undefined;
    if (failure) throw failure.reason;
    const gate = this.nextPrepareGate;
    this.nextPrepareGate = undefined;
    if (gate) await gate.promise;
    const preparation = new FakeSignalPreparation(this, item);
    this.currentPreparation = preparation;
    return preparation;
  }

  /** Makes the next preparation reject, as an encoder that cannot prewarm. */
  failNextPrepare(reason: unknown): void {
    this.nextPrepareFailure = { reason };
  }

  /** Holds the next preparation open until the returned gate resolves. */
  pauseNextPrepare(): Deferred<void> {
    this.nextPrepareGate = new Deferred<void>();
    return this.nextPrepareGate;
  }

  /** Makes the next discard attempts reject, one per queued reason. */
  failDiscards(...reasons: unknown[]): void {
    this.discardFailures.push(...reasons);
  }

  /** Holds the next discard open until the returned gate resolves. */
  pauseNextDiscard(): Deferred<void> {
    this.nextDiscardGate = new Deferred<void>();
    return this.nextDiscardGate;
  }

  /** Applies any arranged discard failure or pause before releasing. */
  async beforeDiscard(): Promise<void> {
    if (this.discardFailures.length > 0) throw this.discardFailures.shift();
    const gate = this.nextDiscardGate;
    this.nextDiscardGate = undefined;
    if (gate) await gate.promise;
  }

  resolveReady(): void {
    this.readyState.resolve(undefined);
  }

  rejectReady(reason: unknown): void {
    this.readyState.reject(reason);
    this.completionState.reject(reason);
  }

  pushOutput(chunk: string | Uint8Array): void {
    this.output.write(chunk);
  }

  commitPreparation(preparation: FakeSignalPreparation): void {
    this.assertCurrentPreparation(preparation);
    this.currentPreparation = undefined;
    this.committedItems.push(preparation.item);
  }

  discardPreparation(preparation: FakeSignalPreparation): void {
    this.assertCurrentPreparation(preparation);
    this.currentPreparation = undefined;
    this.discardedItems.push(preparation.item);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.stopCalls += 1;
    await this.currentPreparation?.discard();
    this.readyState.reject(
      new SignalError("packaging_stopped", "Signal session stopped"),
    );
    this.output.end();
    this.completionState.resolve(undefined);
  }

  private assertCurrentPreparation(preparation: FakeSignalPreparation): void {
    if (this.currentPreparation !== preparation) {
      throw new Error("Preparation is not owned by this session");
    }
  }
}

export class FakeSignalPackager implements SignalPackager {
  readonly startCalls: SignalPlayoutItem[] = [];
  readonly sessions: FakeSignalSession[] = [];

  start(initialItem: SignalPlayoutItem): FakeSignalSession {
    this.startCalls.push(initialItem);
    const session = new FakeSignalSession(initialItem);
    this.sessions.push(session);
    return session;
  }
}
