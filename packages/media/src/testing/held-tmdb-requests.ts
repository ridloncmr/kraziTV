/** A request the test settles by hand, recording when it started. */
export function heldRequests() {
  const started: number[] = [];
  const releases: (() => void)[] = [];
  const request = (id: number) => async () => {
    started.push(id);
    await new Promise<void>((resolve) => releases.push(resolve));
    return id;
  };
  return { started, releases, request };
}
