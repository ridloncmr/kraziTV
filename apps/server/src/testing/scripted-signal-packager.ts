// Test-only SignalPackager that stands in for FFmpeg at the server boundary.
import { PassThrough } from "node:stream";

import type {
  SignalPackager,
  SignalPlayoutItem,
  SignalSession,
} from "@krazitv/signal";

const PACKET_BYTES = 188;

/** Builds one MPEG-TS packet carrying only its sync byte and PID. */
export function transportPacket(pid: number): Buffer {
  const packet = Buffer.alloc(PACKET_BYTES);
  packet[0] = 0x47;
  packet[1] = (pid >> 8) & 0x1f;
  packet[2] = pid & 0xff;
  return packet;
}

/** A PAT followed by two more packets: the smallest output a viewer can join. */
export const JOINABLE_OUTPUT = Buffer.concat([
  transportPacket(0),
  transportPacket(256),
  transportPacket(256),
]);

/** One started session, exposed so a test can feed it more output. */
export interface ScriptedSession {
  readonly item: SignalPlayoutItem;
  readonly output: PassThrough;
  stopped: boolean;
}

/**
 * Starts sessions that emit joinable output at once, or never become ready
 * when `readiness` is `"never"`, so server tests reach the real manager's
 * readiness paths without spawning FFmpeg.
 */
export class ScriptedSignalPackager implements SignalPackager {
  readonly sessions: ScriptedSession[] = [];
  readiness: "ready" | "never" = "ready";

  /** Records the session and writes joinable output unless told to hang. */
  start(initialItem: SignalPlayoutItem): SignalSession {
    const output = new PassThrough();
    const session: ScriptedSession = {
      item: initialItem,
      output,
      stopped: false,
    };
    this.sessions.push(session);
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (this.readiness === "ready") output.write(JOINABLE_OUTPUT);
    return {
      ready:
        this.readiness === "ready" ? Promise.resolve() : new Promise(() => {}),
      completion,
      output,
      // Boundaries sit minutes past the test clock, so preparation never runs.
      prepare: () => Promise.reject(new Error("unexpected prepare")),
      stop: async () => {
        session.stopped = true;
        output.end();
        finish();
      },
    };
  }
}
