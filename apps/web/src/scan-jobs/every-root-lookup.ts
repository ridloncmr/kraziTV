import { apiRequest } from "../http/api-client.js";
import type { EveryRootLookup } from "../http/contracts/metadata.js";

/**
 * Starts the lookup of every root's outstanding files (spec 0006), as a
 * saved key and the tray's **Look them up** both do. Resolves to how many
 * files the started jobs look up: 0 when it started none or was refused,
 * since the tray offers the same lookup again for files still not looked up.
 * The request is no window's to cancel, because the jobs belong to the
 * library; `onAnswered` runs once the server has answered either way, so the
 * shell re-reads the roots that now carry the jobs.
 */
export async function lookUpEveryRoot(onAnswered: () => void): Promise<number> {
  const lookupCount = await apiRequest<EveryRootLookup>(
    "/metadata/lookup-retries",
    { method: "POST", body: { scope: "outstanding" } },
  ).then(
    (answer) => answer.lookupCount,
    () => 0,
  );
  onAnswered();
  return lookupCount;
}
