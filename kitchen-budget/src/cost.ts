// The bill: worst-case cost for each station under an allocation.
//
// Output is bounded by the station's budget. Input is estimated as a fixed prompt
// overhead plus everything the upstream stations may produce, and each later
// taste-and-fix pass also re-reads the previous pass's output.

import type { Allocation, StationBudgetInput } from "./allocate";

export interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

/** Anthropic first-party API list prices (cached 2026-10-06). Add other providers' models here. */
export const CLAUDE_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

export const DEFAULT_PROMPT_OVERHEAD = 600;

export interface StationCost {
  id: string;
  inputTokens: number;
  outputTokens: number;
  /** null when the model has no price in the table. */
  usd: number | null;
}

export interface KitchenCost {
  stations: StationCost[];
  byId: Record<string, StationCost>;
  totalUsd: number;
  unpricedModels: string[];
}

export function estimateCost(
  stations: StationBudgetInput[],
  allocation: Allocation,
  prices: Record<string, ModelPrice> = CLAUDE_PRICES,
  promptOverhead = DEFAULT_PROMPT_OVERHEAD,
): KitchenCost {
  const unpriced = new Set<string>();
  const rows: StationCost[] = stations.map((s) => {
    const a = allocation.byId[s.id];
    if (!a) throw new Error(`No allocation for station ${s.id}`);
    const upstream = s.depends_on.reduce((sum, dep) => sum + (allocation.byId[dep]?.budget ?? 0), 0);
    const firstPassInput = promptOverhead + upstream;
    const laterPassInput = (firstPassInput + a.maxTokensPerPass) * (a.passes - 1);
    const inputTokens = firstPassInput + laterPassInput;
    const outputTokens = a.budget;
    const price = prices[s.model];
    if (!price) unpriced.add(s.model);
    const usd = price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null;
    return { id: s.id, inputTokens, outputTokens, usd };
  });
  return {
    stations: rows,
    byId: Object.fromEntries(rows.map((r) => [r.id, r])),
    totalUsd: rows.reduce((sum, r) => sum + (r.usd ?? 0), 0),
    unpricedModels: [...unpriced],
  };
}
