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
 * readiness and cleanup paths without spawning FFmpeg.
 */
export class ScriptedSignalPackager implements SignalPackager {
  readonly sessions: ScriptedSession[] = [];
  readiness: "ready" | "never" = "ready";
  /** When set, every session stop rejects with it and leaves the session running. */
  stopFailure: Error | undefined;

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
    let outstanding = false;
    return {
      ready:
        this.readiness === "ready" ? Promise.resolve() : new Promise(() => {}),
      completion,
      output,
      // Prepares any item at once, as the real session validates and holds
      // it, with the real contract's limits: one outstanding preparation, none
      // after stop, and one commit or discard each. Committing changes no
      // scripted output; tests read what aired through RecordingSignalPackager.
      prepare: async () => {
        if (session.stopped) throw new Error("session stopped");
        if (outstanding) throw new Error("a preparation is outstanding");
        outstanding = true;
        let settled = false;
        const settle = (): void => {
          if (settled || session.stopped) {
            throw new Error("preparation already settled");
          }
          settled = true;
          outstanding = false;
        };
        return {
          commit: settle,
          discard: async () => {
            if (!settled) {
              settled = true;
              outstanding = false;
            }
          },
        };
      },
      stop: async () => {
        if (this.stopFailure !== undefined) throw this.stopFailure;
        session.stopped = true;
        output.end();
        finish();
      },
    };
  }
}
