import type { PacketSink } from "../contracts.js";

/**
 * Holds a prepared FFmpeg process's packets until its commit (ADR 0016),
 * then passes them, and everything after, straight through. Bounded: past
 * `limitBytes` it reports once and drops what follows, so a preparation held
 * too long can never grow without end.
 */
export class HeldOutput implements PacketSink {
  private held: Buffer[] = [];
  private heldBytes = 0;
  private released: PacketSink | undefined;
  private overflowed = false;

  /** Takes the limit and who to tell when it is passed. */
  constructor(
    private readonly limitBytes: number,
    private readonly onOverflow: () => void,
  ) {}

  /** Holds the packets before release and forwards them after it. */
  write(packets: Buffer): void {
    if (this.released !== undefined) {
      this.released.write(packets);
      return;
    }
    if (this.overflowed) return;
    if (this.heldBytes + packets.byteLength > this.limitBytes) {
      this.overflowed = true;
      this.discard();
      this.onOverflow();
      return;
    }
    this.held.push(packets);
    this.heldBytes += packets.byteLength;
  }

  /** Writes everything held to `sink` in order, then forwards to it from now on. */
  release(sink: PacketSink): void {
    this.released = sink;
    const held = this.held;
    this.discard();
    if (held.length > 0) sink.write(Buffer.concat(held));
  }

  /** Drops what is held, for a preparation that will never commit. */
  discard(): void {
    this.held = [];
    this.heldBytes = 0;
  }
}
