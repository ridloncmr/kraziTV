export class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T | PromiseLike<T>) => void;
  private rejectPromise!: (reason?: unknown) => void;
  private settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(value: T): void {
    if (this.settled) return;
    this.settled = true;
    this.resolvePromise(value);
  }

  reject(reason: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectPromise(reason);
  }

  get isSettled(): boolean {
    return this.settled;
  }
}
