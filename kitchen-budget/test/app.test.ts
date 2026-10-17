import { describe, expect, it } from "vitest";
import { create } from "zustand";
import {
  billFromRuntime,
  createBudgetSlice,
  pantryLevel,
  stationsFromMenu,
  usageCost,
  type BudgetSlice,
} from "../src";

// The outline's §5 menu example.
const menu = {
  task: "Build a landing page for a bakery",
  stations: [
    { id: "copy", title: "Write the page copy", goal: "Headline, about, menu blurbs", depends_on: [], model: "claude-sonnet-5-5", token_budget: 1500 },
    { id: "design", title: "Choose layout and colours", goal: "Section order, palette, fonts", depends_on: [], model: "gpt-model", token_budget: 1000 },
    { id: "html", title: "Write the HTML/CSS", goal: "Single-file page", depends_on: ["copy", "design"], model: "claude-sonnet-5-5", token_budget: 4000 },
  ],
};

describe("schema", () => {
  it("accepts the outline's menu and starts every chef at Normal", () => {
    const stations = stationsFromMenu(menu);
    expect(stations.map((s) => s.effort)).toEqual(["normal", "normal", "normal"]);
    expect(stations[2]!.token_budget).toBe(4000);
  });
  it("rejects a menu with too many stations", () => {
    const big = { ...menu, stations: Array.from({ length: 7 }, (_, i) => ({ ...menu.stations[0]!, id: `s${i}` })) };
    expect(() => stationsFromMenu(big)).toThrow();
  });
});

describe("pantry", () => {
  const a = { id: "x", effort: "normal" as const, apiEffort: "medium" as const, passes: 1, desired: 1000, budget: 800, maxTokensPerPass: 800, squeezedBy: 200, priority: false };
  it("reports used and remaining ingredients", () => {
    expect(pantryLevel(a, 200)).toEqual({ budget: 800, used: 200, remaining: 600, fraction: 0.25 });
    expect(pantryLevel(a, 5000).fraction).toBe(1);
  });
  it("prices real usage and builds the bill_update payload", () => {
    expect(usageCost("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(usageCost("gpt-model", 10, 10)).toBeNull();
    expect(
      billFromRuntime({
        a: { status: "done", input_tokens: 100, output_tokens: 50, cost_usd: 0.01 },
        b: { status: "cooking", input_tokens: 10, output_tokens: 5, cost_usd: 0.002 },
      }),
    ).toEqual({ total_tokens: 165, total_cost: 0.012 });
  });
});

describe("zustand slice", () => {
  const makeStore = () => create<BudgetSlice>()((set, get) => createBudgetSlice(set, get));

  it("loads a menu and allocates", () => {
    const store = makeStore();
    store.getState().loadMenu(menu, 6500);
    const { allocation, estimate } = store.getState();
    expect(allocation.allocated).toBe(6500);
    expect(estimate.unpricedModels).toEqual(["gpt-model"]);
  });

  it("double-click boost cycles effort and rebalances the others", () => {
    const store = makeStore();
    store.getState().loadMenu(menu, 6500);
    store.getState().boostStation("copy");
    const s = store.getState();
    expect(s.budgetStations[0]!.effort).toBe("double");
    expect(s.allocation.byId.copy!.budget).toBeGreaterThan(1500);
    expect(s.allocation.allocated).toBeLessThanOrEqual(6500);
    expect(s.allocation.byId.html!.squeezedBy).toBeGreaterThan(0);
  });

  it("records usage, suggests tuning and applies it", () => {
    const store = makeStore();
    store.getState().loadMenu(menu, 6500);
    store.getState().recordUsage([{ stationId: "copy", outputTokens: 1500, truncated: true }]);
    expect(store.getState().suggestions[0]!.kind).toBe("more-ingredients");
    store.getState().applyTuning();
    expect(store.getState().budgetStations[0]!.token_budget).toBe(2300);
    expect(store.getState().suggestions).toEqual([]);
  });

  it("hiring a different chef updates the estimate", () => {
    const store = makeStore();
    store.getState().loadMenu(menu, 6500);
    const before = store.getState().estimate.totalUsd;
    store.getState().setStationModel("html", "claude-opus-5-5");
    expect(store.getState().estimate.totalUsd).toBeGreaterThan(before);
  });
});

describe("slice composition", () => {
  it("combines with the app's own kitchen slice", () => {
    interface KitchenState { status: Record<string, string>; setStatus: (id: string, s: string) => void }
    const useKitchen = create<KitchenState & BudgetSlice>()((set, get) => ({
      status: {},
      setStatus: (id, s) => set({ status: { ...get().status, [id]: s } }),
      ...createBudgetSlice(set, get),
    }));
    useKitchen.getState().loadMenu(menu);
    useKitchen.getState().setStatus("copy", "cooking");
    expect(useKitchen.getState().status.copy).toBe("cooking");
    expect(useKitchen.getState().allocation.stations.length).toBe(3);
  });
});
