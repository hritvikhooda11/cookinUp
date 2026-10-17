# kitchen-budget: the pantry manager

Per-chef token optimization for Kitchen Brigade (outline §3 "Ingredient control", Phase 3 "Budget").
Boost any chef to work harder; the rest of the kitchen rebalances to stay inside the total budget.

Everything lives in this folder, so it merges cleanly next to the Next.js app.

## Effort tiers

| Tier | Ingredients | Claude `output_config.effort` | Passes |
|---|---|---|---|
| Light prep | 0.5x `token_budget` | `low` | 1 |
| Normal | 1x | `medium` | 1 |
| Double shift | 2x | `high` | 1 |
| All hands | 4x | `xhigh` | 2 (cook, then taste-and-fix) |

Thinking tokens count against `max_tokens` on Claude, which is why higher effort comes with a bigger cap.

## What maps to the outline

| Outline | Here |
|---|---|
| §5 Menu / station (`id, title, goal, depends_on, model, token_budget`) | `MenuSchema`, `StationSchema` (zod), `stationsFromMenu()` |
| §5 Station runtime (`status, input_tokens, output_tokens, cost_usd`) | `StationRuntime`, `pantryLevel()` |
| §5 `bill_update {total_tokens, total_cost}` | `billFromRuntime()` returns exactly that payload |
| Phase 3: double-click to boost, others rebalance, pass as `max_tokens` | `boostStation()`, `allocation.byId[id].maxTokensPerPass` |
| Phase 3: model dropdown per station | `setStationModel()` updates the cost estimate |
| Phase 4: pantry bar = budget used / remaining | `<StationPantry>` |
| §3 The bill | `<BillTicket>`, `estimateCost()`, `usageCost()` |
| §8 State: Zustand | `createBudgetSlice()` |

## Merging into the app

1. Root `tsconfig.json`: add `"kitchen-budget"` to `exclude`. Files the app imports are still type-checked; the tests and demo are skipped so `next build` doesn't need vitest.
2. Root `package.json` needs `zod` and `zustand` (both already in the outline's stack) and `react`.
3. Add the slice to the kitchen store:

```ts
import { create } from "zustand";
import { createBudgetSlice, type BudgetSlice } from "@/kitchen-budget/src";

export const useKitchen = create<KitchenState & BudgetSlice>()((set, get) => ({
  ...kitchenSlice(set, get),
  ...createBudgetSlice(set, get),
}));
```

4. Wire the events:

| Event | Call |
|---|---|
| `menu_ready {menu}` | `loadMenu(menu, totalBudget)` |
| double-click a station node | `boostStation(id)` |
| `station_done {id, usage}` | update `output_tokens` for `<StationPantry used>` |
| `plating_done {conflicts}` | `recordUsage([...{ stationId, outputTokens, truncated, conflicted }])` |

5. In the engine's `runStation`, cook with the allocation:

```ts
import { cookStation, anthropicParams } from "@/kitchen-budget/src";

const result = await cookStation(allocation.byId[station.id], prompt, async (req) => {
  // Claude: spread anthropicParams(...) into the request (max_tokens + output_config.effort).
  // Other providers: use req.maxTokens and map req.apiEffort to their reasoning setting.
  // Return { text, inputTokens, outputTokens, truncated: stopped at max_tokens }.
}, abortSignal);
```

## Pixel-style components

`import { PixelStyles, EffortPicker, EffortBadge, StationPantry, PantryShelf, BillTicket } from "@/kitchen-budget/src/react"`

- Render `<PixelStyles />` once (root layout). No CSS modules or build config needed.
- Fonts are inherited, so the app's pixel font applies.
- Colours are CSS variables. Override them on any ancestor to match the app's palette:

```css
.kitchen { --kb-ink: #222034; --kb-panel: #fbf5ef; --kb-fill: #6abe30; --kb-used: #37946e; --kb-px: 4px; }
```

- `<EffortBadge>` is a small flame tag meant to sit on top of your own chef sprite.
- Components are props-only; drop them inside React Flow custom nodes.

## Rules

- Fixed mode serves pinned chefs first, then boosted chefs, then everyone else.
- A boost takes at most `protectShare` (default 50%) of any other chef's portion and never takes anyone below 400 tokens per pass.
- Un-boosting restores every station exactly (`allocate` is a pure function).
- The estimate is the worst case: every chef uses every ingredient, and upstream output counts as downstream input.

## Commands

```bash
npm install
npm test             # 27 unit tests
npm run demo         # builds the pixel demo and serves it at http://localhost:5178
```
