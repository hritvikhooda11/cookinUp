// Interactive demo of the pantry manager. Plain DOM so it drops into any frontend;
// in the real app these controls live on the React Flow station nodes.

import {
  CLAUDE_PRICES,
  EFFORT_ORDER,
  EFFORT_TIERS,
  allocate,
  applySuggestions,
  cycleEffort,
  estimateCost,
  suggestTuning,
  type BudgetMode,
  type StationBudgetInput,
  type Suggestion,
} from "../src";

const MODEL_NAMES: Record<string, string> = {
  "claude-haiku-5-5": "Haiku 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-opus-5-5": "Opus 5.5",
  "claude-fable-5-1": "Fable 5.1",
};

let stations: StationBudgetInput[] = [
  { id: "food", title: "Find vegetarian spots", depends_on: [], model: "claude-sonnet-5-5", baseBudget: 1500, effort: "normal" },
  { id: "budget", title: "Price the trip", depends_on: [], model: "claude-haiku-5-5", baseBudget: 1000, effort: "normal" },
  { id: "map", title: "Describe the route map", depends_on: ["food"], model: "claude-haiku-5-5", baseBudget: 1000, effort: "normal" },
  { id: "itin", title: "Write the 3-day itinerary", depends_on: ["food", "budget", "map"], model: "claude-sonnet-5-5", baseBudget: 2500, effort: "normal" },
];
let totalBudget = 8000;
let mode: BudgetMode = "fixed";
let suggestions: Suggestion[] = [];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fmtTok = (n: number) => n.toLocaleString("en-US");
const fmtUsd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function update(id: string, patch: Partial<StationBudgetInput>) {
  stations = stations.map((s) => (s.id === id ? { ...s, ...patch } : s));
  suggestions = [];
  render();
}

function render() {
  const alloc = allocate(stations, { totalBudget, mode });
  const cost = estimateCost(stations, alloc);
  const opusEverywhere = estimateCost(
    stations.map((s) => ({ ...s, model: "claude-opus-5-5" })),
    alloc,
  );
  const scale = Math.max(...alloc.stations.map((a) => Math.max(a.desired, a.budget)), 1);

  $("#total-label").textContent = fmtTok(totalBudget);
  $("#allocated").textContent = fmtTok(alloc.allocated);
  $("#reserve").textContent = alloc.overBy > 0 ? `−${fmtTok(alloc.overBy)}` : fmtTok(alloc.reserve);
  $("#reserve-label").textContent = alloc.overBy > 0 ? "Over budget" : "In reserve";
  $("#reserve").classList.toggle("bad", alloc.overBy > 0);
  $("#bill").textContent = fmtUsd(cost.totalUsd);
  $("#bill-compare").textContent = `vs ${fmtUsd(opusEverywhere.totalUsd)} with Opus 5.5 at every station`;

  const pantry = $("#pantry-bar");
  pantry.innerHTML = alloc.stations
    .map((a, i) => {
      const pct = (a.budget / Math.max(totalBudget, alloc.allocated)) * 100;
      return `<span class="seg c${i}" style="width:${pct}%" title="${esc(stations[i]!.title ?? a.id)}: ${fmtTok(a.budget)}"></span>`;
    })
    .join("");

  $("#warnings").innerHTML = alloc.warnings.map((w) => `<li>${esc(w)}</li>`).join("");

  $("#stations").innerHTML = stations
    .map((s, i) => {
      const a = alloc.byId[s.id]!;
      const c = cost.byId[s.id]!;
      const tier = EFFORT_TIERS[s.effort];
      const effortButtons = EFFORT_ORDER.map(
        (e) =>
          `<button class="effort ${e === s.effort ? "on" : ""}" data-id="${s.id}" data-effort="${e}" title="${esc(EFFORT_TIERS[e].blurb)}">${EFFORT_TIERS[e].label}</button>`,
      ).join("");
      const models = Object.keys(CLAUDE_PRICES)
        .map((m) => `<option value="${m}" ${m === s.model ? "selected" : ""}>${MODEL_NAMES[m] ?? m}</option>`)
        .join("");
      const deps = s.depends_on.length
        ? `waits for ${s.depends_on.map((d) => esc(stations.find((x) => x.id === d)?.title ?? d)).join(", ")}`
        : "starts right away";
      return `
      <article class="station effort-${s.effort}" data-id="${s.id}">
        <header>
          <span class="chef c${i}" aria-hidden="true">${chefSvg(s.effort)}</span>
          <div class="title">
            <h3>${esc(s.title ?? s.id)}</h3>
            <p class="deps">${deps}</p>
          </div>
          <label class="lock" title="Pin this chef's ingredients so boosts never take from them">
            <input type="checkbox" data-lock="${s.id}" ${s.locked ? "checked" : ""}/> Pin
          </label>
        </header>
        <div class="effort-row" role="group" aria-label="Effort">${effortButtons}</div>
        <div class="meter" title="Budget vs. what this chef asked for">
          <span class="want" style="width:${(a.desired / scale) * 100}%"></span>
          <span class="got c${i}" style="width:${(a.budget / scale) * 100}%"></span>
        </div>
        <dl class="facts">
          <div><dt>Ingredients</dt><dd>${fmtTok(a.budget)}${a.squeezedBy > 0 ? ` <span class="squeezed">−${fmtTok(a.squeezedBy)}</span>` : ""}</dd></div>
          <div><dt>Per pass</dt><dd>${a.passes} × ${fmtTok(a.maxTokensPerPass)}</dd></div>
          <div><dt>Effort</dt><dd><code>${tier.apiEffort}</code></dd></div>
          <div><dt>Max cost</dt><dd>${c.usd === null ? "n/a" : fmtUsd(c.usd)}</dd></div>
        </dl>
        <footer>
          <label>Chef <select data-model="${s.id}">${models}</select></label>
          <label>Base <input type="number" min="200" step="100" value="${s.baseBudget}" data-base="${s.id}"/></label>
        </footer>
      </article>`;
    })
    .join("");

  $("#suggestions").innerHTML = suggestions.length
    ? `<ul>${suggestions.map((sg) => `<li class="${sg.kind}"><strong>${kindLabel(sg.kind)}</strong> ${esc(sg.reason)}</li>`).join("")}</ul>
       <button id="apply">Apply ${suggestions.length} change${suggestions.length > 1 ? "s" : ""}</button>`
    : `<p class="muted">Run a service to see which chefs ran out of ingredients and which left some on the shelf.</p>`;
  $("#apply")?.addEventListener("click", () => {
    stations = applySuggestions(stations, suggestions);
    suggestions = [];
    render();
  });
}

