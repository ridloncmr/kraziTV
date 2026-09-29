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
    this.owner.discardPreparation(this);
    this.state = "discarded";
  }
}

export class FakeSignalSession implements SignalSession {
  readonly output = new PassThrough();
  readonly committedItems: SignalPlayoutItem[];
  readonly discardedItems: SignalPlayoutItem[] = [];
  readonly prepareCalls: SignalPlayoutItem[] = [];
  stopCalls = 0;

  private readonly readyState = new Deferred<void>();
  private currentPreparation?: FakeSignalPreparation;
  private stopped = false;

  constructor(initialItem: SignalPlayoutItem) {
    this.committedItems = [initialItem];
    void this.readyState.promise.catch(() => undefined);
  }

  get ready(): Promise<void> {
    return this.readyState.promise;
  }

  async prepare(item: SignalPlayoutItem): Promise<SignalPreparation> {
    if (this.stopped) {
      throw new Error("Cannot prepare an item after the session has stopped");
    }
    if (this.currentPreparation) {
      throw new Error("Session already has an outstanding preparation");
    }
    this.prepareCalls.push(item);
    const preparation = new FakeSignalPreparation(this, item);
    this.currentPreparation = preparation;
    return preparation;
  }

  resolveReady(): void {
    this.readyState.resolve(undefined);
  }

  rejectReady(reason: unknown): void {
    this.readyState.reject(reason);
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
