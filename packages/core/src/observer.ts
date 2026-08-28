export type SynchronousObserver<Value> = (value: Value) => unknown;

/**
 * 구독 함수가 비동기 함수를 받지 않도록 하는 입력 타입입니다.
 *
 * `void` 반환 함수는 Promise를 반환하는 함수도 받을 수 있으므로, 구독 등록
 * 시점에는 실제 반환 타입을 검사해야 합니다. 자바스크립트 호출자는 이 검사를
 * 우회할 수 있으므로 `notifyObserver`는 기존처럼 오류를 격리합니다.
 *
 * @internal
 */
export type SynchronousObserverInput<
  Value,
  Observer extends SynchronousObserver<Value>,
> = Observer &
  ([Extract<ReturnType<Observer>, PromiseLike<unknown>>] extends [never] ? unknown : never);

const nativePromiseThen = Object.getOwnPropertyDescriptor(Promise.prototype, "then")?.value;
const nativePromiseConstructor = Promise;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function ignoreObserverFailure(): void {}

function isObjectOrFunction(
  value: unknown,
): value is object | ((...arguments_: never[]) => unknown) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function consumeNativePromiseRejection(value: Promise<unknown>): boolean {
  // 생성자나 결과 형식을 바꾼 비동기 결과는 안전한 표준 처리 방법이 없어 지원하지 않는다.
  // 반환값이나 전역 오류 처리는 바꾸지 않는다.
  if (typeof nativePromiseThen !== "function") {
    return false;
  }

  try {
    void Reflect.apply(nativePromiseThen, value, [undefined, ignoreObserverFailure]);
    return true;
  } catch {
    return false;
  }
}

function isNativePromise(
  value: object | ((...arguments_: never[]) => unknown),
): value is Promise<unknown> {
  return value instanceof nativePromiseConstructor;
}

/**
 * Attaches rejection handling to a promise owned by this module, rather than
 * to the observer's returned value. A native promise can shadow `catch`, so
 * calling `result.catch(...)` would allow an observer to bypass isolation.
 */
function consumeThenableRejection(thenable: PromiseLike<unknown>): void {
  void new Promise<unknown>((resolve) => {
    resolve(thenable);
  }).catch(ignoreObserverFailure);
}

/**
 * Delivers a value to an external observer without allowing observer failures
 * to alter the producer's control flow. The observer is invoked synchronously
 * with the same receiver semantics as a direct function call, but any returned
 * promise is deliberately not awaited.
 *
 * @internal Shared boundary for engine, causality, and adapter notifications.
 */
export function notifyObserver<Value>(observer: SynchronousObserver<Value>, value: Value): void {
  try {
    const result = observer(value);

    if (!isObjectOrFunction(result)) {
      return;
    }

    if (isNativePromise(result) && consumeNativePromiseRejection(result)) {
      return;
    }

    if (isThenable(result)) {
      consumeThenableRejection(result);
    }
  } catch {
    // Observers must never alter the application or runtime control flow.
  }
}
