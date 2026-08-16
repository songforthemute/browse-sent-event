import { describe, expect, it } from "vitest";
import { createCausalityContextStack } from "../context.js";
import type { CausalityContext } from "../model.js";

describe("createCausalityContextStack", () => {
  it("restores nested synchronous contexts", () => {
    const stack = createCausalityContextStack();
    const outer: CausalityContext = {
      messageId: "message-1",
      activeNodeId: "handler-1",
    };
    const inner: CausalityContext = {
      messageId: "message-2",
      activeNodeId: "handler-2",
    };

    expect(stack.getActiveContext()).toBeUndefined();
    stack.runWithContext(outer, () => {
      expect(stack.getActiveContext()).toBe(outer);
      stack.runWithContext(inner, () => {
        expect(stack.getActiveContext()).toBe(inner);
      });
      expect(stack.getActiveContext()).toBe(outer);
    });
    expect(stack.getActiveContext()).toBeUndefined();
  });

  it("restores the previous context when a callback throws", () => {
    const stack = createCausalityContextStack();
    const context: CausalityContext = {
      messageId: "message-1",
      activeNodeId: "handler-1",
    };
    const failure = new Error("handler failed");

    expect(() =>
      stack.runWithContext(context, () => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(stack.getActiveContext()).toBeUndefined();
  });

  it("pops synchronous context as soon as a Promise is returned", async () => {
    const stack = createCausalityContextStack();
    const context: CausalityContext = {
      messageId: "message-1",
      activeNodeId: "handler-1",
    };
    const callbackResult = stack.runWithContext(context, async () => {
      expect(stack.getActiveContext()).toBe(context);
      await Promise.resolve();
      return stack.getActiveContext();
    });

    expect(stack.getActiveContext()).toBeUndefined();
    await expect(callbackResult).resolves.toBeUndefined();
  });

  it("clears active state and rejects new scopes after disposal", () => {
    const stack = createCausalityContextStack();
    stack.dispose();

    expect(stack.getActiveContext()).toBeUndefined();
    expect(() =>
      stack.runWithContext({ messageId: "message-1", activeNodeId: "handler-1" }, () => undefined),
    ).toThrow("Causality context stack is disposed.");
  });
});
