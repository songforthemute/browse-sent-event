import type { BrowseSentEventCausalityBridge } from "./bridge.js";

/**
 * The stable discovery key for framework adapters. The value is deliberately an
 * envelope rather than a runtime: adapters only receive the causality bridge.
 */
export const browseSentEventCausalityGlobalKey: symbol = Symbol.for("@browse-sent-event/causality");

const availabilityRegistryKey = Symbol.for("@browse-sent-event/causality/availability-registry");

export const browseSentEventCausalityProtocolVersion = 1;

export const browseSentEventCausalityBridgeCapability = "bridge-v1";

export type BrowseSentEventCausalityCapability = typeof browseSentEventCausalityBridgeCapability;

export interface BrowseSentEventCausalityEnvelope {
  readonly protocolVersion: number;
  /** Open set so newer owners can advertise capabilities in addition to bridge-v1. */
  readonly capabilities: readonly string[];
  /** Opaque identity used only to make teardown ownership-safe. */
  readonly ownerToken: symbol;
  readonly bridge: BrowseSentEventCausalityBridge;
}

export type BrowseSentEventCausalityAvailability =
  | {
      readonly status: "available";
      readonly envelope: BrowseSentEventCausalityEnvelope;
    }
  | {
      readonly status: "unavailable";
    }
  | {
      readonly status: "incompatible";
      readonly reason:
        | "invalid-envelope"
        | "protocol-version"
        | "capability"
        | "installation-failed";
      readonly protocolVersion?: number;
      readonly capabilities?: readonly string[];
    };

export interface BrowseSentEventCausalityAvailabilityOptions {
  readonly protocolVersion?: number;
  readonly capabilities?: readonly string[];
}

export type BrowseSentEventCausalityAvailabilityListener = (
  availability: BrowseSentEventCausalityAvailability,
) => void;

export interface InstalledBrowseSentEventCausalityEnvelope {
  readonly availability: BrowseSentEventCausalityAvailability;
  readonly envelope?: BrowseSentEventCausalityEnvelope;
  readonly installed: boolean;
  /** Idempotent. A reused or superseded owner never removes another owner's envelope. */
  uninstall(): void;
}

interface AvailabilityRegistry {
  readonly listeners: Set<BrowseSentEventCausalityAvailabilityListener>;
}

function isAvailabilityListenerSet(
  value: unknown,
): value is Set<BrowseSentEventCausalityAvailabilityListener> {
  return (
    value instanceof Set && Array.from(value).every((listener) => typeof listener === "function")
  );
}

function hasBridgeSurface(value: unknown): value is BrowseSentEventCausalityBridge {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return [
    "getActiveContext",
    "runWithContext",
    "recordNode",
    "recordEdge",
    "getTrace",
    "subscribeEvidence",
  ].every((key) => typeof Reflect.get(value, key) === "function");
}

function isEnvelope(value: unknown): value is BrowseSentEventCausalityEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  try {
    const capabilities = Reflect.get(value, "capabilities");

    return (
      Number.isInteger(Reflect.get(value, "protocolVersion")) &&
      typeof Reflect.get(value, "ownerToken") === "symbol" &&
      Array.isArray(capabilities) &&
      capabilities.every((capability) => typeof capability === "string") &&
      hasBridgeSurface(Reflect.get(value, "bridge"))
    );
  } catch {
    return false;
  }
}

