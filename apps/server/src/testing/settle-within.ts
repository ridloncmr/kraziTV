/**
 * Rejects naming `description` when `promise` has not settled within `ms`,
 * so a race test whose pause hook never fires fails fast and says which side
 * hung instead of waiting out the test timeout.
 */
export async function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
  description: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${description} did not settle within ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
