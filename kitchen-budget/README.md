# kitchen-budget: the pantry manager

Per-chef token optimization for Kitchen Brigade. No dependencies; drop `src/` into the app.

## Effort tiers

| Tier | Ingredients | Claude `output_config.effort` | Passes |
|---|---|---|---|
| Light prep | 0.5x base | `low` | 1 |
| Normal | 1x base | `medium` | 1 |
| Double shift | 2x base | `high` | 1 |
| All hands | 4x base | `xhigh` | 2 (cook, then taste-and-fix) |

Thinking tokens count against `max_tokens` on Claude, which is why higher effort comes with a bigger cap.

## Wiring it in

```ts
import { allocate, cookStation, anthropicParams, estimateCost, suggestTuning, cycleEffort } from "./kitchen-budget/src";

// 1. After menu_ready, and whenever a chef's effort/model/pin changes:
const alloc = allocate(stations, { totalBudget, mode: "fixed" }); // or "flex"
const bill = estimateCost(stations, alloc);

// 2. In runStation: one model call per pass.
const result = await cookStation(alloc.byId[station.id], prompt, async (req) => {
  // Claude: spread anthropicParams(...) into messages.create; req.maxTokens / req.apiEffort for other providers.
  // Return { text, inputTokens, outputTokens, truncated: stop_reason === "max_tokens" }.
}, abortSignal);

// 3. After plating: feed real usage back.
const tips = suggestTuning(stations, alloc, usageFromStationDoneEvents);

// UI: double-click a chef -> station.effort = cycleEffort(station.effort)
```

Station shape: `{ id, title, depends_on, model, baseBudget, effort, locked? }`. Use the planner's `token_budget` as `baseBudget`.

## Rules

- Fixed mode serves pinned chefs first, then boosted chefs, then everyone else.
- A boost takes at most `protectShare` (default 50%) of any other chef's portion and never takes anyone below `minTokensPerPass` (400) per pass.
- Un-boosting restores every station exactly (`allocate` is a pure function).
- The bill is the worst case: every chef uses every ingredient, and upstream output counts as downstream input.

## Commands

```bash
npm test             # 18 unit tests
npm run build:demo   # bundle demo/demo.js; serve demo/ and open index.html
```
