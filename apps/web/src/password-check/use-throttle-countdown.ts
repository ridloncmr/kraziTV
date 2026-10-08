import { useEffect, useState } from "react";
import { throttleSeconds } from "./password-check-refusals.js";

/**
 * The seconds left before a throttled password check may be retried, counting
 * down once a second from the latest answer's wait. A new answer restarts the
 * count, and unmounting clears the pending tick, so no timer outlives the form.
 */
export function useThrottleCountdown(error: Error | undefined): number {
  const [waitSeconds, setWaitSeconds] = useState(0);
  useEffect(() => {
    setWaitSeconds(throttleSeconds(error));
  }, [error]);
  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = setTimeout(() => setWaitSeconds((left) => left - 1), 1_000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);
  return waitSeconds;
}
