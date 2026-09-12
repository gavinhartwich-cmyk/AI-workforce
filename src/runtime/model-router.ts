import type { ModelLane, ModelProvider } from "./types.js";

/**
 * Model Router (spec §36) — maps a lane ("fast" | "strong") to a live
 * provider. Agents declare a lane, never a provider or model id directly,
 * so swapping providers or rebalancing cost/quality later is a router
 * change, not an agent rewrite.
 */
export class ModelRouter {
  private lanes: Map<ModelLane, ModelProvider>;

  constructor(lanes: Record<ModelLane, ModelProvider>) {
    this.lanes = new Map(Object.entries(lanes) as [ModelLane, ModelProvider][]);
  }

  resolve(lane: ModelLane): ModelProvider {
    const provider = this.lanes.get(lane);
    if (!provider) throw new Error(`No model provider configured for lane "${lane}"`);
    return provider;
  }
}
