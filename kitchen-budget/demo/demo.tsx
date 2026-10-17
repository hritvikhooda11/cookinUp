// Demo kitchen built from the same pieces the app will use: the Zustand slice
// (createBudgetSlice) and the pixel components. Cooking is simulated.

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import { CLAUDE_PRICES, createBudgetSlice, usageCost, type BudgetSlice, type Effort } from "../src";
import { BillTicket, EffortBadge, EffortPicker, PantryShelf, PixelStyles, StationPantry } from "../src/react";

const useKitchen = create<BudgetSlice>()((set, get) => createBudgetSlice(set, get));

// The outline's demo order (§9).
useKitchen.getState().loadMenu(
  {
    task: "Plan a 3-day vegetarian Seattle food tour with a budget and a map description.",
    stations: [
      { id: "food", title: "Find vegetarian spots", goal: "12 spots with hours", depends_on: [], model: "claude-sonnet-5-5", token_budget: 1500 },
      { id: "budget", title: "Price the trip", goal: "Daily costs", depends_on: [], model: "claude-haiku-5-5", token_budget: 1000 },
      { id: "map", title: "Describe the route map", goal: "Route by neighbourhood", depends_on: ["food"], model: "claude-haiku-5-5", token_budget: 1000 },
      { id: "itin", title: "Write the itinerary", goal: "3 days, meal by meal", depends_on: ["food", "budget", "map"], model: "claude-sonnet-5-5", token_budget: 2500 },
    ],
  },
  8000,
);

const MODEL_NAMES: Record<string, string> = {
  "claude-haiku-5-5": "Haiku 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-opus-5-5": "Opus 5.5",
  "claude-fable-5-1": "Fable 5.1",
};
const HATS = ["#e67e22", "#16a085", "#8e44ad", "#d35480"];

/** Original 16x16 pixel chef. Arms move faster the harder the chef works. */
function Chef({ hat, effort, cooking }: { hat: string; effort: Effort; cooking: boolean }) {
  const speed = { light: 0.9, normal: 0.6, double: 0.35, max: 0.2 }[effort];
  const px = (x: number, y: number, w: number, h: number, fill: string) => (
    <rect x={x} y={y} width={w} height={h} fill={fill} />
  );
  return (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges" aria-hidden="true">
      {px(4, 0, 8, 2, "#fff")}{px(3, 1, 10, 3, "#fff")}{px(4, 4, 8, 1, hat)}
      {px(4, 5, 8, 5, "#f1c27d")}{px(5, 7, 1, 1, "#1b1a2e")}{px(10, 7, 1, 1, "#1b1a2e")}
      {px(6, 9, 4, 1, "#a0522d")}
      {px(3, 10, 10, 6, "#fff")}{px(7, 11, 2, 1, hat)}{px(7, 13, 2, 1, hat)}
      <g className={cooking ? "arm" : undefined} style={{ animationDuration: `${speed}s` }}>
        {px(1, 11, 2, 2, "#fff")}{px(13, 11, 2, 2, "#fff")}
      </g>
      {(effort === "double" || effort === "max") && px(13, 5, 1, 2, "#5dade2")}
    </svg>
  );
}

