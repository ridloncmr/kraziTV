/** A promise a test settles by hand, at most once, to script async ordering. */
export class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T | PromiseLike<T>) => void;
  private rejectPromise!: (reason?: unknown) => void;
  private settled = false;

  /** Captures the settle functions so a test can drive the promise later. */
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  /** Resolves once; later calls are ignored so racing settle paths stay safe. */
  resolve(value: T): void {
    if (this.settled) return;
    this.settled = true;
    this.resolvePromise(value);
  }

  /** Rejects once; later calls are ignored so racing settle paths stay safe. */
  reject(reason: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectPromise(reason);
  }

  /** Lets a fake refuse work after its outcome is fixed, as a real child would. */
  get isSettled(): boolean {
    return this.settled;
  }
}
