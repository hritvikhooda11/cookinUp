// Shapes from the app outline (§5), validated with zod.
// The planner returns a Menu; the pantry manager adds an effort tier to each station.

import { z } from "zod";
import type { StationBudgetInput } from "./allocate";

export const EffortSchema = z.enum(["light", "normal", "double", "max"]);

export const StationSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  goal: z.string(),
  depends_on: z.array(z.string()),
  model: z.string(),
  token_budget: z.number().int().positive(),
});

export const MenuSchema = z.object({
  task: z.string(),
  stations: z.array(StationSchema).min(1).max(6),
});

/** A menu station plus the pantry manager's controls. */
export const BudgetStationSchema = StationSchema.extend({
  effort: EffortSchema.default("normal"),
  locked: z.boolean().optional(),
});

export type Station = z.infer<typeof StationSchema>;
export type Menu = z.infer<typeof MenuSchema>;
export type BudgetStation = z.infer<typeof BudgetStationSchema>;

/** Every station starts at Normal effort. Throws if the menu fails validation. */
export function stationsFromMenu(menu: unknown): StationBudgetInput[] {
  const parsed = MenuSchema.parse(menu);
  return parsed.stations.map((s) => BudgetStationSchema.parse(s));
}
