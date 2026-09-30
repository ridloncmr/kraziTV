type ClosableServer = {
  close(): Promise<unknown>;
};

type ShutdownSignals = {
  exitCode?: string | number | null;
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

export type InstalledShutdown = {
  shutdown(): Promise<void>;
  dispose(): void;
};

/** Installs one shared graceful-close attempt for both process stop signals. */
export function installShutdownHandlers(
  server: ClosableServer,
  signals: ShutdownSignals = process,
  report: (error: unknown) => void = console.error,
): InstalledShutdown {
  let closing: Promise<void> | undefined;
  const dispose = (): void => {
    signals.removeListener("SIGINT", handleSignal);
    signals.removeListener("SIGTERM", handleSignal);
  };
  const shutdown = (): Promise<void> => {
    closing ??= server
      .close()
      .then(() => undefined)
      .catch((error: unknown) => {
        signals.exitCode = 1;
        report(error);
      })
      .finally(dispose);
    return closing;
  };
  const handleSignal = (): void => {
    void shutdown();
  };
  signals.once("SIGINT", handleSignal);
  signals.once("SIGTERM", handleSignal);
  return { shutdown, dispose };
}
