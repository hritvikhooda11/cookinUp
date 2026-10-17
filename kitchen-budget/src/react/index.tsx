// Pixel-style React pieces for the pantry manager. Props-driven, so they work with the
// Zustand slice or any other state. Render <PixelStyles /> once (e.g. in the root layout).
//
// Retheme by setting the --kb-* variables on any ancestor, for example to match the
// app's pixel palette:  .kitchen { --kb-ink: #222034; --kb-fill: #6abe30; }
// Fonts are inherited, so the app's pixel font is used automatically.

import type { CSSProperties, ReactNode } from "react";
import type { Allocation, StationAllocation } from "../allocate";
import { EFFORT_ORDER, EFFORT_TIERS, type Effort } from "../effort";
import { pantryLevel } from "../pantry";

const PIPS: Record<Effort, number> = { light: 0, normal: 1, double: 2, max: 3 };

export const pixelCss = `
.kb {
  --kb-ink: #1b1a2e; --kb-paper: #f4ecd6; --kb-panel: #fffaf0; --kb-muted: #6b6478;
  --kb-fill: #3fa34d; --kb-used: #1f6b2a; --kb-want: #d8cfb6; --kb-squeeze: #c0392b;
  --kb-hot: #f39c12; --kb-flame: #e74c3c; --kb-on: #1b1a2e; --kb-on-ink: #fffaf0;
  --kb-px: 3px;
  font: inherit; color: var(--kb-ink); image-rendering: pixelated;
}
.kb * { box-sizing: border-box; }
.kb-box { background: var(--kb-panel); border: var(--kb-px) solid var(--kb-ink);
  box-shadow: var(--kb-px) var(--kb-px) 0 0 var(--kb-ink); }
.kb-effort { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--kb-px); }
.kb-effort button { font: inherit; font-size: .72em; line-height: 1.2; color: var(--kb-ink);
  background: var(--kb-panel); border: var(--kb-px) solid var(--kb-ink); border-radius: 0;
  padding: .5em .25em; cursor: pointer; box-shadow: 0 var(--kb-px) 0 0 var(--kb-ink);
  display: flex; flex-direction: column; align-items: center; gap: .35em; }
.kb-effort button:hover { background: var(--kb-paper); }
.kb-effort button:active { transform: translateY(var(--kb-px)); box-shadow: none; }
.kb-effort button:focus-visible { outline: var(--kb-px) dashed var(--kb-hot); outline-offset: 2px; }
.kb-effort button[aria-pressed="true"] { background: var(--kb-on); color: var(--kb-on-ink); }
.kb-pips { display: inline-flex; gap: 2px; height: 8px; }
.kb-pip { width: 6px; height: 8px; background: var(--kb-want); }
.kb-pip[data-on] { background: var(--kb-flame);
  box-shadow: inset 0 -3px 0 0 var(--kb-hot); }
.kb-badge { display: inline-flex; align-items: center; gap: .4em; padding: .2em .45em;
  background: var(--kb-panel); border: var(--kb-px) solid var(--kb-ink); font-size: .7em; }
.kb-badge[data-effort="double"], .kb-badge[data-effort="max"] { animation: kb-bob .5s steps(2) infinite; }
.kb-bar { position: relative; height: 14px; background: var(--kb-paper);
  border: var(--kb-px) solid var(--kb-ink); overflow: hidden; }
.kb-bar > span { position: absolute; top: 0; bottom: 0; left: 0; transition: width .3s steps(6); }
.kb-bar .kb-want { background: repeating-linear-gradient(90deg, var(--kb-want) 0 6px, transparent 6px 8px); }
.kb-bar .kb-got { background: repeating-linear-gradient(90deg, var(--kb-fill) 0 6px, transparent 6px 8px); }
.kb-bar .kb-use { background: repeating-linear-gradient(90deg, var(--kb-used) 0 6px, transparent 6px 8px); }
.kb-label { display: flex; justify-content: space-between; gap: .5em; font-size: .7em; margin-top: .35em;
  font-variant-numeric: tabular-nums; }
.kb-squeeze { color: var(--kb-squeeze); }
.kb-shelf { display: flex; height: 18px; border: var(--kb-px) solid var(--kb-ink); background: var(--kb-paper); }
.kb-shelf > span { height: 100%; border-right: var(--kb-px) solid var(--kb-ink); transition: width .3s steps(6); }
.kb-ticket { padding: .6em .8em; font-variant-numeric: tabular-nums;
  background: repeating-linear-gradient(0deg, var(--kb-panel) 0 10px, var(--kb-paper) 10px 12px); }
.kb-ticket .kb-total { font-size: 1.4em; }
@keyframes kb-bob { 0% { transform: translateY(0); } 100% { transform: translateY(-2px); } }
@media (prefers-reduced-motion: reduce) {
  .kb-badge { animation: none !important; } .kb-bar > span, .kb-shelf > span { transition: none; }
}
`;

