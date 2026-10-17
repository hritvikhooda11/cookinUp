// The pantry manager: turns each station's base budget + effort tier into a concrete
// per-station token budget, keeping the kitchen inside its total budget.
//
// allocate() is a pure function of the stations and options. Boosting a chef and then
// un-boosting them returns every station to exactly where it was.

import { EFFORT_TIERS, isBoosted, type ApiEffort, type Effort } from "./effort";

export interface StationBudgetInput {
  id: string;
  title?: string;
  depends_on: string[];
  model: string;
  /** Planner's suggested output-token budget at "normal" effort. */
  baseBudget: number;
  effort: Effort;
  /** User pinned this station's budget: it is never squeezed to make room for others. */
  locked?: boolean;
}

export type BudgetMode =
  /** Total stays fixed: boosting one chef takes ingredients from the others. */
  | "fixed"
  /** Total grows: boosting one chef adds ingredients; over-budget is reported, not enforced. */
  | "flex";

export interface AllocateOptions {
  totalBudget: number;
  mode?: BudgetMode;
  /** Smallest useful max_tokens for one pass. Below this, JSON output gets cut off. */
  minTokensPerPass?: number;
  /** Largest max_tokens one request may ask for. */
  maxTokensPerPass?: number;
  /**
   * Share of each un-boosted chef's ingredients that a boost can never take (0-1).
   * 0.5 means boosting one chef takes at most half of anyone else's portion.
   */
  protectShare?: number;
}

export interface StationAllocation {
  id: string;
  effort: Effort;
  apiEffort: ApiEffort;
  passes: number;
  /** What this station would get with unlimited ingredients: baseBudget x multiplier. */
  desired: number;
  /** What it actually gets, summed over all passes. */
  budget: number;
  /** max_tokens to send on each pass. */
  maxTokensPerPass: number;
  /** Tokens taken away to make room for boosted/locked chefs (desired - budget). */
  squeezedBy: number;
  /** Boosted or locked: filled before anyone else. */
  priority: boolean;
}

export interface Allocation {
  stations: StationAllocation[];
  byId: Record<string, StationAllocation>;
  totalBudget: number;
  allocated: number;
  /** Unused ingredients left in the pantry. */
  reserve: number;
  /** How far allocated exceeds totalBudget (flex mode, or floors that cannot fit). */
  overBy: number;
  warnings: string[];
}

export const DEFAULT_MIN_TOKENS_PER_PASS = 400;
export const DEFAULT_MAX_TOKENS_PER_PASS = 64_000;
export const DEFAULT_PROTECT_SHARE = 0.5;

interface FitItem {
  desired: number;
  floor: number;
}

/**
 * Shrinks items proportionally to fit capacity, never below each item's floor
 * (water-filling). Items whose proportional share would drop below their floor are
 * pinned at the floor and the rest share what is left. Results sum to <= capacity
 * unless the floors alone exceed it, in which case every item gets its floor.
 */
export function fitProportional(items: FitItem[], capacity: number): number[] {
  const totalDesired = items.reduce((s, it) => s + it.desired, 0);
  if (totalDesired <= capacity) return items.map((it) => it.desired);

  const totalFloor = items.reduce((s, it) => s + it.floor, 0);
  if (totalFloor >= capacity) return items.map((it) => it.floor);

  const pinned = new Set<number>();
  let factor = 0;
  for (;;) {
    let pinnedFloor = 0;
    let freeDesired = 0;
    items.forEach((it, i) => {
      if (pinned.has(i)) pinnedFloor += it.floor;
      else freeDesired += it.desired;
    });
    factor = freeDesired > 0 ? (capacity - pinnedFloor) / freeDesired : 0;
    let changed = false;
    items.forEach((it, i) => {
      if (!pinned.has(i) && it.desired * factor < it.floor) {
        pinned.add(i);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return items.map((it, i) => (pinned.has(i) ? it.floor : Math.floor(it.desired * factor)));
}

export function allocate(stations: StationBudgetInput[], options: AllocateOptions): Allocation {
  const mode = options.mode ?? "fixed";
  const minPerPass = options.minTokensPerPass ?? DEFAULT_MIN_TOKENS_PER_PASS;
  const maxPerPass = options.maxTokensPerPass ?? DEFAULT_MAX_TOKENS_PER_PASS;
  const protectShare = options.protectShare ?? DEFAULT_PROTECT_SHARE;
  const total = options.totalBudget;
  const warnings: string[] = [];

  const rows = stations.map((s) => {
    const tier = EFFORT_TIERS[s.effort];
    const ceiling = maxPerPass * tier.passes;
    const floor = minPerPass * tier.passes;
    const desired = Math.min(ceiling, Math.max(floor, Math.round(s.baseBudget * tier.multiplier)));
    const priority = isBoosted(s.effort) || !!s.locked;
    // What later groups keep back from earlier ones: their floor, or the protected share of their portion.
    const protectedFloor = priority ? floor : Math.max(floor, Math.floor(desired * protectShare));
    return { s, tier, floor, protectedFloor, desired, priority };
  });

  const budgets = new Array<number>(rows.length).fill(0);
  // Serving order: locked chefs, then boosted chefs, then everyone else.
  const rank = (r: (typeof rows)[number]) => (r.s.locked ? 0 : r.priority ? 1 : 2);
  const groups = [0, 1, 2].map((g) => rows.map((_, i) => i).filter((i) => rank(rows[i]!) === g));
  const sumOf = (idx: number[], key: "desired" | "floor" | "protectedFloor") =>
    idx.reduce((sum, i) => sum + rows[i]![key], 0);

  if (mode === "flex" || sumOf(rows.map((_, i) => i), "desired") <= total) {
    rows.forEach((r, i) => (budgets[i] = r.desired));
  } else {
    // Each group is served before the next, but never so much that a later group drops below its floor.
    let used = 0;
    groups.forEach((group, g) => {
      const laterFloor = groups
        .slice(g + 1)
        .reduce((sum, idx) => sum + sumOf(idx, "protectedFloor"), 0);
      const fit = fitProportional(
        group.map((i) => rows[i]!),
        Math.max(0, total - used - laterFloor),
      );
      group.forEach((i, k) => (budgets[i] = fit[k]!));
      used += fit.reduce((a, b) => a + b, 0);
    });

    rows.forEach((r, i) => {
      if (r.priority && budgets[i]! < r.desired) {
        warnings.push(
          `${r.s.title ?? r.s.id} wanted ${r.desired} tokens but only ${budgets[i]} fit in the pantry.`,
        );
      }
    });
  }

  const allocated = budgets.reduce((a, b) => a + b, 0);
  const overBy = Math.max(0, allocated - total);
  if (overBy > 0) {
    warnings.push(
      mode === "flex"
        ? `Kitchen is ${overBy} tokens over the ${total}-token budget.`
        : `Even at minimum portions the stations need ${allocated} tokens; raise the total budget or remove a station.`,
    );
  }

  const out: StationAllocation[] = rows.map((r, i) => {
    const budget = budgets[i]!;
    return {
      id: r.s.id,
      effort: r.s.effort,
      apiEffort: r.tier.apiEffort,
      passes: r.tier.passes,
      desired: r.desired,
      budget,
      maxTokensPerPass: Math.floor(budget / r.tier.passes),
      squeezedBy: r.desired - budget,
      priority: r.priority,
    };
  });

  return {
    stations: out,
    byId: Object.fromEntries(out.map((a) => [a.id, a])),
    totalBudget: total,
    allocated,
    reserve: Math.max(0, total - allocated),
    overBy,
    warnings,
  };
}
