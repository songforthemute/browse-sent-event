import type { CausalityContext } from "./model.js";

export interface CausalityContextStack {
  getActiveContext(): CausalityContext | undefined;
  runWithContext<T>(context: CausalityContext, callback: () => T): T;
  clear(): void;
  dispose(): void;
}

export function createCausalityContextStack(): CausalityContextStack {
  const stack: CausalityContext[] = [];
  let disposed = false;

  function assertActive(): void {
    if (disposed) {
      throw new Error("Causality context stack is disposed.");
    }
  }

  function getActiveContext(): CausalityContext | undefined {
    return stack.at(-1);
  }

  function runWithContext<T>(context: CausalityContext, callback: () => T): T {
    assertActive();
    stack.push(context);

    try {
      return callback();
    } finally {
      stack.pop();
    }
  }

  function clear(): void {
    stack.length = 0;
  }

  function dispose(): void {
    clear();
    disposed = true;
  }

  return {
    clear,
    dispose,
    getActiveContext,
    runWithContext,
  };
}
