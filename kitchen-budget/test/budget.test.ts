import { describe, expect, it } from "vitest";
import {
  allocate,
  applySuggestions,
  cookStation,
  cycleEffort,
  estimateCost,
  fitProportional,
  suggestTuning,
  type CallModel,
  type StationBudgetInput,
} from "../src";

const kitchen = (): StationBudgetInput[] => [
  { id: "food", title: "Food spots", depends_on: [], model: "claude-sonnet-5-5", token_budget: 1500, effort: "normal" },
  { id: "budget", title: "Budget", depends_on: [], model: "claude-haiku-5-5", token_budget: 1000, effort: "normal" },
  { id: "map", title: "Map", depends_on: [], model: "claude-haiku-5-5", token_budget: 1000, effort: "normal" },
  { id: "itin", title: "Itinerary", depends_on: ["food", "budget", "map"], model: "claude-sonnet-5-5", token_budget: 2500, effort: "normal" },
];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("fitProportional", () => {
  it("returns desired when it fits", () => {
    expect(fitProportional([{ desired: 100, floor: 10 }, { desired: 200, floor: 10 }], 500)).toEqual([100, 200]);
  });
  it("scales down proportionally and respects floors", () => {
    expect(fitProportional([{ desired: 1000, floor: 400 }, { desired: 3000, floor: 400 }], 2000)).toEqual([500, 1500]);
    const out = fitProportional([{ desired: 500, floor: 400 }, { desired: 3500, floor: 400 }], 2000);
    expect(out).toEqual([400, 1600]);
    expect(sum(out)).toBeLessThanOrEqual(2000);
  });
});

describe("allocate", () => {
  it("gives everyone their base budget at normal effort", () => {
    const a = allocate(kitchen(), { totalBudget: 6000 });
    expect(a.stations.map((s) => s.budget)).toEqual([1500, 1000, 1000, 2500]);
    expect(a.reserve).toBe(0);
    expect(a.warnings).toEqual([]);
  });

  it("double shift doubles one chef and squeezes the others in fixed mode", () => {
    const k = kitchen();
    k[3]!.effort = "double";
    const a = allocate(k, { totalBudget: 6000 });
    // Wants 5000, but the other three keep half their portion (750 + 500 + 500): 6000 - 1750.
    expect(a.byId.itin!.budget).toBe(4250);
    expect(a.byId.itin!.apiEffort).toBe("high");
    expect(a.allocated).toBeLessThanOrEqual(6000);
    for (const id of ["food", "budget", "map"]) {
      expect(a.byId[id]!.budget).toBeGreaterThanOrEqual(400);
      expect(a.byId[id]!.squeezedBy).toBeGreaterThan(0);
    }
  });

  it("with protectShare 0, a boost can take everyone else down to their floor", () => {
    const k = kitchen();
    k[3]!.effort = "max"; // wants 10000
    const a = allocate(k, { totalBudget: 6000, protectShare: 0 });
    expect(a.byId.itin!.budget).toBe(6000 - 3 * 400);
    expect(a.byId.itin!.passes).toBe(2);
    expect(a.byId.itin!.maxTokensPerPass).toBe(2400);
    expect(a.warnings.some((w) => w.includes("Itinerary"))).toBe(true);
  });

  it("by default a boost takes at most half of anyone else's portion", () => {
    const k = kitchen();
    k[3]!.effort = "max";
    const a = allocate(k, { totalBudget: 8000 });
    expect(a.byId.food!.budget).toBe(750);
    expect(a.byId.budget!.budget).toBe(500);
    expect(a.byId.map!.budget).toBe(500);
    expect(a.byId.itin!.budget).toBe(6250);
    expect(a.warnings.some((w) => w.includes("Itinerary"))).toBe(true);
  });

  it("flex mode grows the total and reports the overage", () => {
    const k = kitchen();
    k[0]!.effort = "double";
    const a = allocate(k, { totalBudget: 6000, mode: "flex" });
    expect(a.byId.food!.budget).toBe(3000);
    expect(a.byId.budget!.budget).toBe(1000);
    expect(a.overBy).toBe(1500);
  });

  it("light effort frees ingredients into the reserve", () => {
    const k = kitchen();
    k[1]!.effort = "light";
    const a = allocate(k, { totalBudget: 6000 });
    expect(a.byId.budget!.budget).toBe(500);
    expect(a.reserve).toBe(500);
  });

  it("un-boosting restores every station exactly", () => {
    const before = allocate(kitchen(), { totalBudget: 6000 });
    const k = kitchen();
    k[2]!.effort = "max";
    allocate(k, { totalBudget: 6000 });
    k[2]!.effort = "normal";
    expect(allocate(k, { totalBudget: 6000 })).toEqual(before);
  });

  it("locked stations are not squeezed", () => {
    const k = kitchen();
    k[1]!.locked = true;
    k[3]!.effort = "double";
    const a = allocate(k, { totalBudget: 6000 });
    expect(a.byId.budget!.budget).toBe(1000);
    expect(a.byId.itin!.budget).toBe(6000 - 1000 - 750 - 500);
    expect(a.allocated).toBeLessThanOrEqual(6000);
  });

  it("a moderate boost in a roomy kitchen gets its full ask", () => {
    const k = kitchen();
    k[1]!.effort = "double"; // 1000 -> 2000
    const a = allocate(k, { totalBudget: 8000 });
    expect(a.byId.budget!.budget).toBe(2000);
    expect(a.reserve).toBe(1000);
  });

  it("warns when even minimum portions do not fit", () => {
    const a = allocate(kitchen(), { totalBudget: 1000 });
    expect(a.stations.every((s) => s.budget === 400)).toBe(true);
    expect(a.overBy).toBe(600);
    expect(a.warnings.length).toBeGreaterThan(0);
  });
});

