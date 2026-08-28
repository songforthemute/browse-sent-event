import { describe, expect, it, vi } from "vitest";
import { notifyObserver } from "../observer.js";

function defineOwnThen(promise: Promise<never>, descriptor: PropertyDescriptor): void {
  // oxlint-disable-next-line unicorn/no-thenable -- This test verifies promises with an own then property.
  void Object.defineProperty(promise, "then", descriptor);
}

describe("notifyObserver", () => {
  it("skips promise handling for an observer without a return value", () => {
    const reflectApply = vi.spyOn(Reflect, "apply");

    notifyObserver(() => undefined, "recorded");

    expect(reflectApply).not.toHaveBeenCalled();
    reflectApply.mockRestore();
  });

  it("skips native promise handling for an observer that returns an object", () => {
    const reflectApply = vi.spyOn(Reflect, "apply");

    notifyObserver(() => ({}), "recorded");

    expect(reflectApply).not.toHaveBeenCalled();
    reflectApply.mockRestore();
  });

  it("skips native promise handling for an observer that returns a function", () => {
    const reflectApply = vi.spyOn(Reflect, "apply");

    notifyObserver(() => () => undefined, "recorded");

    expect(reflectApply).not.toHaveBeenCalled();
    reflectApply.mockRestore();
  });

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

  it.each([
    [
      "is missing",
      (promise: Promise<never>) => {
        defineOwnThen(promise, { value: undefined });
      },
    ],
    [
      "is not callable",
      (promise: Promise<never>) => {
        defineOwnThen(promise, { value: 1 });
      },
    ],
    [
      "throws when read",
      (promise: Promise<never>) => {
        defineOwnThen(promise, {
          get() {
            throw new Error("observer-controlled then getter");
          },
        });
      },
    ],
  ])(
    "consumes a rejected native promise whose own then %s",
    async (_description, applyThenShadow) => {
      const rejection = new Error("observer failed");
      const rejectedPromise = Promise.reject(rejection);
      applyThenShadow(rejectedPromise);

      expect(() => notifyObserver(() => rejectedPromise, "recorded")).not.toThrow();

      await Promise.resolve();
    },
  );

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
