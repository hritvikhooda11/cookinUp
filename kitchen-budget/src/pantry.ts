// Live pantry levels and the real bill, from the station runtime state in the
// app outline (§5): status, input_tokens, output_tokens, cost_usd.

import type { Allocation, StationAllocation } from "./allocate";
import { CLAUDE_PRICES, type KitchenCost, type ModelPrice } from "./cost";

export type StationStatus = "idle" | "waiting" | "cooking" | "done" | "burnt";

export interface StationRuntime {
  status: StationStatus;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface PantryLevel {
  budget: number;
  used: number;
  remaining: number;
  /** used / budget, clamped to 0-1. Drives the pantry bar beside each station. */
  fraction: number;
}

export function pantryLevel(allocation: StationAllocation, outputTokensUsed = 0): PantryLevel {
  const used = Math.max(0, outputTokensUsed);
  return {
    budget: allocation.budget,
    used,
    remaining: Math.max(0, allocation.budget - used),
    fraction: allocation.budget > 0 ? Math.min(1, used / allocation.budget) : 0,
  };
}

/** Dollar cost of one model call. null when the model has no price. */
export function usageCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  prices: Record<string, ModelPrice> = CLAUDE_PRICES,
): number | null {
  const p = prices[model];
  return p ? (inputTokens * p.input + outputTokens * p.output) / 1_000_000 : null;
}

/** Payload of the outline's bill_update event. */
export interface BillUpdate {
  total_tokens: number;
  total_cost: number;
}

export function billFromRuntime(runtimes: Record<string, StationRuntime>): BillUpdate {
  let total_tokens = 0;
  let total_cost = 0;
  for (const r of Object.values(runtimes)) {
    total_tokens += r.input_tokens + r.output_tokens;
    total_cost += r.cost_usd;
  }
  return { total_tokens, total_cost };
}

/**
 * Sent alongside the outline's events whenever a chef's effort, model, pin or the
 * total budget changes, so the frontend can redraw pantry bars before anything cooks.
 */
export interface BudgetUpdateEvent {
  type: "budget_update";
  allocation: Allocation;
  estimate: Pick<KitchenCost, "totalUsd" | "unpricedModels">;
}
