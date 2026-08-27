type Observer<Value> = (value: Value) => unknown;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function ignoreObserverFailure(): void {}

/**
 * Delivers a value to an external observer without allowing observer failures
 * to alter the producer's control flow. The observer is invoked synchronously
 * with the same receiver semantics as a direct function call, but any returned
 * promise is deliberately not awaited.
 *
 * @internal Shared boundary for engine, causality, and adapter notifications.
 */
export function notifyObserver<Value>(observer: Observer<Value>, value: Value): void {
  try {
    const result = observer(value);

    if (isThenable(result)) {
      void Promise.resolve(result).catch(ignoreObserverFailure);
    }
  } catch {
    // Observers must never alter the application or runtime control flow.
  }
}
