// Effort tiers: how hard a chef works on one station.
//
// Each tier changes three things together:
//   multiplier  - how many ingredients (output tokens) the station gets vs. the planner's base budget
//   apiEffort   - the provider's reasoning-effort setting (Claude: output_config.effort)
//   passes      - how many times the chef cooks: pass 1 cooks, later passes "taste and fix"
//
// Note: on Claude, thinking tokens count against max_tokens, so a higher apiEffort
// needs a bigger per-pass cap. That is why "double" doubles the budget but stays at one pass.

export type Effort = "light" | "normal" | "double" | "max";
export type ApiEffort = "low" | "medium" | "high" | "xhigh";

export interface EffortTier {
  label: string;
  blurb: string;
  multiplier: number;
  apiEffort: ApiEffort;
  passes: number;
}

export const EFFORT_TIERS: Record<Effort, EffortTier> = {
  light: {
    label: "Light prep",
    blurb: "Half the ingredients, low effort. For simple stations.",
    multiplier: 0.5,
    apiEffort: "low",
    passes: 1,
  },
  normal: {
    label: "Normal",
    blurb: "The planner's budget at medium effort.",
    multiplier: 1,
    apiEffort: "medium",
    passes: 1,
  },
  double: {
    label: "Double shift",
    blurb: "2x ingredients, high effort: more room to think.",
    multiplier: 2,
    apiEffort: "high",
    passes: 1,
  },
  max: {
    label: "All hands",
    blurb: "4x ingredients, extra-high effort, then a taste-and-fix pass.",
    multiplier: 4,
    apiEffort: "xhigh",
    passes: 2,
  },
};

export const EFFORT_ORDER: Effort[] = ["light", "normal", "double", "max"];

/** Next tier up, wrapping back to light. Wire this to double-click on a chef. */
export function cycleEffort(effort: Effort): Effort {
  const i = EFFORT_ORDER.indexOf(effort);
  return EFFORT_ORDER[(i + 1) % EFFORT_ORDER.length]!;
}

export function isBoosted(effort: Effort): boolean {
  return EFFORT_TIERS[effort].multiplier > 1;
}
