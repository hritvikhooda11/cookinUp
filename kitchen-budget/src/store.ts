// Zustand slice for the pantry manager (the outline's frontend state is Zustand).
// No zustand import: combine it into the app's store with the slices pattern:
//
//   const useKitchen = create<KitchenState & BudgetSlice>()((set, get, api) => ({
//     ...kitchenSlice(set, get, api),
//     ...createBudgetSlice(set, get),
//   }));

import { allocate, type Allocation, type BudgetMode, type StationBudgetInput } from "./allocate";
import { CLAUDE_PRICES, estimateCost, type KitchenCost, type ModelPrice } from "./cost";
import { cycleEffort, type Effort } from "./effort";
import { applySuggestions, suggestTuning, type StationUsage, type Suggestion } from "./optimize";
import { stationsFromMenu } from "./schema";

export interface BudgetSlice {
  budgetStations: StationBudgetInput[];
  totalBudget: number;
  budgetMode: BudgetMode;
  prices: Record<string, ModelPrice>;
  /** Derived; recomputed on every change. Pass allocation.byId[id].maxTokensPerPass as max_tokens. */
  allocation: Allocation;
  estimate: KitchenCost;
  suggestions: Suggestion[];

  /** Call on menu_ready. */
  loadMenu: (menu: unknown, totalBudget?: number) => void;
  setEffort: (id: string, effort: Effort) => void;
  /** Double-click a chef: Light prep -> Normal -> Double shift -> All hands -> Light prep. */
  boostStation: (id: string) => void;
  setLocked: (id: string, locked: boolean) => void;
  setStationModel: (id: string, model: string) => void;
  setTokenBudget: (id: string, tokens: number) => void;
  setTotalBudget: (tokens: number) => void;
  setBudgetMode: (mode: BudgetMode) => void;
  setPrices: (prices: Record<string, ModelPrice>) => void;
  /** Call after plating_done with each station's real usage. */
  recordUsage: (usage: StationUsage[]) => void;
  applyTuning: () => void;
}

// Structural stand-ins for zustand's set/get, so this file needs no zustand import.
type SetBudget = (partial: Partial<BudgetSlice>) => void;
type GetBudget = () => BudgetSlice;

export const DEFAULT_TOTAL_BUDGET = 8000;

type BudgetInputs = Pick<BudgetSlice, "budgetStations" | "totalBudget" | "budgetMode" | "prices">;

function derive(s: BudgetInputs) {
  const allocation = allocate(s.budgetStations, { totalBudget: s.totalBudget, mode: s.budgetMode });
  return { allocation, estimate: estimateCost(s.budgetStations, allocation, s.prices) };
}

export function createBudgetSlice(set: SetBudget, get: GetBudget): BudgetSlice {
  const inputs = (): BudgetInputs => {
    const s = get();
    return { budgetStations: s.budgetStations, totalBudget: s.totalBudget, budgetMode: s.budgetMode, prices: s.prices };
  };
  // Every change to the inputs recomputes the allocation and drops stale tuning tips.
  const change = (patch: Partial<BudgetInputs>) => {
    const next = { ...inputs(), ...patch };
    set({ ...patch, ...derive(next), suggestions: [] });
  };
  const patchStation = (id: string, patch: Partial<StationBudgetInput>) =>
    change({ budgetStations: get().budgetStations.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const initial: BudgetInputs = { budgetStations: [], totalBudget: DEFAULT_TOTAL_BUDGET, budgetMode: "fixed", prices: CLAUDE_PRICES };

  return {
    ...initial,
    ...derive(initial),
    suggestions: [],

    loadMenu: (menu, totalBudget) =>
      change({ budgetStations: stationsFromMenu(menu), ...(totalBudget ? { totalBudget } : {}) }),
    setEffort: (id, effort) => patchStation(id, { effort }),
    boostStation: (id) => {
      const s = get().budgetStations.find((x) => x.id === id);
      if (s) patchStation(id, { effort: cycleEffort(s.effort) });
    },
    setLocked: (id, locked) => patchStation(id, { locked }),
    setStationModel: (id, model) => patchStation(id, { model }),
    setTokenBudget: (id, tokens) => patchStation(id, { token_budget: Math.max(1, Math.round(tokens)) }),
    setTotalBudget: (tokens) => change({ totalBudget: Math.max(0, Math.round(tokens)) }),
    setBudgetMode: (budgetMode) => change({ budgetMode }),
    setPrices: (prices) => change({ prices }),
    recordUsage: (usage) =>
      set({ suggestions: suggestTuning(get().budgetStations, get().allocation, usage) }),
    applyTuning: () => change({ budgetStations: applySuggestions(get().budgetStations, get().suggestions) }),
  };
}
