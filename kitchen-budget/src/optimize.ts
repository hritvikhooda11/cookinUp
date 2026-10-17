// Per-chef tuning from the last service: who ran out of ingredients, who left food
// on the shelf, and whose dish the expediter sent back.

import { EFFORT_ORDER, EFFORT_TIERS, type Effort } from "./effort";
import type { Allocation, StationBudgetInput } from "./allocate";

export interface StationUsage {
  stationId: string;
  /** Output tokens the station actually used, summed over passes. */
  outputTokens: number;
  /** A pass stopped at max_tokens (Claude: stop_reason "max_tokens"). */
  truncated: boolean;
  /** The expediter flagged this station in a conflict. */
  conflicted?: boolean;
}

export type SuggestionKind = "more-ingredients" | "trim" | "work-harder";

export interface Suggestion {
  stationId: string;
  kind: SuggestionKind;
  reason: string;
  patch: Partial<Pick<StationBudgetInput, "token_budget" | "effort">>;
}

export interface TuneOptions {
  /** Grow factor for a station that hit its limit. */
  growBy?: number;
  /** A station that used less than this share of its budget is trimmed. */
  trimBelow?: number;
  /** Headroom kept above observed usage when trimming. */
  headroom?: number;
  /** Never trim a base budget below this. */
  minBase?: number;
}

const roundUp100 = (n: number) => Math.ceil(n / 100) * 100;

function stepUp(effort: Effort): Effort {
  const i = EFFORT_ORDER.indexOf(effort);
  return EFFORT_ORDER[Math.min(i + 1, EFFORT_ORDER.length - 1)]!;
}

export function suggestTuning(
  stations: StationBudgetInput[],
  allocation: Allocation,
  usage: StationUsage[],
  options: TuneOptions = {},
): Suggestion[] {
  const growBy = options.growBy ?? 1.5;
  const trimBelow = options.trimBelow ?? 0.4;
  const headroom = options.headroom ?? 1.3;
  const minBase = options.minBase ?? 400;
  const out: Suggestion[] = [];

  for (const u of usage) {
    const s = stations.find((st) => st.id === u.stationId);
    const a = allocation.byId[u.stationId];
    if (!s || !a) continue;
    const name = s.title ?? s.id;

    if (u.truncated) {
      out.push({
        stationId: s.id,
        kind: "more-ingredients",
        reason: `${name} ran out of ingredients (hit its ${a.maxTokensPerPass}-token limit).`,
        patch: { token_budget: roundUp100(s.token_budget * growBy) },
      });
      continue;
    }
    if (u.conflicted && s.effort !== "max") {
      const next = stepUp(s.effort);
      out.push({
        stationId: s.id,
        kind: "work-harder",
        reason: `The expediter sent back the dish from ${name}; move it to ${EFFORT_TIERS[next].label}.`,
        patch: { effort: next },
      });
      continue;
    }
    if (!s.locked && a.budget > 0 && u.outputTokens < a.budget * trimBelow) {
      const multiplier = EFFORT_TIERS[s.effort].multiplier;
      const newBase = Math.max(minBase, roundUp100((u.outputTokens * headroom) / multiplier));
      if (newBase < s.token_budget) {
        out.push({
          stationId: s.id,
          kind: "trim",
          reason: `${name} used ${u.outputTokens} of ${a.budget} tokens; free up the leftovers.`,
          patch: { token_budget: newBase },
        });
      }
    }
  }
  return out;
}

export function applySuggestions(
  stations: StationBudgetInput[],
  suggestions: Suggestion[],
): StationBudgetInput[] {
  return stations.map((s) => {
    const patches = suggestions.filter((sg) => sg.stationId === s.id).map((sg) => sg.patch);
    return Object.assign({}, s, ...patches);
  });
}
