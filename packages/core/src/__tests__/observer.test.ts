import { describe, expect, it } from "vitest";
import { notifyObserver } from "../observer.js";

describe("notifyObserver", () => {
  it("preserves a bound callback receiver without awaiting its result", () => {
    const receiver = { values: [] as string[] };
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const observer = function (this: typeof receiver, value: string): Promise<void> {
      this.values.push(value);
      return pending;
    }.bind(receiver);

    notifyObserver(observer, "recorded");

    expect(receiver.values).toEqual(["recorded"]);
    settle();
  });

  it("consumes a rejected thenable without propagating it to the producer", async () => {
    const rejection = new Error("observer failed");
    const rejectedThenable = {
      // oxlint-disable-next-line unicorn/no-thenable -- This test verifies thenable rejection handling.
      then(_resolve: unknown, reject: (reason: unknown) => unknown) {
        reject(rejection);
      },
    };

    expect(() => notifyObserver(() => rejectedThenable, "recorded")).not.toThrow();

    await Promise.resolve();
  });

  it.each([
    [
      "is missing",
      (promise: Promise<never>) => {
        void Object.defineProperty(promise, "catch", { value: undefined });
      },
    ],
    [
      "is not callable",
      (promise: Promise<never>) => {
        void Object.defineProperty(promise, "catch", { value: 1 });
      },
    ],
    [
      "throws when read",
      (promise: Promise<never>) => {
        void Object.defineProperty(promise, "catch", {
          get() {
            throw new Error("observer-controlled catch getter");
          },
        });
      },
    ],
  ])("consumes a rejected native promise whose own catch %s", async (_description, shadowCatch) => {
    const rejection = new Error("observer failed");
    const rejectedPromise = Promise.reject(rejection);
    shadowCatch(rejectedPromise);

    expect(() => notifyObserver(() => rejectedPromise, "recorded")).not.toThrow();

    await Promise.resolve();
  });

  it("isolates a hostile then getter without changing producer control flow", () => {
    const rejection = new Error("hostile then getter");
    let attempted = false;
    // oxlint-disable-next-line unicorn/no-thenable -- This test verifies a hostile thenable getter.
    const hostileThenable = Object.defineProperty({}, "then", {
      get() {
        attempted = true;
        throw rejection;
      },
    });

    expect(() => notifyObserver(() => hostileThenable, "recorded")).not.toThrow();

    expect(attempted).toBe(true);
  });
});