function getRegistry(target: object): AvailabilityRegistry | undefined {
  let current: unknown;

  try {
    current = Reflect.get(target, availabilityRegistryKey);
  } catch {
    return undefined;
  }

  try {
    const listeners =
      typeof current === "object" && current !== null
        ? Reflect.get(current, "listeners")
        : undefined;

    if (typeof current === "object" && current !== null && isAvailabilityListenerSet(listeners)) {
      return { listeners };
    }
  } catch {
    return undefined;
  }

  const registry: AvailabilityRegistry = {
    listeners: new Set<BrowseSentEventCausalityAvailabilityListener>(),
  };

  try {
    if (!Reflect.set(target, availabilityRegistryKey, registry)) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  try {
    return Reflect.get(target, availabilityRegistryKey) === registry ? registry : undefined;
  } catch {
    return undefined;
  }
}

function requestedCapabilities(
  options: BrowseSentEventCausalityAvailabilityOptions,
): readonly string[] {
  return options.capabilities ?? [browseSentEventCausalityBridgeCapability];
}

function readAvailability(
  target: object,
  options: BrowseSentEventCausalityAvailabilityOptions = {},
): BrowseSentEventCausalityAvailability {
  let value: unknown;

  try {
    value = Reflect.get(target, browseSentEventCausalityGlobalKey);
  } catch {
    return { status: "incompatible", reason: "invalid-envelope" };
  }

  if (value === undefined) {
    return { status: "unavailable" };
  }

  try {
    if (!isEnvelope(value)) {
      return { status: "incompatible", reason: "invalid-envelope" };
    }

    const expectedProtocolVersion =
      options.protocolVersion ?? browseSentEventCausalityProtocolVersion;

    if (value.protocolVersion !== expectedProtocolVersion) {
      return {
        status: "incompatible",
        reason: "protocol-version",
        protocolVersion: value.protocolVersion,
        capabilities: value.capabilities,
      };
    }

    if (
      !requestedCapabilities(options).every((capability) => value.capabilities.includes(capability))
    ) {
      return {
        status: "incompatible",
        reason: "capability",
        protocolVersion: value.protocolVersion,
        capabilities: value.capabilities,
      };
    }

    return { status: "available", envelope: value };
  } catch {
    return { status: "incompatible", reason: "invalid-envelope" };
  }
}

function notifyAvailability(
  target: object,
  availability: BrowseSentEventCausalityAvailability = readAvailability(target),
): void {
  const registry = getRegistry(target);

  if (!registry) {
    return;
  }

  const listeners = Array.from(registry.listeners);

  for (const listener of listeners) {
    try {
      listener(availability);
    } catch {
      // Adapter failures must not alter the app or runtime installation path.
    }
  }
}

/**
 * Returns the adapter-facing bridge envelope only when its protocol and required
 * capabilities are compatible. Adapters should use this accessor instead of
 * reading legacy runtime globals or engine internals.
 */
export function getBrowseSentEventCausalityAvailability(
  target: object = globalThis,
  options: BrowseSentEventCausalityAvailabilityOptions = {},
): BrowseSentEventCausalityAvailability {
  return readAvailability(target, options);
}

/**
 * Registers before or after core bootstrap. The current availability state is
 * delivered synchronously, then every envelope install/removal is delivered.
 */
export function subscribeBrowseSentEventCausalityAvailability(
  listener: BrowseSentEventCausalityAvailabilityListener,
  target: object = globalThis,
  options: BrowseSentEventCausalityAvailabilityOptions = {},
): () => void {
  const registry = getRegistry(target);

  if (!registry) {
    try {
      listener(readAvailability(target, options));
    } catch {
      // The adapter owns its callback errors; discovery remains best-effort.
    }

    return () => {};
  }

  const scopedListener: BrowseSentEventCausalityAvailabilityListener = (availability) => {
    try {
      const current =
        availability.status === "available" ? readAvailability(target, options) : availability;
      listener(current);
    } catch {
      // Adapter failures must not break later listeners.
    }
  };
  registry.listeners.add(scopedListener);

  try {
    scopedListener(readAvailability(target));
  } catch {
    // The adapter owns its callback errors; discovery remains best-effort.
  }

  return () => {
    registry.listeners.delete(scopedListener);
  };
}

/** @internal Core bootstrap ownership boundary; adapters only use the accessor above. */
export function installBrowseSentEventCausalityEnvelope(
  target: object,
  bridge: BrowseSentEventCausalityBridge,
): InstalledBrowseSentEventCausalityEnvelope {
  const current = readAvailability(target);

  if (current.status === "available") {
    return {
      availability: current,
      envelope: current.envelope,
      installed: false,
      uninstall() {},
    };
  }

  if (current.status === "incompatible") {
    return {
      availability: current,
      installed: false,
      uninstall() {},
    };
  }

  const envelope: BrowseSentEventCausalityEnvelope = Object.freeze({
    protocolVersion: browseSentEventCausalityProtocolVersion,
    capabilities: Object.freeze([browseSentEventCausalityBridgeCapability]),
    ownerToken: Symbol("browse-sent-event-causality-owner"),
    bridge,
  });

  const failure = (): InstalledBrowseSentEventCausalityEnvelope => {
    const availability: BrowseSentEventCausalityAvailability = {
      status: "incompatible",
      reason: "installation-failed",
    };
    notifyAvailability(target, availability);
    return {
      availability,
      installed: false,
      uninstall() {},
    };
  };

  let existingDescriptor: PropertyDescriptor | undefined;

  try {
    existingDescriptor = Object.getOwnPropertyDescriptor(target, browseSentEventCausalityGlobalKey);
  } catch {
    return failure();
  }

  if (existingDescriptor && !existingDescriptor.configurable) {
    return failure();
  }

  try {
    if (!Reflect.set(target, browseSentEventCausalityGlobalKey, envelope)) {
      return failure();
    }
  } catch {
    return failure();
  }

  try {
    if (Reflect.get(target, browseSentEventCausalityGlobalKey) !== envelope) {
      return failure();
    }
  } catch {
    return failure();
  }

  try {
    if (!Object.getOwnPropertyDescriptor(target, browseSentEventCausalityGlobalKey)?.configurable) {
      return failure();
    }
  } catch {
    return failure();
  }

  notifyAvailability(target);
  let uninstalled = false;

  return {
    availability: { status: "available", envelope },
    envelope,
    installed: true,
    uninstall() {
      if (uninstalled) {
        return;
      }

      uninstalled = true;

      let installedEnvelope: unknown;

      try {
        installedEnvelope = Reflect.get(target, browseSentEventCausalityGlobalKey);
      } catch {
        return;
      }

      if (
        installedEnvelope !== envelope ||
        !isEnvelope(installedEnvelope) ||
        installedEnvelope.ownerToken !== envelope.ownerToken
      ) {
        return;
      }

      try {
        if (!Reflect.deleteProperty(target, browseSentEventCausalityGlobalKey)) {
          return;
        }

        notifyAvailability(target);
      } catch {
        // A host object may reject deletion. Keep the owner published in that case.
      }
    },
  };
}
