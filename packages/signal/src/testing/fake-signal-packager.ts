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
  private discardWasRequested = false;

  constructor(
    private readonly owner: FakeSignalSession,
    readonly item: SignalPlayoutItem,
  ) {}

  /** Lets the session tell a worker release apart from its own stop cleanup. */
  get discardRequested(): boolean {
    return this.discardWasRequested;
  }

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

  /** Lets the session's stop observe every release still in flight. */
  discard(): Promise<void> {
    this.discardWasRequested = true;
    return this.owner.trackDiscard(this.release());
  }

  private async release(): Promise<void> {
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
  /**
   * Preparations that stop had to release because no caller had asked to. The
   * session tolerates this, but it proves the worker never discarded them.
   */
  unreleasedAtStop = 0;

  private readonly readyState = new Deferred<void>();
  private readonly completionState = new Deferred<void>();
  private currentPreparation?: FakeSignalPreparation;
  private nextPrepareFailure?: { reason: unknown };
  private nextPrepareGate?: Deferred<void>;
  private discardFailures: unknown[] = [];
  private nextDiscardGate?: Deferred<void>;
  /** Set when stop begins; ends in-flight preparation and refuses new work. */
  private stopping = false;
  /** Set only once stop has released everything, so leak checks can trust it. */
  private stopped = false;
  private readonly stopRequested = new Deferred<void>();
  private preparing?: Promise<unknown>;
  private readonly discarding = new Set<Promise<void>>();

  constructor(initialItem: SignalPlayoutItem) {
    this.committedItems = [initialItem];
    this.completion = this.completionState.promise;
    void this.readyState.promise.catch(() => undefined);
    void this.completion.catch(() => undefined);
  }

  get ready(): Promise<void> {
    return this.readyState.promise;
  }

  /** Lets leak assertions prove the session's encoder resources were released. */
  get isStopped(): boolean {
    return this.stopped;
  }

  /** Lets leak assertions prove no prepared item outlived its worker. */
  get hasOutstandingPreparation(): boolean {
    return this.currentPreparation !== undefined;
  }

  /** Honors the stop contract: stopping ends an in-flight preparation. */
  prepare(item: SignalPlayoutItem): Promise<FakeSignalPreparation> {
    const preparing = this.prepareUnlessStopped(item);
    this.preparing = preparing;
    return preparing;
  }

  private async prepareUnlessStopped(
    item: SignalPlayoutItem,
  ): Promise<FakeSignalPreparation> {
    if (this.stopping) throw stoppedError();
    if (this.currentPreparation) {
      throw new Error("Session already has an outstanding preparation");
    }
    this.prepareCalls.push(item);
    const failure = this.nextPrepareFailure;
    this.nextPrepareFailure = undefined;
    if (failure) throw failure.reason;
    const gate = this.nextPrepareGate;
    this.nextPrepareGate = undefined;
    if (gate) await Promise.race([gate.promise, this.stopRequested.promise]);
    if (this.stopping) throw stoppedError();
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

  /** Applies any arranged discard failure or pause; stop ends the pause. */
  async beforeDiscard(): Promise<void> {
    if (this.discardFailures.length > 0) throw this.discardFailures.shift();
    const gate = this.nextDiscardGate;
    this.nextDiscardGate = undefined;
    if (gate) await Promise.race([gate.promise, this.stopRequested.promise]);
  }

  /** Records a release so stop can settle it before reporting success. */
  trackDiscard(discard: Promise<void>): Promise<void> {
    this.discarding.add(discard);
    void discard
      .finally(() => this.discarding.delete(discard))
      .catch(() => undefined);
    return discard;
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
    if (this.stopping) throw stoppedError();
    this.assertCurrentPreparation(preparation);
    this.currentPreparation = undefined;
    this.committedItems.push(preparation.item);
  }

  discardPreparation(preparation: FakeSignalPreparation): void {
    this.assertCurrentPreparation(preparation);
    this.currentPreparation = undefined;
    this.discardedItems.push(preparation.item);
  }

  /**
   * Ends in-flight preparation and discards, then releases what remains. A
   * failed release leaves the session unstopped so a later stop can retry it.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopping = true;
    this.stopCalls += 1;
    this.stopRequested.resolve(undefined);
    await this.preparing?.catch(() => undefined);
    if (this.currentPreparation?.discardRequested === false) {
      this.unreleasedAtStop += 1;
    }
    await this.currentPreparation?.discard();
    await Promise.allSettled([...this.discarding]);
    this.readyState.reject(stoppedError());
    this.output.end();
    this.completionState.resolve(undefined);
    this.stopped = true;
  }

  private assertCurrentPreparation(preparation: FakeSignalPreparation): void {
    if (this.currentPreparation !== preparation) {
      throw new Error("Preparation is not owned by this session");
    }
  }
}

/** The typed failure every post-stop session operation reports. */
function stoppedError(): SignalError {
  return new SignalError("packaging_stopped", "Signal session stopped");
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