function kindLabel(kind: Suggestion["kind"]) {
  return { "more-ingredients": "More ingredients", trim: "Trim", "work-harder": "Work harder" }[kind];
}

// Fake usage so the tuner has something to react to. Wire real usage from station_done events.
function simulateService() {
  const alloc = allocate(stations, { totalBudget, mode });
  const conflictId = stations[Math.floor(Math.random() * stations.length)]!.id;
  const usage = alloc.stations.map((a) => {
    const share = Math.random() * 1.3;
    return {
      stationId: a.id,
      outputTokens: Math.min(a.budget, Math.round(a.budget * share)),
      truncated: share >= 1,
      conflicted: a.id === conflictId && share < 1,
    };
  });
  suggestions = suggestTuning(stations, alloc, usage);
  render();
  if (!suggestions.length) {
    $("#suggestions").innerHTML = `<p class="muted">Every chef used about what they were given. Nothing to change.</p>`;
  }
}

function chefSvg(effort: string) {
  const sweat = effort === "double" || effort === "max";
  const arms = effort === "max";
  return `<svg viewBox="0 0 48 48" width="44" height="44">
    <ellipse cx="24" cy="12" rx="11" ry="8" fill="currentColor"/>
    <rect x="15" y="14" width="18" height="6" rx="1" fill="currentColor"/>
    <circle cx="24" cy="27" r="9" fill="var(--skin)"/>
    <circle cx="21" cy="26" r="1.2" fill="var(--ink)"/><circle cx="27" cy="26" r="1.2" fill="var(--ink)"/>
    <path d="M20.5 30.5 q3.5 ${effort === "light" ? "1" : "2.5"} 7 0" stroke="var(--ink)" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <rect x="15" y="36" width="18" height="10" rx="3" fill="var(--coat)"/>
    ${sweat ? `<path class="sweat" d="M35 22 q2 3 0 5 q-2 -2 0 -5z" fill="var(--sweat)"/>` : ""}
    ${arms ? `<rect class="arm a1" x="5" y="36" width="10" height="3" rx="1.5" fill="var(--coat)"/><rect class="arm a2" x="33" y="36" width="10" height="3" rx="1.5" fill="var(--coat)"/>` : ""}
  </svg>`;
}

function wire() {
  const slider = $("#total") as HTMLInputElement;
  slider.value = String(totalBudget);
  slider.addEventListener("input", () => {
    totalBudget = Number(slider.value);
    suggestions = [];
    render();
  });
  document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((r) => {
    r.checked = r.value === mode;
    r.addEventListener("change", () => {
      mode = r.value as BudgetMode;
      render();
    });
  });
  $("#simulate").addEventListener("click", simulateService);
  $("#reset").addEventListener("click", () => {
    stations = stations.map((s) => ({ ...s, effort: "normal", locked: false }));
    suggestions = [];
    render();
  });

  const root = $("#stations");
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.effort");
    if (b) update(b.dataset.id!, { effort: b.dataset.effort as StationBudgetInput["effort"] });
  });
  // Double-click a chef to cycle how hard they work.
  root.addEventListener("dblclick", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, select, input, label")) return;
    const card = t.closest<HTMLElement>(".station");
    if (!card) return;
    const s = stations.find((x) => x.id === card.dataset.id)!;
    update(s.id, { effort: cycleEffort(s.effort) });
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.lock) update(t.dataset.lock, { locked: t.checked });
    if (t.dataset.model) update(t.dataset.model, { model: t.value });
    if (t.dataset.base) update(t.dataset.base, { baseBudget: Math.max(200, Number(t.value) || 200) });
  });
}

wire();
render();
