/**
 * Resolves with the promise's value, or with `fallback` if it rejects or does not
 * settle within `ms`. Used to keep liveness probes from blocking when a dependency
 * is unreachable (a queued Redis command can otherwise hang indefinitely).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