function App() {
  const s = useKitchen();
  const [used, setUsed] = useState<Record<string, number>>({});
  const [spent, setSpent] = useState(0);
  const [cooking, setCooking] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearInterval(timer.current), []);

  // Simulated service: every station drains its pantry at a random pace, some run out.
  function runService() {
    const targets = Object.fromEntries(
      s.allocation.stations.map((a) => [a.id, Math.round(a.budget * (0.2 + Math.random() * 1.1))]),
    );
    const conflict = s.budgetStations[Math.floor(Math.random() * s.budgetStations.length)]!.id;
    setUsed({});
    setCooking(true);
    let tick = 0;
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      tick++;
      const now = Object.fromEntries(
        s.allocation.stations.map((a) => [a.id, Math.min(a.budget, Math.round((targets[a.id]! * tick) / 20))]),
      );
      setUsed(now);
      setSpent(
        s.budgetStations.reduce((sum, st) => sum + (usageCost(st.model, 600, now[st.id] ?? 0) ?? 0), 0),
      );
      if (tick >= 20) {
        window.clearInterval(timer.current);
        setCooking(false);
        s.recordUsage(
          s.allocation.stations.map((a) => ({
            stationId: a.id,
            outputTokens: now[a.id]!,
            truncated: targets[a.id]! >= a.budget,
            conflicted: a.id === conflict && targets[a.id]! < a.budget,
          })),
        );
      }
    }, 90);
  }

  const titles = Object.fromEntries(s.budgetStations.map((st) => [st.id, st.title ?? st.id]));
  const colors = Object.fromEntries(s.budgetStations.map((st, i) => [st.id, HATS[i % HATS.length]!]));

  return (
    <main className="kb">
      <PixelStyles />
      <header className="top">
        <div>
          <h1>PANTRY MANAGER</h1>
          <p>Pick how hard each chef works. Boosted chefs get more ingredients and think harder; in fixed mode the others give some up.</p>
        </div>
        <BillTicket estimateUsd={s.estimate.totalUsd} actualUsd={spent} />
      </header>

      <section className="kb-box panel">
        <label className="row">
          <span>KITCHEN BUDGET</span>
          <input type="range" min={2000} max={20000} step={500} value={s.totalBudget}
            onChange={(e) => s.setTotalBudget(Number(e.target.value))} aria-label="Total token budget" />
          <strong>{s.totalBudget.toLocaleString("en-US")} tok</strong>
        </label>
        <div className="row modes" role="radiogroup" aria-label="Budget mode">
          {(["fixed", "flex"] as const).map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={s.budgetMode === m} onClick={() => s.setBudgetMode(m)}>
              {m === "fixed" ? "FIXED: boosts take from others" : "FLEX: boosts add to the total"}
            </button>
          ))}
        </div>
        <PantryShelf allocation={s.allocation} titles={titles} colors={colors} />
        {s.allocation.warnings.map((w) => <p key={w} className="warn">! {w}</p>)}
      </section>

      <p className="hint">Double-click a chef to cycle Light prep → Normal → Double shift → All hands.</p>
      <section className="grid">
        {s.budgetStations.map((st, i) => {
          const a = s.allocation.byId[st.id]!;
          return (
            <article key={st.id} className="kb-box station" data-boosted={a.priority && !st.locked ? "" : undefined}>
              <div className="head" onDoubleClick={() => s.boostStation(st.id)} title="Double-click to boost">
                <div className="sprite">
                  <Chef hat={HATS[i % HATS.length]!} effort={st.effort} cooking={cooking} />
                  <EffortBadge effort={st.effort} className="badge" />
                </div>
                <div>
                  <h2>{st.title}</h2>
                  <p className="meta">{a.passes} pass{a.passes > 1 ? "es" : ""} · effort {a.apiEffort} · max {s.estimate.byId[st.id]?.usd === null ? "n/a" : `$${s.estimate.byId[st.id]!.usd!.toFixed(4)}`}</p>
                </div>
              </div>
              <EffortPicker value={st.effort} onChange={(e) => s.setEffort(st.id, e)} />
              <StationPantry allocation={a} used={used[st.id] ?? 0} />
              <div className="row foot">
                <select value={st.model} onChange={(e) => s.setStationModel(st.id, e.target.value)} aria-label="Chef model">
                  {Object.keys(CLAUDE_PRICES).map((m) => <option key={m} value={m}>{MODEL_NAMES[m] ?? m}</option>)}
                </select>
                <label className="pin">
                  <input type="checkbox" checked={!!st.locked} onChange={(e) => s.setLocked(st.id, e.target.checked)} /> PIN
                </label>
              </div>
            </article>
          );
        })}
      </section>

      <section className="kb-box panel tuner">
        <button type="button" className="chip go" onClick={runService} disabled={cooking}>
          {cooking ? "COOKING..." : "RUN A SERVICE"}
        </button>
        <div>
          {s.suggestions.length === 0 ? (
            <p className="meta">After a service, chefs who ran out or left ingredients unused show up here.</p>
          ) : (
            <>
              <ul>{s.suggestions.map((sg) => <li key={sg.stationId + sg.kind}><b>{sg.kind.toUpperCase()}</b> {sg.reason}</li>)}</ul>
              <button type="button" className="chip" onClick={s.applyTuning}>APPLY {s.suggestions.length}</button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
