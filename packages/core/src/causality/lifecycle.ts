import type { CausalityConfidence, CausalityLifecycle, CausalityTrace } from "./model.js";

const confidenceRank: Readonly<Record<CausalityConfidence, number>> = {
  unavailable: 0,
  heuristic: 1,
  "adapter-backed": 2,
  definitive: 3,
};

export function getWeakestCausalityConfidence(
  confidences: readonly CausalityConfidence[],
): CausalityConfidence {
  if (confidences.length === 0) {
    return "unavailable";
  }

  return confidences.reduce((weakest, confidence) =>
    confidenceRank[confidence] < confidenceRank[weakest] ? confidence : weakest,
  );
}

export function deriveCausalityLifecycle(trace: CausalityTrace): CausalityLifecycle {
  const kinds = new Set(trace.nodes.map((node) => node.kind));

  if (kinds.has("react.commit-observed")) {
    return { status: "commit-candidate-observed", confidence: trace.confidence };
  }

  if (
    kinds.has("state.root-changed") ||
    kinds.has("zustand.set-started") ||
    kinds.has("zustand.set-completed")
  ) {
    return { status: "state-observed", confidence: trace.confidence };
  }

  if (kinds.has("handler.started") || kinds.has("handler.returned")) {
    return { status: "handler-observed", confidence: trace.confidence };
  }

  return { status: "awaiting-handler", confidence: trace.confidence };
}
