import { expectTypeOf } from "vitest";
import type {
  BrowseSentEventCausalityAvailability,
  BrowseSentEventCausalityAvailabilityListener,
  BrowseSentEventCausalityBridge,
  BrowseSentEventCausalityLinkedEvidenceBridge,
  BrowseSentEventEngine,
  BrowseSentEventEngineSnapshot,
  BrowseSentEventEngineSubscriber,
  CausalityGraphDelta,
  CausalityGraphDeltaListener,
  CausalityLinkedEvidenceGraphDelta,
  CausalityLinkedEvidenceGraphDeltaListener,
  subscribeBrowseSentEventCausalityAvailability,
} from "../index.js";

// The core tsconfig includes this compile-only test in the package typecheck.
type ObserverContract = [
  (snapshot: BrowseSentEventEngineSnapshot) => void,
  (availability: BrowseSentEventCausalityAvailability) => void,
  (delta: CausalityGraphDelta) => void,
  (delta: CausalityLinkedEvidenceGraphDelta) => void,
];

type PublicListeners = [
  BrowseSentEventEngineSubscriber,
  BrowseSentEventCausalityAvailabilityListener,
  CausalityGraphDeltaListener,
  CausalityLinkedEvidenceGraphDeltaListener,
];

type SubscriptionParameters = [
  Parameters<BrowseSentEventEngine["subscribe"]>[0],
  Parameters<typeof subscribeBrowseSentEventCausalityAvailability>[0],
  Parameters<BrowseSentEventCausalityBridge["subscribeEvidence"]>[0],
  Parameters<BrowseSentEventCausalityLinkedEvidenceBridge["subscribeLinkedEvidence"]>[0],
];

expectTypeOf<PublicListeners>().toEqualTypeOf<ObserverContract>();
expectTypeOf<SubscriptionParameters>().toEqualTypeOf<ObserverContract>();
