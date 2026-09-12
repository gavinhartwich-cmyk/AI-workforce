import { describe, expect, it } from "vitest";
import { detectBottleneck } from "../src/goals/bottleneck-engine.js";
import type { FunnelStageVolume } from "../src/goals/types.js";

const stages: FunnelStageVolume[] = [
  { stage: "prospects_discovered", volume: 100 },
  { stage: "qualified_prospects", volume: 50 },
  { stage: "contacted", volume: 0 }, // nothing has been contacted yet — no outreach agent exists
  { stage: "engaged", volume: 0 },
  { stage: "meeting_booked", volume: 0 },
  { stage: "proposal_sent", volume: 0 },
  { stage: "won", volume: 0 },
];

const rates = {
  "prospects_discovered->qualified_prospects": 0.5,
  "qualified_prospects->contacted": 0.9,
  "contacted->engaged": 0.15,
  "engaged->meeting_booked": 0.3,
  "meeting_booked->proposal_sent": 0.6,
  "proposal_sent->won": 0.3,
};

describe("detectBottleneck", () => {
  it("reports an empty-funnel diagnosis when nothing was discovered", () => {
    const empty = stages.map((s, i) => (i === 0 ? { ...s, volume: 0 } : s));
    const result = detectBottleneck(empty, rates);
    expect(result.primaryBottleneck).toBeNull();
    expect(result.diagnosis).toMatch(/funnel is empty at the top/);
  });

  it("identifies qualified_prospects -> contacted as the bottleneck when outreach hasn't run", () => {
    const result = detectBottleneck(stages, rates);
    expect(result.primaryBottleneck?.fromStage).toBe("qualified_prospects");
    expect(result.primaryBottleneck?.toStage).toBe("contacted");
    expect(result.primaryBottleneck?.actualConversionRate).toBe(0);
    expect(result.primaryBottleneck?.impactOnFinalStage).toBeGreaterThan(0);
  });

  it("falls back to each downstream step's target rate when projecting impact through undefined stages", () => {
    // contacted->engaged, engaged->meeting_booked, etc. all have volumeFrom=0
    // (undefined actual rate) — the projection must still produce a number
    // by assuming those stages perform at their configured target rate.
    const result = detectBottleneck(stages, rates);
    expect(result.primaryBottleneck?.impactOnFinalStage).not.toBeNull();
  });

  it("reports no bottleneck when every conversion already meets its target", () => {
    const healthy: FunnelStageVolume[] = [
      { stage: "prospects_discovered", volume: 100 },
      { stage: "qualified_prospects", volume: 50 }, // 50%, meets target
      { stage: "contacted", volume: 50 }, // 100%, exceeds target
      { stage: "engaged", volume: 20 }, // 40%, exceeds 15% target
      { stage: "meeting_booked", volume: 10 }, // 50%, exceeds 30% target
      { stage: "proposal_sent", volume: 8 }, // 80%, exceeds 60% target
      { stage: "won", volume: 5 }, // 62.5%, exceeds 30% target
    ];
    const result = detectBottleneck(healthy, rates);
    expect(result.primaryBottleneck).toBeNull();
    expect(result.diagnosis).toMatch(/at or above its target/);
  });

  it("picks the single highest-impact step, not just the first underperforming one", () => {
    // Two underperforming steps: contacted->engaged misses its 15% target by
    // a wide margin (~5.1%), engaged->meeting_booked misses its 30% target
    // only slightly (~26.1%) — the first is the far bigger lever even
    // though it isn't the only gap.
    const mixed: FunnelStageVolume[] = [
      { stage: "prospects_discovered", volume: 1000 },
      { stage: "qualified_prospects", volume: 500 }, // 50%, meets target exactly
      { stage: "contacted", volume: 450 }, // 90%, meets target
      { stage: "engaged", volume: 23 }, // ~5.1%, well under the 15% target
      { stage: "meeting_booked", volume: 6 }, // ~26.1%, just under the 30% target
      { stage: "proposal_sent", volume: 4 }, // ~66.7%, exceeds the 60% target
      { stage: "won", volume: 2 }, // 50%, exceeds the 30% target
    ];
    const result = detectBottleneck(mixed, rates);
    expect(result.primaryBottleneck?.fromStage).toBe("contacted");
    expect(result.primaryBottleneck?.toStage).toBe("engaged");
  });
});
