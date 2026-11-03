// Transaction labels moved from InsiderDashboard.jsx. Semantics are unchanged:
// 4/A, superseded / amendment linkage, price anomaly, late filing, venue,
// 10b5-1 plan, possible duplicate, related filers. Only the styling is new.
import { memo } from "react";
import { compactUsd, day } from "../../../utils/insiderFormat";

export function TypeBadge({ code, formType }) {
  const buy = code === "P";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`it-side ${buy ? "it-side-buy" : "it-side-sell"}`}>{buy ? "Purchase" : "Sale"}</span>
      {formType === "4/A" && <span className="it-mono text-[10px] font-semibold" style={{ color: "var(--it-warn)" }} title="Amended filing">4/A</span>}
    </span>
  );
}

export function SecLink({ url, label = "SEC filing ↗", title }) {
  if (!url) return <span className="it-dim2">—</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={title} className="it-link whitespace-nowrap text-xs font-medium">
      {label}
    </a>
  );
}

const VENUE_LABEL = {
  open_market: { text: "Open market", color: "var(--it-buy)", tip: "Filing footnotes describe open-market execution" },
  offering_or_private: { text: "Offering / private", color: "var(--it-warn)", tip: "Filing footnotes describe an offering or private placement" },
  unspecified: { text: "Venue not stated", color: "var(--it-text-3)", tip: "The filing does not state where the shares were bought" },
};

// Form 4/A linkage (see server/services/edgar/amendments.js).
const AMENDMENT_BADGE = {
  superseded: (a) => ({ text: "Superseded by 4/A", color: "var(--it-sell)", tip: `Replaced by amended filing ${a.supersededBy}. Kept for the record; excluded from totals and alerts.` }),
  amends: (a) => ({ text: a.tableRestated === false ? "Amends other items" : `Amends ${day(a.originalSubmissionDate)} filing`, color: "var(--it-warn)", tip: `Amended filing of ${a.original}${a.tableRestated === false ? " — transactions unchanged" : " — replaces its transactions"}.` }),
  original_not_held: (a) => ({ text: "Amendment · original not loaded", color: "var(--it-warn)", tip: `Amends a filing submitted ${day(a.originalSubmissionDate)} that is not in this dataset. Counted once here.` }),
  ambiguous: (a) => ({ text: "Amendment · verify", color: "var(--it-warn)", tip: `Several filings could be the original (${(a.candidates || []).join(", ")}). Nothing replaced — verify against the SEC filings.` }),
  unlinked: () => ({ text: "Amendment · verify", color: "var(--it-warn)", tip: "The amendment does not state its original submission date. Verify against the SEC filing." }),
  amended_other_items: (a) => ({ text: "Amended (other items)", color: "var(--it-text-2)", tip: `Amended by ${a.amendedBy} without changing the reported transactions.` }),
};

function AmendmentBadge({ t }) {
  const make = t.amendment && AMENDMENT_BADGE[t.amendment.status];
  if (!make) return null;
  const b = make(t.amendment);
  return <span className="it-chip" style={{ color: b.color }} title={b.tip}>{b.text}</span>;
}

