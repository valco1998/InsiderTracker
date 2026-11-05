// deep4/learn/famBLib.mjs — family-B confirmation rules (spec.familyB), identical for insider events and matched controls.
// Only bars completed before the rule's entry timestamp are read, and never a session at/after the market cutoff (M.jMax).
import * as SL from "../panel/strategyLib.mjs";
import * as PL from "../panel/panelLib.mjs";

const barAt = (A, j) => PL.barOn(A, j); // bar index on session j or -1
// last bar on or before session j (index), or -1
const lastBar = (A, j) => (j < 0 ? -1 : A.kAt[j]);

// Decide a rule for one (sym, entryDate) and return { pass, entryJ, entryWhen, why } (pass=false: no trade).
export function decide(M, rule, sym, entryDate, G80) {
  const A = sym ? M.aligned(sym) : null; if (!A) return { pass: false, why: "no_bars" };
  const j0 = M.idx.get(entryDate); if (j0 == null) return { pass: false, why: "no_session" };
  const kD = lastBar(A, j0 - 1); if (kD < 0) return { pass: false, why: "no_decision_bar" };
  const D = A.arr[kD].c; if (!(D > 0)) return { pass: false, why: "no_decision_close" };
  const readable = (j) => j <= M.jMax; // never read a session on/after the cutoff
  switch (rule) {
    case "B0": return { pass: true, entryJ: j0, entryWhen: "open" };
    case "B1": { // hold-2
      if (!readable(j0 + 1)) return { pass: false, why: "cutoff" };
      const k = lastBar(A, j0 + 1); if (k < 0 || A.jOfBar[k] < j0) return { pass: false, why: "no_post_bar" };
      return A.arr[k].c >= D ? { pass: true, entryJ: j0 + 2, entryWhen: "open" } : { pass: false, why: "failed" };
    }
    case "B2": { // breakout-20 within 10 sessions
      for (let s = j0; s <= j0 + 9; s++) {
        if (!readable(s)) return { pass: false, why: "cutoff" };
        const k = barAt(A, s); if (k < 0) continue;
        let mx = -Infinity, cnt = 0; for (let q = s - 20; q <= s - 1; q++) { const kk = barAt(A, q); if (kk >= 0) { cnt++; if (A.arr[kk].c > mx) mx = A.arr[kk].c; } }
        if (cnt >= 10 && A.arr[k].c >= mx) return { pass: true, entryJ: s + 1, entryWhen: "open", signalJ: s };
      }
      return { pass: false, why: "no_breakout" };
    }
    case "B3": case "B4": { // gap cap: limit-on-open (B3) or market-on-close after the open (B4)
      if (!readable(j0)) return { pass: false, why: "cutoff" };
      const k = barAt(A, j0); if (k < 0 || !(A.arr[k].o > 0)) return { pass: false, why: "no_entry_bar" };
      const gap = A.arr[k].o / D - 1;
      return gap <= G80 ? { pass: true, entryJ: j0, entryWhen: rule === "B3" ? "open" : "close", gap } : { pass: false, why: "gap", gap };
    }
    case "B5": { // day-0 hold
      if (!readable(j0)) return { pass: false, why: "cutoff" };
      const k = barAt(A, j0); if (k < 0) return { pass: false, why: "no_entry_bar" };
      return A.arr[k].c >= A.arr[k].o ? { pass: true, entryJ: j0 + 1, entryWhen: "open" } : { pass: false, why: "failed" };
    }
    default: throw new Error(`unknown rule ${rule}`);
  }
}
// Trade for a decided rule with a calendar exit (days) from the rule's entry date. costBps per side x costMult.
export function ruleTrade(M, sym, d, days, costBps, costMult = 1) {
  if (!d.pass) return { status: "no_trade", why: d.why };
  const A = M.aligned(sym);
  return SL.tradeAt(M, A, d.entryJ, SL.exits.calendar(days), { entryWhen: d.entryWhen, costPerSide: (costBps * costMult) / 1e4 });
}
