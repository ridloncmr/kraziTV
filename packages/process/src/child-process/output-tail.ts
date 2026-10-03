// Stderr bytes ffprobe and FFmpeg keep for failure diagnostics, shared so both
// report failures with the same amount of context.
export const STDERR_TAIL_LIMIT_BYTES = 64 * 1024;

/** Retains only the newest bytes of a child's output, so a noisy child cannot grow memory. */
export class OutputTail {
  private readonly chunks: Buffer[] = [];
  private retained = 0;

  /** Keeps at most `limitBytes`, a positive byte count chosen by the consumer. */
  constructor(private readonly limitBytes: number) {}

  /** The number of bytes currently retained, never more than the limit. */
  get byteLength(): number {
    return this.retained;
  }

  /** Copies one stream chunk in, dropping the oldest bytes beyond the limit. */
  append(chunk: Buffer | Uint8Array | string): void {
    const view = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    if (view.byteLength === 0) return;

    if (view.byteLength >= this.limitBytes) {
      this.chunks.length = 0;
      this.chunks.push(
        Buffer.from(view.subarray(view.byteLength - this.limitBytes)),
      );
      this.retained = this.limitBytes;
      return;
    }

    this.chunks.push(Buffer.from(view));
    this.retained += view.byteLength;
    while (this.retained > this.limitBytes) {
      const first = this.chunks[0];
      if (first === undefined) break;

      const overflow = this.retained - this.limitBytes;
      if (overflow >= first.byteLength) {
        this.chunks.shift();
        this.retained -= first.byteLength;
      } else {
        this.chunks[0] = Buffer.from(first.subarray(overflow));
        this.retained -= overflow;
      }
    }
  }

  /** Returns a copy of the retained bytes, oldest first. */
  bytes(): Buffer {
    return Buffer.concat(this.chunks, this.retained);
  }
}