// Purchase venue (P only, from filing text), 10b5-1 plan, duplicate review flag.
export function DetailBadges({ t }) {
  const venue = t.code === "P" ? VENUE_LABEL[t.purchaseContext] : null;
  const anomaly = t.priceCheck?.status === "anomaly";
  const late = t.filingDelay?.late;
  const dup = t.dedupe?.status === "needs_review";
  const amend = t.amendment && AMENDMENT_BADGE[t.amendment.status];
  if (!anomaly && !venue && !late && !amend && !t.is10b5_1 && !dup) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {anomaly && (
        <span className="it-chip font-semibold" style={{ color: "var(--it-sell)", background: "var(--it-sell-soft)", borderColor: "var(--it-sell-line)" }}
          title={`${t.priceCheck.reasons.map((r) => r.detail).join("\n")}\n\nExcluded from totals and alerts until verified against the SEC filing.`}>
          {t.priceCheck.label}
        </span>
      )}
      {venue && (
        <span className="it-chip" style={{ color: venue.color }}
          title={t.purchaseContextEvidence ? `${venue.tip}: “${t.purchaseContextEvidence}”` : venue.tip}>
          {venue.text}
        </span>
      )}
      {late && (
        <span className="it-chip" style={{ color: "var(--it-warn)", borderColor: "var(--it-warn-line)" }}
          title={`Traded ${day(t.transactionDate)}, ${t.filingDelay.measuredTo === "original_submission" ? "originally filed" : "filed"} ${t.filingDelay.businessDays} business days later. Form 4 is due within 2 business days of the trade — this is not a recent trade.`}>
          Late filing · {t.filingDelay.businessDays} business days
        </span>
      )}
      <AmendmentBadge t={t} />
      {t.is10b5_1 && <span className="it-chip" title="Filing indicates a Rule 10b5-1 trading plan">10b5-1 plan</span>}
      {dup && (
        <span className="it-chip" style={{ color: "var(--it-warn)", borderColor: "var(--it-warn-line)" }}
          title={`Possible duplicate of another filing — kept separate. ${t.dedupe.reason || ""}`}>
          Possible duplicate · review
        </span>
      )}
    </div>
  );
}

// Anomalous values stay visible as filed, but are marked and excluded from totals.
export function ValueCell({ t }) {
  if (t.amendment?.status === "superseded") {
    return (
      <span className="inline-flex flex-col items-end">
        <span className="it-dim2 line-through decoration-rose-400/60">{compactUsd(t.value)}</span>
        <span className="text-[10px] font-medium it-dim2">superseded · excluded</span>
      </span>
    );
  }
  if (t.priceCheck?.status !== "anomaly") return compactUsd(t.value);
  return (
    <span className="inline-flex flex-col items-end">
      <span className="it-dim2 line-through decoration-rose-400/60" title={`As reported: ${t.reported?.shares ?? t.shares} sh × $${t.reported?.pricePerShare ?? t.price}`}>{compactUsd(t.value)}</span>
      <span className="text-[10px] font-medium it-sell">unverified · excluded</span>
    </span>
  );
}

const ownershipLabel = (r) => (r.ownership === "I" ? `Indirect${r.natureOfOwnership ? ` · ${r.natureOfOwnership}` : ""}` : r.ownership === "D" ? "Direct" : "");

// Primary reporter + every related filer that reported the same economic transaction.
export const Reporters = memo(function Reporters({ t }) {
  const reporters = t.reportedBy?.length ? t.reportedBy : [t];
  const [primary, ...others] = reporters;
  const names = (primary.insiderName || "—").split("; ");
  return (
    <div className="min-w-0">
      <div className="truncate" style={{ color: "var(--it-text)" }} title={primary.insiderName}>
        {names[0]}{names.length > 1 && <span className="it-dim2"> +{names.length - 1} related filers</span>}
      </div>
      {ownershipLabel(primary) && <div className="truncate text-[11px] it-dim2" title={ownershipLabel(primary)}>{ownershipLabel(primary)}</div>}
      {others.length > 0 && (
        <div className="mt-1.5 rounded px-2 py-1 text-[11px] leading-relaxed it-dim" style={{ background: "var(--it-surface)" }}
          title={(t.dedupe?.evidence || []).join("\n")}>
          <span className="it-dim2">Also reported by </span>
          {others.map((r, i) => (
            <span key={r.rowId}>
              {i > 0 && "; "}
              <span style={{ color: "var(--it-text)" }}>{r.insiderName}</span>
              {r.ownership && <span className="it-dim2"> ({r.ownership === "I" ? "indirect" : "direct"})</span>}
            </span>
          ))}
          <span className="it-dim2"> — counted once</span>
        </div>
      )}
    </div>
  );
});

export function FilingLinks({ t }) {
  const reporters = t.reportedBy?.length ? t.reportedBy : [t];
  return (
    <div className="flex flex-col gap-0.5">
      {reporters.map((r, i) => (
        <SecLink key={r.accessionNo + i} url={r.filingUrl} label={reporters.length > 1 ? `Filing ${i + 1} ↗` : "SEC filing ↗"}
          title={`${r.accessionNo}${r.insiderName ? ` — ${r.insiderName}` : ""}`} />
      ))}
    </div>
  );
}
