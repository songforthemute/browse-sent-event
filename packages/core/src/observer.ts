/** 공개 구독 함수는 값을 반환하지 않고 현재 호출 안에서 끝나야 한다. */
export type SynchronousObserver<Value> = (value: Value) => undefined;

type Observer<Value> = (value: Value) => unknown;

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
 * 구독 함수가 돌려준 객체 대신 이 모듈이 만든 Promise에서 오류를 처리한다.
 * 반환 객체가 `catch`를 덮어써도 오류 격리가 우회되지 않는다.
 */
function consumeThenableRejection(thenable: PromiseLike<unknown>): void {
  void new Promise<unknown>((resolve) => {
    resolve(thenable);
  }).catch(ignoreObserverFailure);
}

/**
 * 구독 함수 오류가 생산자의 흐름을 바꾸지 않도록 값을 전달한다. 구독 함수는
 * 현재 호출 안에서 실행하며, 자바스크립트 호출자가 비동기 결과를 돌려줘도 기다리지 않는다.
 *
 * @internal Shared boundary for engine, causality, and adapter notifications.
 */
export function notifyObserver<Value>(observer: Observer<Value>, value: Value): void {
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
