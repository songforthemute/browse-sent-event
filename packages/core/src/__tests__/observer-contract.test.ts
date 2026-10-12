import { describe, expectTypeOf, it } from "vitest";
import { createBrowseSentEventCausalityBridge } from "../causality/bridge.js";
import { subscribeBrowseSentEventCausalityAvailability } from "../causality/global-envelope.js";
import { createDevtoolsEngine } from "../runtime/engine.js";
import type {
  BrowseSentEventCausalityAvailabilityListener,
  BrowseSentEventEngineSubscriber,
  CausalityGraphDeltaListener,
  CausalityLinkedEvidenceGraphDeltaListener,
} from "../index.js";

interface PublicObservers {
  engine: BrowseSentEventEngineSubscriber;
  availability: BrowseSentEventCausalityAvailabilityListener;
  evidence: CausalityGraphDeltaListener;
  linkedEvidence: CausalityLinkedEvidenceGraphDeltaListener;
}

const separatelyDeclared = (value: unknown) => {
  void value;
};
const explicitlyVoid = (value: unknown): void => {
  void value;
};
const asynchronous = async () => undefined;
const promiseReturning = () => Promise.resolve();
const sometimesAsynchronous = (): void | Promise<void> => undefined;
const valueReturning = () => 1;

describe("public subscription types", () => {
  it("accepts contextual, separately declared, and explicitly void callbacks", () => {
    const inline: PublicObservers = {
      engine: (snapshot) => {
        void snapshot.messages;
      },
      availability: (availability) => {
        void availability.status;
      },
      evidence: (delta) => {
        void delta.type;
      },
      linkedEvidence: (delta) => {
        void delta.type;
      },
    };
    const inferred: PublicObservers = {
      engine: separatelyDeclared,
      availability: separatelyDeclared,
      evidence: separatelyDeclared,
      linkedEvidence: separatelyDeclared,
    };
    const annotated: PublicObservers = {
      engine: explicitlyVoid,
      availability: explicitlyVoid,
      evidence: explicitlyVoid,
      linkedEvidence: explicitlyVoid,
    };

    const engine = createDevtoolsEngine({ capacity: 1 });
    const bridge = createBrowseSentEventCausalityBridge();
    const target = {};

    for (const observers of [inline, inferred, annotated]) {
      const unsubscribe = [
        engine.subscribe(observers.engine),
        bridge.subscribeEvidence(observers.evidence),
        bridge.subscribeLinkedEvidence(observers.linkedEvidence),
        subscribeBrowseSentEventCausalityAvailability(observers.availability, target),
      ];

      for (const stop of unsubscribe) {
        stop();
      }
    }

    expectTypeOf(inline).toEqualTypeOf<PublicObservers>();
    expectTypeOf(inferred).toEqualTypeOf<PublicObservers>();
    expectTypeOf(annotated).toEqualTypeOf<PublicObservers>();
  });

  it("rejects callbacks whose return types expose asynchronous results or values", () => {
    const asynchronousAliases: PublicObservers = {
      // @ts-expect-error 비동기 함수는 공개 구독 함수로 선언할 수 없다.
      engine: asynchronous,
      // @ts-expect-error 비동기 함수는 공개 구독 함수로 선언할 수 없다.
      availability: asynchronous,
      // @ts-expect-error 비동기 함수는 공개 구독 함수로 선언할 수 없다.
      evidence: asynchronous,
      // @ts-expect-error 비동기 함수는 공개 구독 함수로 선언할 수 없다.
      linkedEvidence: asynchronous,
    };
    const promiseAliases: PublicObservers = {
      // @ts-expect-error 비동기 결과를 반환하는 함수는 받을 수 없다.
      engine: promiseReturning,
      // @ts-expect-error 비동기 결과를 반환하는 함수는 받을 수 없다.
      availability: promiseReturning,
      // @ts-expect-error 비동기 결과를 반환하는 함수는 받을 수 없다.
      evidence: promiseReturning,
      // @ts-expect-error 비동기 결과를 반환하는 함수는 받을 수 없다.
      linkedEvidence: promiseReturning,
    };
    const mixedAliases: PublicObservers = {
      // @ts-expect-error 비동기 결과를 반환할 가능성이 있는 함수는 받을 수 없다.
      engine: sometimesAsynchronous,
      // @ts-expect-error 비동기 결과를 반환할 가능성이 있는 함수는 받을 수 없다.
      availability: sometimesAsynchronous,
      // @ts-expect-error 비동기 결과를 반환할 가능성이 있는 함수는 받을 수 없다.
      evidence: sometimesAsynchronous,
      // @ts-expect-error 비동기 결과를 반환할 가능성이 있는 함수는 받을 수 없다.
      linkedEvidence: sometimesAsynchronous,
    };
    const valueAliases: PublicObservers = {
      // @ts-expect-error 반환형에 일반 값이 드러나는 함수는 받을 수 없다.
      engine: valueReturning,
      // @ts-expect-error 반환형에 일반 값이 드러나는 함수는 받을 수 없다.
      availability: valueReturning,
      // @ts-expect-error 반환형에 일반 값이 드러나는 함수는 받을 수 없다.
      evidence: valueReturning,
      // @ts-expect-error 반환형에 일반 값이 드러나는 함수는 받을 수 없다.
      linkedEvidence: valueReturning,
    };

    void asynchronousAliases;
    void promiseAliases;
    void mixedAliases;
    void valueAliases;
  });
});
