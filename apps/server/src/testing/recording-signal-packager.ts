// Test-only SignalPackager wrapper that records what a real packager was asked to air.
import type {
  SignalPackager,
  SignalPlayoutItem,
  SignalPreparation,
  SignalSession,
} from "@krazitv/signal";

/** One item made the broadcast's output, with the wall-clock time it did. */
export interface CommittedItem {
  readonly item: SignalPlayoutItem;
  readonly committedAt: number;
}

/** What one session was started with and asked to do. */
export interface RecordedSession {
  readonly initialItem: SignalPlayoutItem;
  readonly prepared: SignalPlayoutItem[];
  readonly commits: CommittedItem[];
  stopped: boolean;
}

/**
 * Passes every call through to a real packager and records the items it
 * received, so an end-to-end suite can check which entries aired, from what
 * offset, and when each transition committed, without reading FFmpeg logs.
 */
export class RecordingSignalPackager implements SignalPackager {
  readonly sessions: RecordedSession[] = [];

  // The real packager does all the work; this class only observes it.
  constructor(private readonly packager: SignalPackager) {}

  /** Starts the real session and records its initial item. */
  start(initialItem: SignalPlayoutItem): SignalSession {
    const record: RecordedSession = {
      initialItem,
      prepared: [],
      commits: [],
      stopped: false,
    };
    this.sessions.push(record);
    const session = this.packager.start(initialItem);
    return {
      ready: session.ready,
      completion: session.completion,
      output: session.output,
      prepare: async (item) => {
        record.prepared.push(item);
        return recordCommit(await session.prepare(item), item, record);
      },
      stop: async () => {
        await session.stop();
        record.stopped = true;
      },
    };
  }
}

/** Wraps a preparation so a successful commit is recorded with its time. */
function recordCommit(
  preparation: SignalPreparation,
  item: SignalPlayoutItem,
  record: RecordedSession,
): SignalPreparation {
  return {
    commit: () => {
      preparation.commit();
      record.commits.push({ item, committedAt: Date.now() });
    },
    discard: () => preparation.discard(),
  };
}