/** Injects the component styles. Render once near the root. */
export function PixelStyles() {
  return <style>{pixelCss}</style>;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function Pips({ effort }: { effort: Effort }) {
  return (
    <span className="kb-pips" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="kb-pip" data-on={i < PIPS[effort] ? "" : undefined} />
      ))}
    </span>
  );
}

export interface EffortPickerProps {
  value: Effort;
  onChange: (effort: Effort) => void;
  className?: string;
}

/** Four pixel buttons: Light prep, Normal, Double shift, All hands. */
export function EffortPicker({ value, onChange, className }: EffortPickerProps) {
  return (
    <div className={`kb kb-effort ${className ?? ""}`} role="group" aria-label="How hard this chef works">
      {EFFORT_ORDER.map((e) => (
        <button
          key={e}
          type="button"
          aria-pressed={e === value}
          title={EFFORT_TIERS[e].blurb}
          onClick={() => onChange(e)}
        >
          <Pips effort={e} />
          {EFFORT_TIERS[e].label}
        </button>
      ))}
    </div>
  );
}

/** Small flame badge to sit on a chef sprite. Bobs while the chef is boosted. */
export function EffortBadge({ effort, className }: { effort: Effort; className?: string }) {
  const tier = EFFORT_TIERS[effort];
  return (
    <span className={`kb kb-badge ${className ?? ""}`} data-effort={effort} title={tier.blurb}>
      <Pips effort={effort} />
      {tier.multiplier}x
    </span>
  );
}

export interface StationPantryProps {
  allocation: StationAllocation;
  /** Output tokens used so far (from station_token / station_done). */
  used?: number;
  className?: string;
}

/**
 * The pantry bar beside a station: what the chef asked for (pale), what they got
 * (green) and what they have used (dark). Red text shows tokens given up to a boost.
 */
export function StationPantry({ allocation, used = 0, className }: StationPantryProps) {
  const level = pantryLevel(allocation, used);
  const scale = Math.max(allocation.desired, allocation.budget, 1);
  const pct = (n: number) => `${(n / scale) * 100}%`;
  return (
    <div className={`kb ${className ?? ""}`}>
      <div
        className="kb-bar"
        role="meter"
        aria-label="Ingredients"
        aria-valuemin={0}
        aria-valuemax={level.budget}
        aria-valuenow={level.used}
      >
        <span className="kb-want" style={{ width: pct(allocation.desired) }} />
        <span className="kb-got" style={{ width: pct(level.budget) }} />
        <span className="kb-use" style={{ width: pct(Math.min(level.used, level.budget)) }} />
      </div>
      <div className="kb-label">
        <span>
          {fmt(level.used)} / {fmt(level.budget)} tok
        </span>
        {allocation.squeezedBy > 0 && <span className="kb-squeeze">-{fmt(allocation.squeezedBy)}</span>}
      </div>
    </div>
  );
}

export interface PantryShelfProps {
  allocation: Allocation;
  /** Colour per station id; defaults cycle through a small pixel palette. */
  colors?: Record<string, string>;
  titles?: Record<string, string>;
  className?: string;
}

const SHELF_COLORS = ["#e67e22", "#16a085", "#8e44ad", "#d35480", "#2980b9", "#c0a020"];

/** The whole kitchen's budget, split by station. Empty space is the reserve. */
export function PantryShelf({ allocation, colors, titles, className }: PantryShelfProps) {
  const width = Math.max(allocation.totalBudget, allocation.allocated, 1);
  return (
    <div className={`kb ${className ?? ""}`}>
      <div className="kb-shelf" aria-label="How the pantry is split">
        {allocation.stations.map((a, i) => (
          <span
            key={a.id}
            title={`${titles?.[a.id] ?? a.id}: ${fmt(a.budget)} tok`}
            style={{ width: `${(a.budget / width) * 100}%`, background: colors?.[a.id] ?? SHELF_COLORS[i % SHELF_COLORS.length] } as CSSProperties}
          />
        ))}
      </div>
      <div className="kb-label">
        <span>{fmt(allocation.allocated)} allocated</span>
        <span className={allocation.overBy > 0 ? "kb-squeeze" : undefined}>
          {allocation.overBy > 0 ? `${fmt(allocation.overBy)} over` : `${fmt(allocation.reserve)} in reserve`}
        </span>
      </div>
    </div>
  );
}

export interface BillTicketProps {
  /** Worst-case estimate before cooking (estimate.totalUsd). */
  estimateUsd: number;
  /** Real spend so far (bill_update.total_cost). */
  actualUsd?: number;
  totalTokens?: number;
  children?: ReactNode;
  className?: string;
}

const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);

/** The running tab in the corner. */
export function BillTicket({ estimateUsd, actualUsd, totalTokens, children, className }: BillTicketProps) {
  return (
    <div className={`kb kb-box kb-ticket ${className ?? ""}`}>
      <div>THE BILL</div>
      <div className="kb-total">{usd(actualUsd ?? 0)}</div>
      <div className="kb-label">
        <span>max {usd(estimateUsd)}</span>
        {totalTokens !== undefined && <span>{fmt(totalTokens)} tok</span>}
      </div>
      {children}
    </div>
  );
}