describe("cycleEffort", () => {
  it("cycles light -> normal -> double -> max -> light", () => {
    expect(cycleEffort("light")).toBe("normal");
    expect(cycleEffort("normal")).toBe("double");
    expect(cycleEffort("double")).toBe("max");
    expect(cycleEffort("max")).toBe("light");
  });
});

describe("estimateCost", () => {
  it("prices output at the budget and counts upstream output as input", () => {
    const k = kitchen();
    const a = allocate(k, { totalBudget: 6000 });
    const c = estimateCost(k, a);
    expect(c.byId.itin!.inputTokens).toBe(600 + 1500 + 1000 + 1000);
    // Sonnet 5.5: $2 in / $10 out per MTok
    expect(c.byId.itin!.usd).toBeCloseTo((4100 * 2 + 2500 * 10) / 1e6);
    expect(c.unpricedModels).toEqual([]);
  });
  it("flags models with no price", () => {
    const k = kitchen();
    k[0]!.model = "gpt-something";
    const c = estimateCost(k, allocate(k, { totalBudget: 6000 }));
    expect(c.byId.food!.usd).toBeNull();
    expect(c.unpricedModels).toEqual(["gpt-something"]);
  });
});

describe("suggestTuning", () => {
  it("grows truncated chefs, bumps sent-back chefs, trims leftovers", () => {
    const k = kitchen();
    const a = allocate(k, { totalBudget: 6000 });
    const s = suggestTuning(k, a, [
      { stationId: "food", outputTokens: 1500, truncated: true },
      { stationId: "budget", outputTokens: 900, truncated: false, conflicted: true },
      { stationId: "map", outputTokens: 200, truncated: false },
      { stationId: "itin", outputTokens: 2000, truncated: false },
    ]);
    expect(s.map((x) => [x.stationId, x.kind])).toEqual([
      ["food", "more-ingredients"],
      ["budget", "work-harder"],
      ["map", "trim"],
    ]);
    const next = applySuggestions(k, s);
    expect(next[0]!.token_budget).toBe(2300);
    expect(next[1]!.effort).toBe("double");
    expect(next[2]!.token_budget).toBe(400);
  });
});

describe("cookStation", () => {
  const alloc = (passes: number) => ({
    id: "x", effort: "max" as const, apiEffort: "xhigh" as const, passes,
    desired: 4000, budget: 4000, maxTokensPerPass: 4000 / passes, squeezedBy: 0, priority: true,
  });

  it("runs a taste-and-fix pass with the previous output", async () => {
    const prompts: string[] = [];
    const call: CallModel = async (req) => {
      prompts.push(req.prompt);
      return { text: `dish v${req.pass}`, inputTokens: 100, outputTokens: 50, truncated: false };
    };
    const r = await cookStation(alloc(2), "Cook pasta", call);
    expect(r.text).toBe("dish v2");
    expect(r.outputTokens).toBe(100);
    expect(prompts[1]).toContain("dish v1");
    expect(prompts[1]).toContain("Taste it");
  });

  it("keeps the finished dish when the refinement is cut off", async () => {
    const call: CallModel = async (req) => ({
      text: `dish v${req.pass}`, inputTokens: 100, outputTokens: 50, truncated: req.pass === 2,
    });
    const r = await cookStation(alloc(2), "Cook pasta", call);
    expect(r.text).toBe("dish v1");
    expect(r.truncated).toBe(false);
    expect(r.passes.length).toBe(2);
  });
});
