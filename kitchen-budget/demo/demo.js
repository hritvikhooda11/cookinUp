"use strict";
(() => {
  // src/effort.ts
  var EFFORT_TIERS = {
    light: {
      label: "Light prep",
      blurb: "Half the ingredients, low effort. For simple stations.",
      multiplier: 0.5,
      apiEffort: "low",
      passes: 1
    },
    normal: {
      label: "Normal",
      blurb: "The planner's budget at medium effort.",
      multiplier: 1,
      apiEffort: "medium",
      passes: 1
    },
    double: {
      label: "Double shift",
      blurb: "2x ingredients, high effort: more room to think.",
      multiplier: 2,
      apiEffort: "high",
      passes: 1
    },
    max: {
      label: "All hands",
      blurb: "4x ingredients, extra-high effort, then a taste-and-fix pass.",
      multiplier: 4,
      apiEffort: "xhigh",
      passes: 2
    }
  };
  var EFFORT_ORDER = ["light", "normal", "double", "max"];
  function cycleEffort(effort) {
    const i = EFFORT_ORDER.indexOf(effort);
    return EFFORT_ORDER[(i + 1) % EFFORT_ORDER.length];
  }
  function isBoosted(effort) {
    return EFFORT_TIERS[effort].multiplier > 1;
  }

  // src/allocate.ts
  var DEFAULT_MIN_TOKENS_PER_PASS = 400;
  var DEFAULT_MAX_TOKENS_PER_PASS = 64e3;
  var DEFAULT_PROTECT_SHARE = 0.5;
  function fitProportional(items, capacity) {
    const totalDesired = items.reduce((s, it) => s + it.desired, 0);
    if (totalDesired <= capacity) return items.map((it) => it.desired);
    const totalFloor = items.reduce((s, it) => s + it.floor, 0);
    if (totalFloor >= capacity) return items.map((it) => it.floor);
    const pinned = /* @__PURE__ */ new Set();
    let factor = 0;
    for (; ; ) {
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
    return items.map((it, i) => pinned.has(i) ? it.floor : Math.floor(it.desired * factor));
  }
  function allocate(stations2, options) {
    const mode2 = options.mode ?? "fixed";
    const minPerPass = options.minTokensPerPass ?? DEFAULT_MIN_TOKENS_PER_PASS;
    const maxPerPass = options.maxTokensPerPass ?? DEFAULT_MAX_TOKENS_PER_PASS;
    const protectShare = options.protectShare ?? DEFAULT_PROTECT_SHARE;
    const total = options.totalBudget;
    const warnings = [];
    const rows = stations2.map((s) => {
      const tier = EFFORT_TIERS[s.effort];
      const ceiling = maxPerPass * tier.passes;
      const floor = minPerPass * tier.passes;
      const desired = Math.min(ceiling, Math.max(floor, Math.round(s.baseBudget * tier.multiplier)));
      const priority = isBoosted(s.effort) || !!s.locked;
      const protectedFloor = priority ? floor : Math.max(floor, Math.floor(desired * protectShare));
      return { s, tier, floor, protectedFloor, desired, priority };
    });
    const budgets = new Array(rows.length).fill(0);
    const rank = (r) => r.s.locked ? 0 : r.priority ? 1 : 2;
    const groups = [0, 1, 2].map((g) => rows.map((_, i) => i).filter((i) => rank(rows[i]) === g));
    const sumOf = (idx, key) => idx.reduce((sum, i) => sum + rows[i][key], 0);
    if (mode2 === "flex" || sumOf(rows.map((_, i) => i), "desired") <= total) {
      rows.forEach((r, i) => budgets[i] = r.desired);
    } else {
      let used = 0;
      groups.forEach((group, g) => {
        const laterFloor = groups.slice(g + 1).reduce((sum, idx) => sum + sumOf(idx, "protectedFloor"), 0);
        const fit = fitProportional(
          group.map((i) => rows[i]),
          Math.max(0, total - used - laterFloor)
        );
        group.forEach((i, k) => budgets[i] = fit[k]);
        used += fit.reduce((a, b) => a + b, 0);
      });
      rows.forEach((r, i) => {
        if (r.priority && budgets[i] < r.desired) {
          warnings.push(
            `${r.s.title ?? r.s.id} wanted ${r.desired} tokens but only ${budgets[i]} fit in the pantry.`
          );
        }
      });
    }
    const allocated = budgets.reduce((a, b) => a + b, 0);
    const overBy = Math.max(0, allocated - total);
    if (overBy > 0) {
      warnings.push(
        mode2 === "flex" ? `Kitchen is ${overBy} tokens over the ${total}-token budget.` : `Even at minimum portions the stations need ${allocated} tokens; raise the total budget or remove a station.`
      );
    }
    const out = rows.map((r, i) => {
      const budget = budgets[i];
      return {
        id: r.s.id,
        effort: r.s.effort,
        apiEffort: r.tier.apiEffort,
        passes: r.tier.passes,
        desired: r.desired,
        budget,
        maxTokensPerPass: Math.floor(budget / r.tier.passes),
        squeezedBy: r.desired - budget,
        priority: r.priority
      };
    });
    return {
      stations: out,
      byId: Object.fromEntries(out.map((a) => [a.id, a])),
      totalBudget: total,
      allocated,
      reserve: Math.max(0, total - allocated),
      overBy,
      warnings
    };
  }

  // src/cost.ts
  var CLAUDE_PRICES = {
    "claude-haiku-5-5": { input: 0.1, output: 0.5 },
    "claude-sonnet-5-5": { input: 2, output: 10 },
    "claude-opus-5-5": { input: 4, output: 20 },
    "claude-fable-5-1": { input: 10, output: 50 }
  };
  var DEFAULT_PROMPT_OVERHEAD = 600;
  function estimateCost(stations2, allocation, prices = CLAUDE_PRICES, promptOverhead = DEFAULT_PROMPT_OVERHEAD) {
    const unpriced = /* @__PURE__ */ new Set();
    const rows = stations2.map((s) => {
      const a = allocation.byId[s.id];
      if (!a) throw new Error(`No allocation for station ${s.id}`);
      const upstream = s.depends_on.reduce((sum, dep) => sum + (allocation.byId[dep]?.budget ?? 0), 0);
      const firstPassInput = promptOverhead + upstream;
      const laterPassInput = (firstPassInput + a.maxTokensPerPass) * (a.passes - 1);
      const inputTokens = firstPassInput + laterPassInput;
      const outputTokens = a.budget;
      const price = prices[s.model];
      if (!price) unpriced.add(s.model);
      const usd = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null;
      return { id: s.id, inputTokens, outputTokens, usd };
    });
    return {
      stations: rows,
      byId: Object.fromEntries(rows.map((r) => [r.id, r])),
      totalUsd: rows.reduce((sum, r) => sum + (r.usd ?? 0), 0),
      unpricedModels: [...unpriced]
    };
  }

  // src/optimize.ts
  var roundUp100 = (n) => Math.ceil(n / 100) * 100;
  function stepUp(effort) {
    const i = EFFORT_ORDER.indexOf(effort);
    return EFFORT_ORDER[Math.min(i + 1, EFFORT_ORDER.length - 1)];
  }
  function suggestTuning(stations2, allocation, usage, options = {}) {
    const growBy = options.growBy ?? 1.5;
    const trimBelow = options.trimBelow ?? 0.4;
    const headroom = options.headroom ?? 1.3;
    const minBase = options.minBase ?? 400;
    const out = [];
    for (const u of usage) {
      const s = stations2.find((st) => st.id === u.stationId);
      const a = allocation.byId[u.stationId];
      if (!s || !a) continue;
      const name = s.title ?? s.id;
      if (u.truncated) {
        out.push({
          stationId: s.id,
          kind: "more-ingredients",
          reason: `${name} ran out of ingredients (hit its ${a.maxTokensPerPass}-token limit).`,
          patch: { baseBudget: roundUp100(s.baseBudget * growBy) }
        });
        continue;
      }
      if (u.conflicted && s.effort !== "max") {
        const next = stepUp(s.effort);
        out.push({
          stationId: s.id,
          kind: "work-harder",
          reason: `The expediter sent back ${name}'s dish; move it to ${EFFORT_TIERS[next].label}.`,
          patch: { effort: next }
        });
        continue;
      }
      if (!s.locked && a.budget > 0 && u.outputTokens < a.budget * trimBelow) {
        const multiplier = EFFORT_TIERS[s.effort].multiplier;
        const newBase = Math.max(minBase, roundUp100(u.outputTokens * headroom / multiplier));
        if (newBase < s.baseBudget) {
          out.push({
            stationId: s.id,
            kind: "trim",
            reason: `${name} used ${u.outputTokens} of ${a.budget} tokens; free up the leftovers.`,
            patch: { baseBudget: newBase }
          });
        }
      }
    }
    return out;
  }
  function applySuggestions(stations2, suggestions2) {
    return stations2.map((s) => {
      const patches = suggestions2.filter((sg) => sg.stationId === s.id).map((sg) => sg.patch);
      return Object.assign({}, s, ...patches);
    });
  }

  // demo/demo.ts
  var MODEL_NAMES = {
    "claude-haiku-5-5": "Haiku 5.5",
    "claude-sonnet-5-5": "Sonnet 5.5",
    "claude-opus-5-5": "Opus 5.5",
    "claude-fable-5-1": "Fable 5.1"
  };
  var stations = [
    { id: "food", title: "Find vegetarian spots", depends_on: [], model: "claude-sonnet-5-5", baseBudget: 1500, effort: "normal" },
    { id: "budget", title: "Price the trip", depends_on: [], model: "claude-haiku-5-5", baseBudget: 1e3, effort: "normal" },
    { id: "map", title: "Describe the route map", depends_on: ["food"], model: "claude-haiku-5-5", baseBudget: 1e3, effort: "normal" },
    { id: "itin", title: "Write the 3-day itinerary", depends_on: ["food", "budget", "map"], model: "claude-sonnet-5-5", baseBudget: 2500, effort: "normal" }
  ];
  var totalBudget = 8e3;
  var mode = "fixed";
  var suggestions = [];
  var $ = (sel) => document.querySelector(sel);
  var fmtTok = (n) => n.toLocaleString("en-US");
  var fmtUsd = (n) => n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
  var esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  function update(id, patch) {
    stations = stations.map((s) => s.id === id ? { ...s, ...patch } : s);
    suggestions = [];
    render();
  }
  function render() {
    const alloc = allocate(stations, { totalBudget, mode });
    const cost = estimateCost(stations, alloc);
    const opusEverywhere = estimateCost(
      stations.map((s) => ({ ...s, model: "claude-opus-5-5" })),
      alloc
    );
    const scale = Math.max(...alloc.stations.map((a) => Math.max(a.desired, a.budget)), 1);
    $("#total-label").textContent = fmtTok(totalBudget);
    $("#allocated").textContent = fmtTok(alloc.allocated);
    $("#reserve").textContent = alloc.overBy > 0 ? `\u2212${fmtTok(alloc.overBy)}` : fmtTok(alloc.reserve);
    $("#reserve-label").textContent = alloc.overBy > 0 ? "Over budget" : "In reserve";
    $("#reserve").classList.toggle("bad", alloc.overBy > 0);
    $("#bill").textContent = fmtUsd(cost.totalUsd);
    $("#bill-compare").textContent = `vs ${fmtUsd(opusEverywhere.totalUsd)} with Opus 5.5 at every station`;
    const pantry = $("#pantry-bar");
    pantry.innerHTML = alloc.stations.map((a, i) => {
      const pct = a.budget / Math.max(totalBudget, alloc.allocated) * 100;
      return `<span class="seg c${i}" style="width:${pct}%" title="${esc(stations[i].title ?? a.id)}: ${fmtTok(a.budget)}"></span>`;
    }).join("");
    $("#warnings").innerHTML = alloc.warnings.map((w) => `<li>${esc(w)}</li>`).join("");
    $("#stations").innerHTML = stations.map((s, i) => {
      const a = alloc.byId[s.id];
      const c = cost.byId[s.id];
      const tier = EFFORT_TIERS[s.effort];
      const effortButtons = EFFORT_ORDER.map(
        (e) => `<button class="effort ${e === s.effort ? "on" : ""}" data-id="${s.id}" data-effort="${e}" title="${esc(EFFORT_TIERS[e].blurb)}">${EFFORT_TIERS[e].label}</button>`
      ).join("");
      const models = Object.keys(CLAUDE_PRICES).map((m) => `<option value="${m}" ${m === s.model ? "selected" : ""}>${MODEL_NAMES[m] ?? m}</option>`).join("");
      const deps = s.depends_on.length ? `waits for ${s.depends_on.map((d) => esc(stations.find((x) => x.id === d)?.title ?? d)).join(", ")}` : "starts right away";
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
          <span class="want" style="width:${a.desired / scale * 100}%"></span>
          <span class="got c${i}" style="width:${a.budget / scale * 100}%"></span>
        </div>
        <dl class="facts">
          <div><dt>Ingredients</dt><dd>${fmtTok(a.budget)}${a.squeezedBy > 0 ? ` <span class="squeezed">\u2212${fmtTok(a.squeezedBy)}</span>` : ""}</dd></div>
          <div><dt>Per pass</dt><dd>${a.passes} \xD7 ${fmtTok(a.maxTokensPerPass)}</dd></div>
          <div><dt>Effort</dt><dd><code>${tier.apiEffort}</code></dd></div>
          <div><dt>Max cost</dt><dd>${c.usd === null ? "n/a" : fmtUsd(c.usd)}</dd></div>
        </dl>
        <footer>
          <label>Chef <select data-model="${s.id}">${models}</select></label>
          <label>Base <input type="number" min="200" step="100" value="${s.baseBudget}" data-base="${s.id}"/></label>
        </footer>
      </article>`;
    }).join("");
    $("#suggestions").innerHTML = suggestions.length ? `<ul>${suggestions.map((sg) => `<li class="${sg.kind}"><strong>${kindLabel(sg.kind)}</strong> ${esc(sg.reason)}</li>`).join("")}</ul>
       <button id="apply">Apply ${suggestions.length} change${suggestions.length > 1 ? "s" : ""}</button>` : `<p class="muted">Run a service to see which chefs ran out of ingredients and which left some on the shelf.</p>`;
    $("#apply")?.addEventListener("click", () => {
      stations = applySuggestions(stations, suggestions);
      suggestions = [];
      render();
    });
  }
  function kindLabel(kind) {
    return { "more-ingredients": "More ingredients", trim: "Trim", "work-harder": "Work harder" }[kind];
  }
  function simulateService() {
    const alloc = allocate(stations, { totalBudget, mode });
    const conflictId = stations[Math.floor(Math.random() * stations.length)].id;
    const usage = alloc.stations.map((a) => {
      const share = Math.random() * 1.3;
      return {
        stationId: a.id,
        outputTokens: Math.min(a.budget, Math.round(a.budget * share)),
        truncated: share >= 1,
        conflicted: a.id === conflictId && share < 1
      };
    });
    suggestions = suggestTuning(stations, alloc, usage);
    render();
    if (!suggestions.length) {
      $("#suggestions").innerHTML = `<p class="muted">Every chef used about what they were given. Nothing to change.</p>`;
    }
  }
  function chefSvg(effort) {
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
    const slider = $("#total");
    slider.value = String(totalBudget);
    slider.addEventListener("input", () => {
      totalBudget = Number(slider.value);
      suggestions = [];
      render();
    });
    document.querySelectorAll("input[name=mode]").forEach((r) => {
      r.checked = r.value === mode;
      r.addEventListener("change", () => {
        mode = r.value;
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
      const b = e.target.closest("button.effort");
      if (b) update(b.dataset.id, { effort: b.dataset.effort });
    });
    root.addEventListener("dblclick", (e) => {
      const t = e.target;
      if (t.closest("button, select, input, label")) return;
      const card = t.closest(".station");
      if (!card) return;
      const s = stations.find((x) => x.id === card.dataset.id);
      update(s.id, { effort: cycleEffort(s.effort) });
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.lock) update(t.dataset.lock, { locked: t.checked });
      if (t.dataset.model) update(t.dataset.model, { model: t.value });
      if (t.dataset.base) update(t.dataset.base, { baseBudget: Math.max(200, Number(t.value) || 200) });
    });
  }
  wire();
  render();
})();
