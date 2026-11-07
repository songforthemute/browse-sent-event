import { describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import {
  hasBrowseSentEventCausalityLinkedEvidenceBridge,
  type BrowseSentEventCausalityBridge,
} from "../bridge.js";
import {
  browseSentEventCausalityGlobalKey,
  browseSentEventCausalityLinkedEvidenceCapability,
  browseSentEventCausalityProtocolVersion,
  getBrowseSentEventCausalityAvailability,
  installBrowseSentEventCausalityEnvelope,
  subscribeBrowseSentEventCausalityAvailability,
} from "../global-envelope.js";

function createBridge() {
  return createDevtoolsEngine({ capacity: 1 }).causality;
}

function createLegacyBridge(): BrowseSentEventCausalityBridge {
  return {
    getActiveContext: () => undefined,
    getTrace: () => undefined,
    recordEdge: () => {
      throw new Error("Legacy test bridge does not record evidence.");
    },
    recordNode: () => {
      throw new Error("Legacy test bridge does not record evidence.");
    },
    runWithContext: (_context, callback) => callback(),
    subscribeEvidence: () => () => {},
  };
}

describe("causality global envelope", () => {
  it("notifies an adapter that subscribed before core bootstrap", () => {
    const target = {};
    const states: string[] = [];
    const unsubscribe = subscribeBrowseSentEventCausalityAvailability(
      (availability) => states.push(availability.status),
      target,
    );

    const installed = installBrowseSentEventCausalityEnvelope(target, createBridge());

    expect(states).toEqual(["unavailable", "available"]);
    expect(installed.installed).toBe(true);
    expect(getBrowseSentEventCausalityAvailability(target)).toEqual({
      status: "available",
      envelope: installed.envelope,
    });

    unsubscribe();
  });

  it("does not miss an install triggered by the listener's initial unavailable callback", () => {
    const target = {};
    const states: string[] = [];

    subscribeBrowseSentEventCausalityAvailability((availability) => {
      states.push(availability.status);

      if (availability.status === "unavailable") {
        installBrowseSentEventCausalityEnvelope(target, createBridge());
      }
    }, target);

    expect(states).toEqual(["unavailable", "available"]);
  });

  it("uses a listener snapshot when a listener subscribes during an install notification", () => {
    const target = {};
    const states: string[] = [];

    subscribeBrowseSentEventCausalityAvailability((availability) => {
      states.push(`first:${availability.status}`);

      if (availability.status === "available") {
        subscribeBrowseSentEventCausalityAvailability(
          (next) => states.push(`second:${next.status}`),
          target,
        );
      }
    }, target);

    installBrowseSentEventCausalityEnvelope(target, createBridge());

    expect(states).toEqual(["first:unavailable", "first:available", "second:available"]);
  });

  it("isolates adapter listener errors", () => {
    const target = {};
    const states: string[] = [];

    subscribeBrowseSentEventCausalityAvailability(() => {
      throw new Error("adapter failed");
    }, target);
    subscribeBrowseSentEventCausalityAvailability(
      (availability) => states.push(availability.status),
      target,
    );

    expect(() => installBrowseSentEventCausalityEnvelope(target, createBridge())).not.toThrow();
    expect(states).toEqual(["unavailable", "available"]);
  });

  it("continues availability delivery after an async adapter listener rejects", async () => {
    const target = {};
    const states: string[] = [];

    subscribeBrowseSentEventCausalityAvailability(async () => {
      throw new Error("async adapter failed");
    }, target);
    subscribeBrowseSentEventCausalityAvailability(
      (availability) => states.push(availability.status),
      target,
    );

    expect(() => installBrowseSentEventCausalityEnvelope(target, createBridge())).not.toThrow();

    await Promise.resolve();

    expect(states).toEqual(["unavailable", "available"]);
  });

  it("reuses the compatible first owner and only lets the publishing owner remove it", () => {
    const target = {};
    const first = installBrowseSentEventCausalityEnvelope(target, createBridge());
    const second = installBrowseSentEventCausalityEnvelope(target, createBridge());

    expect(first.installed).toBe(true);
    expect(second.installed).toBe(false);
    expect(second.envelope).toBe(first.envelope);

    second.uninstall();
    expect(Reflect.get(target, browseSentEventCausalityGlobalKey)).toBe(first.envelope);

    first.uninstall();
    expect(Reflect.has(target, browseSentEventCausalityGlobalKey)).toBe(false);
  });

  it("does not overwrite an incompatible protocol and gives adapters a no-op diagnostic", () => {
    const target = {};
    const foreignEnvelope = Object.freeze({
      protocolVersion: browseSentEventCausalityProtocolVersion + 1,
      capabilities: Object.freeze(["bridge-v1"]),
      ownerToken: Symbol("foreign"),
      bridge: createBridge(),
    });
    Reflect.set(target, browseSentEventCausalityGlobalKey, foreignEnvelope);

    const result = installBrowseSentEventCausalityEnvelope(target, createBridge());
    const availability = getBrowseSentEventCausalityAvailability(target);

    expect(result).toMatchObject({
      installed: false,
      availability: { status: "incompatible", reason: "protocol-version" },
    });
    expect(availability).toMatchObject({
      status: "incompatible",
      reason: "protocol-version",
      protocolVersion: browseSentEventCausalityProtocolVersion + 1,
    });
    expect(Reflect.get(target, browseSentEventCausalityGlobalKey)).toBe(foreignEnvelope);
  });

  it("negotiates required capabilities without exposing an incompatible bridge", () => {
    const target = {};
    installBrowseSentEventCausalityEnvelope(target, createBridge());

    expect(
      getBrowseSentEventCausalityAvailability(target, {
        capabilities: ["future-adapter-capability"],
      }),
    ).toMatchObject({ status: "incompatible", reason: "capability" });

    expect(
      getBrowseSentEventCausalityAvailability(target, {
        capabilities: [browseSentEventCausalityLinkedEvidenceCapability],
      }),
    ).toMatchObject({ status: "available" });

    const availability = getBrowseSentEventCausalityAvailability(target, {
      capabilities: [browseSentEventCausalityLinkedEvidenceCapability],
    });

    if (
      availability.status !== "available" ||
      !hasBrowseSentEventCausalityLinkedEvidenceBridge(availability.envelope.bridge)
    ) {
      throw new Error("Expected a linked-evidence bridge.");
    }

    expect(typeof availability.envelope.bridge.recordLinkedNode).toBe("function");
    expect(typeof availability.envelope.bridge.subscribeLinkedEvidence).toBe("function");
  });

  it("keeps a legacy bridge-v1 envelope valid when linked evidence is not requested", () => {
    const target = {};
    const legacyBridge = createLegacyBridge();

    Reflect.set(
      target,
      browseSentEventCausalityGlobalKey,
      Object.freeze({
        protocolVersion: browseSentEventCausalityProtocolVersion,
        capabilities: Object.freeze(["bridge-v1"]),
        ownerToken: Symbol("legacy"),
        bridge: legacyBridge,
      }),
    );

    expect(getBrowseSentEventCausalityAvailability(target)).toMatchObject({ status: "available" });
    expect(
      getBrowseSentEventCausalityAvailability(target, {
        capabilities: [browseSentEventCausalityLinkedEvidenceCapability],
      }),
    ).toMatchObject({ status: "incompatible", reason: "capability" });
  });

  it("advertises only bridge-v1 when core installs a base-only bridge", () => {
    const target = {};
    const installed = installBrowseSentEventCausalityEnvelope(target, createLegacyBridge());

    expect(installed).toMatchObject({
      installed: true,
      envelope: { capabilities: ["bridge-v1"] },
    });
    expect(
      getBrowseSentEventCausalityAvailability(target, {
        capabilities: [browseSentEventCausalityLinkedEvidenceCapability],
      }),
    ).toMatchObject({ status: "incompatible", reason: "capability" });
  });

  it("rejects a linked-evidence capability that lacks the linked bridge method", () => {
    const target = {};
    const legacyBridge = createLegacyBridge();
    Reflect.set(
      target,
      browseSentEventCausalityGlobalKey,
      Object.freeze({
        protocolVersion: browseSentEventCausalityProtocolVersion,
        capabilities: Object.freeze([
          "bridge-v1",
          browseSentEventCausalityLinkedEvidenceCapability,
        ]),
        ownerToken: Symbol("invalid-linked-evidence"),
        bridge: legacyBridge,
      }),
    );

    expect(hasBrowseSentEventCausalityLinkedEvidenceBridge(legacyBridge)).toBe(false);
    expect(
      getBrowseSentEventCausalityAvailability(target, {
        capabilities: [browseSentEventCausalityLinkedEvidenceCapability],
      }),
    ).toMatchObject({ status: "incompatible", reason: "invalid-envelope" });
  });

  it("rejects a linked-evidence capability that lacks the linked subscription", () => {
    const target = {};
    const incompleteBridge = {
      ...createLegacyBridge(),
      recordLinkedNode: () => {
        throw new Error("Incomplete bridge does not record linked evidence.");
      },
    };
    Reflect.set(
      target,
      browseSentEventCausalityGlobalKey,
      Object.freeze({
        protocolVersion: browseSentEventCausalityProtocolVersion,
        capabilities: Object.freeze([
          "bridge-v1",
          browseSentEventCausalityLinkedEvidenceCapability,
        ]),
        ownerToken: Symbol("invalid-linked-subscription"),
        bridge: incompleteBridge,
      }),
    );

    expect(hasBrowseSentEventCausalityLinkedEvidenceBridge(incompleteBridge)).toBe(false);
    expect(
      getBrowseSentEventCausalityAvailability(target, {
        capabilities: [browseSentEventCausalityLinkedEvidenceCapability],
      }),
    ).toMatchObject({ status: "incompatible", reason: "invalid-envelope" });
  });

  it("keeps a later owner intact when a stale owner uninstalls", () => {
    const target = {};
    const first = installBrowseSentEventCausalityEnvelope(target, createBridge());
    const laterOwner = Object.freeze({
      protocolVersion: browseSentEventCausalityProtocolVersion,
      capabilities: Object.freeze(["bridge-v1"]),
      ownerToken: Symbol("later"),
      bridge: createBridge(),
    });
    Reflect.set(target, browseSentEventCausalityGlobalKey, laterOwner);

    first.uninstall();

    expect(Reflect.get(target, browseSentEventCausalityGlobalKey)).toBe(laterOwner);
  });

  it("leaves foreign non-configurable globals untouched and does not publish a false update", () => {
    const target = {};
    const states: string[] = [];
    subscribeBrowseSentEventCausalityAvailability(
      (availability) => states.push(availability.status),
      target,
    );
    Object.defineProperty(target, browseSentEventCausalityGlobalKey, {
      configurable: false,
      value: undefined,
      writable: true,
    });

    const result = installBrowseSentEventCausalityEnvelope(target, createBridge());

    expect(result).toMatchObject({
      installed: false,
      availability: { status: "incompatible", reason: "installation-failed" },
    });
    expect(Reflect.get(target, browseSentEventCausalityGlobalKey)).toBeUndefined();
    expect(states).toEqual(["unavailable", "incompatible"]);
  });

  it("falls back without mutating a frozen foreign global", () => {
    const target = Object.freeze({});
    const states: string[] = [];
    subscribeBrowseSentEventCausalityAvailability(
      (availability) => states.push(availability.status),
      target,
    );

    const result = installBrowseSentEventCausalityEnvelope(target, createBridge());

    expect(result).toMatchObject({
      installed: false,
      availability: { status: "incompatible", reason: "installation-failed" },
    });
    expect(Reflect.has(target, browseSentEventCausalityGlobalKey)).toBe(false);
    expect(states).toEqual(["unavailable"]);
  });

  it("treats hostile discovery accessors as incompatible without throwing", () => {
    const target = new Proxy(
      {},
      {
        get() {
          throw new Error("foreign getter");
        },
      },
    );

    expect(() => getBrowseSentEventCausalityAvailability(target)).not.toThrow();
    expect(getBrowseSentEventCausalityAvailability(target)).toMatchObject({
      status: "incompatible",
      reason: "invalid-envelope",
    });
    expect(() => installBrowseSentEventCausalityEnvelope(target, createBridge())).not.toThrow();
  });
});
