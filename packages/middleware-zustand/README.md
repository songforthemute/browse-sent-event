# @browse-sent-event/middleware-zustand

Opt-in Zustand middleware for the M1 causality truth spike. It observes only a
`set` that runs in the synchronous handler context published by
`@browse-sent-event/core`.

```ts
import { create } from "zustand";
import { traceZustand } from "@browse-sent-event/middleware-zustand";

const trace = traceZustand({ storeId: "trades" });

export const useTrades = create(
  trace((set) => ({
    trades: [],
    append: (trade) => set((state) => ({ trades: [...state.trades, trade] })),
  })),
);

// Call on hot-module disposal when the middleware is no longer used.
trace.dispose();
```

## Evidence contract

When core is available and `set` runs in an active synchronous handler context,
the middleware records `zustand.set-started` and `zustand.set-completed` with
definitive `same-call-stack` edges. A `state.root-changed` node is recorded only
when `Object.is(beforeState, afterState)` is false. Evidence contains `storeId`,
`replace`, a boolean root-identity result, and an optional third-argument string
action label; it never contains state values or top-level key comparisons.

Handler-external updates, unavailable/incompatible core, a disposed middleware,
and bridge errors use the original setter without a causality assertion.

The canonical setter passed to the Zustand initializer and the `api.setState`
present during initialization are wrapped. Calls preserve all original
arguments, `this`, return values, and thrown application errors. Other
middleware that replaces `api.setState` after this middleware has initialized is
outside the M1 guarantee. The public type intentionally accepts canonical
Zustand vanilla creators only; mutator middleware composition is deferred until
its wrapper order has a dedicated compatibility contract. Place `traceZustand`
closest to the canonical Zustand store when that composition needs tracing. The
same native setter is wrapped by one shared function, and nested `traceZustand`
instances detect that wrapper to avoid duplicate evidence; the first wrapper
owns the observed store ID and lifecycle. The
virtual-module production-removal path is intentionally not part of this M1
package.
